import { test, expect, bodyOverflowsX } from './fixtures';
import { unreadableText } from '../lib/visual-audit';
import { execFileSync } from 'node:child_process';
import { CONTAINER } from '../lib/env.mjs';

const record = 'a0000000-0000-4000-8000-000000000001';
const call = 'c0000000-0000-4000-8000-000000000001';
const duplicate = 'c0000000-0000-4000-8000-000000000009';
const sql = (input: string) => execFileSync('podman', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1'], { input, stdio: ['pipe', 'ignore', 'pipe'] });
const capture = (body: object) => sql(`select bolna_record_ai_evidence('${JSON.stringify(body).replaceAll("'", "''")}'::jsonb,'retained')`);

function seed() {
  const base = { id: call, status: 'no-answer', created_at: '2026-10-10T03:00:00Z', initiated_at: '2026-10-10T03:00:00Z', updated_at: '2026-10-10T03:01:00Z', batch_id: 'timeline-batch', telephony_data: { provider: 'twilio', provider_call_id: 'first', call_type: 'outbound', to_number: '+919811100001', duration: 0 } };
  capture(base);
  capture({ ...base, id: duplicate, telephony_data: { ...base.telephony_data, to_number: '98111 00001' } });
  const latest = { ...base, status: 'completed', initiated_at: '2026-10-10T04:00:00Z', updated_at: '2026-10-10T04:02:00Z', conversation_duration: 80, transcript: 'user: The warehouse is available for a visit.', telephony_data: { ...base.telephony_data, provider_call_id: 'second', duration: 80, recording_url: 'https://recordings.eval.test/second.mp3' } };
  capture(latest);
  sql(`update bolna_call_logs set raw='${JSON.stringify(latest)}'::jsonb,call_created_at='2026-10-10T04:00:00Z',notes='Owner confirmed availability and requested a site visit.',llm_availability='Available' where id='${call}';
    insert into raw_phones(master_id,phone_id,is_primary) select '${record}',phone_id,false from raw_phone_numbers where phone_last10='9811100002';`);
  // A matching provider ID on a different phone is still a different call.
  capture({ ...base, id: 'c0000000-0000-4000-8000-000000000002', telephony_data: { ...base.telephony_data, to_number: '+919811100002' } });
}

for (const width of [1366, 390]) for (const theme of ['light', 'dark']) {
  test(`phone timeline stays compact and deduplicates calls at ${width}px in ${theme}`, async ({ adminPage: page, shot }) => {
    seed();
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    await page.goto('/dashboard/raw?q=Raghav');
    await page.getByRole('button', { name: 'Show AI attempts', exact: true }).click();
    const dialog = page.getByRole('dialog'), history = dialog.locator('.ai-timeline');
    await expect(history.locator('.history-count')).toHaveText('2');
    await expect(history.getByLabel('AI history phone number')).toHaveValue('9811100001');
    await expect(history.getByLabel('AI history phone number').locator('option')).toHaveCount(3);
    const calls = history.locator('.attempt-card');
    await expect(calls).toHaveCount(2);
    await expect(calls.first()).toContainText('9:30 am IST');
    await expect(calls.first()).toContainText('1 minute 20 seconds');
    await expect(calls.first().locator('.pill-available')).toHaveText('Available');
    await expect(calls.last()).toContainText('8:30 am IST');
    const summaryBounds = (await dialog.locator('.detail-contact-bar').boundingBox())!;
    expect(summaryBounds.y + summaryBounds.height).toBeLessThan((await history.boundingBox())!.y);
    await expect(calls.first()).toBeInViewport();
    await expect(calls.last()).toBeInViewport();
    await expect(dialog.locator('.ai-saved-summary')).toHaveCount(0);
    await expect(history.locator('.history-summary')).toHaveCount(0);
    await expect(calls.first().locator('.attempt-info-content')).not.toBeVisible();
    await expect(history.getByLabel('AI history batch')).toHaveCount(0);
    expect(await bodyOverflowsX(page)).toBe(false);
    expect(await unreadableText(page)).toEqual([]);
    await shot(page, `ai-timeline-${width}-${theme}`);

    await expect(calls.first().getByLabel('Call recording')).toBeVisible();
    await expect(calls.first().getByLabel('Call recording')).toHaveAttribute('preload', 'none');
    await calls.first().locator('.attempt-transcript > summary').click();
    await expect(calls.first()).toContainText('Owner confirmed availability');
    await expect(calls.first().locator('.transcript')).toContainText('The warehouse is available');
    await expect(calls.first().locator('audio')).toHaveAttribute('src', 'https://recordings.eval.test/second.mp3');
    await expect(calls.last().locator('audio')).toHaveCount(0);
    await expect(calls.last()).not.toContainText('Owner confirmed availability');
    await shot(page, `ai-timeline-call-details-${width}-${theme}`);

    await history.getByLabel('AI history phone number').focus();
    await history.getByLabel('AI history phone number').selectOption('9811100002');
    await expect(history.locator('.history-count')).toHaveText('1');
    await expect(history.getByLabel('AI history phone number')).toBeFocused();
    await expect(calls).toHaveCount(1);
    await history.getByLabel('AI history phone number').selectOption('');
    await expect(history.locator('.history-count')).toHaveText('3');
    await expect(calls).toHaveCount(3);
    await expect(calls.filter({ hasText: '+919811100002' })).toHaveCount(1);
    await shot(page, `ai-timeline-all-numbers-${width}-${theme}`);

    await history.getByRole('button', { name: 'History options', exact: true }).click();
    await history.getByLabel('AI history batch').fill('missing');
    await history.getByRole('button', { name: 'Filter AI history', exact: true }).click();
    await expect(history).toContainText('No AI calls match this batch.');
    await history.getByRole('button', { name: 'Clear batch filter', exact: true }).click();
    await expect(calls).toHaveCount(3);
  });
}

test('timeline retries preserve the selected contact and saved call details remain available', async ({ adminPage: page }) => {
  seed();
  let failed = false;
  await page.route('**/api/details/record/*/ai?*', async route => {
    if (!failed) { failed = true; await route.fulfill({ status: 503, json: { error: 'Temporary failure' } }); }
    else await route.continue();
  });
  await page.goto('/dashboard/raw?q=Raghav');
  await page.getByRole('button', { name: 'Show AI attempts', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('alert')).toBeVisible();
  await dialog.getByRole('button', { name: 'Retry AI history', exact: true }).click();
  await expect(dialog.locator('.history-count')).toHaveText('2');
  await expect(dialog.getByLabel('AI history phone number')).toHaveValue('9811100001');
  await dialog.getByRole('button', { name: 'History options', exact: true }).click();
  await dialog.locator('.history-saved > summary').click();
  await expect(dialog.locator('.ai-saved-summary')).toContainText('Owner confirmed availability');
});
