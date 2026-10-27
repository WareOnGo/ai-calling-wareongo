import { test, expect, bodyOverflowsX } from './fixtures';
import { unreadableText } from '../lib/visual-audit';
import { execFileSync } from 'node:child_process';
import { CONTAINER } from '../lib/env.mjs';

const call = 'c0000000-0000-4000-8000-000000000001';
const capture = (body: object) => execFileSync('podman', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1'], {
  input: `select bolna_record_ai_evidence('${JSON.stringify(body).replaceAll("'", "''")}'::jsonb,'retained')`, stdio: ['pipe', 'ignore', 'pipe'],
});
function seedAttempts() {
  for (const provider of ['first', 'second']) capture({ id: call, status: 'completed', initiated_at: '2026-10-13T03:00:00Z',
    telephony_data: { provider_call_id: provider, call_type: 'outbound', to_number: '+919811100001' } });
  capture({ id: 'c0000000-0000-4000-8000-000000000005', status: 'completed', initiated_at: '2026-10-13T04:00:00Z',
    telephony_data: { provider_call_id: 'inbound', call_type: 'inbound', from_number: '+919811100001', to_number: '+918000000000' } });
}

for (const width of [1366, 390]) for (const theme of ['light', 'dark']) {
  test(`AI cards open the shared Details panel in every table at ${width}px in ${theme}`, async ({ adminPage: page, shot }) => {
    seedAttempts();
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    let aiRequests = 0;
    page.on('request', request => { if (/\/api\/details\/(record|call)\/[^/]+\/ai\?/.test(request.url())) aiRequests++; });
    let palette: { color: string; background: string } | undefined;

    for (const [path, entity, count] of [
      ['raw', 'record', 3], ['calls', 'call', 3], ['assignments', 'record', 3], ['assignments', 'call', 3],
    ] as const) {
      await page.goto(`/dashboard/${path}?q=Raghav`);
      let rows = page.locator('table.sheet tbody tr').filter({ hasText: 'Raghav Sharma' });
      if (path === 'assignments') rows = rows.filter({ has: page.locator(`.pill-${entity}`) });
      const row = rows.filter({ has: page.locator('.ai-attempt-available') });
      const card = row.getByRole('button', { name: 'Show AI attempts', exact: true });
      await expect(card).toHaveCount(1);
      await expect(card.locator('.ai-attempt-counts')).toHaveText(`2 outbound · ${entity === 'record' ? 1 : 0} inbound`);
      await card.scrollIntoViewIfNeeded();
      const style = await card.evaluate(button => ({ color: getComputedStyle(button).color, background: getComputedStyle(button).backgroundColor }));
      if (palette) expect(style).toEqual(palette); else palette = style;
      const bounds = await card.evaluate(button => ({ right: button.getBoundingClientRect().right, cellRight: button.closest('td')!.getBoundingClientRect().right, width: button.clientWidth, contents: button.scrollWidth }));
      expect(bounds.right).toBeLessThanOrEqual(bounds.cellRight);
      expect(bounds.contents).toBeLessThanOrEqual(bounds.width);
      await shot(page, `ai-card-${path}-${entity}-${width}-${theme}`);
      const before = aiRequests;
      await card.focus(); await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toHaveCount(1);
      await expect(dialog).toHaveClass(/record-details-dialog/);
      await expect(dialog).toHaveAccessibleName('Raghav Sharma');
      await expect(dialog.getByRole('tab', { name: 'AI activity', exact: true })).toHaveAttribute('aria-selected', 'true');
      const activity = dialog.getByRole('tabpanel', { name: 'AI activity', exact: true });
      await expect(activity.locator('.history-count')).toHaveText(String(count));
      await expect(activity.locator('.history-count')).toBeInViewport();
      await expect(dialog.locator('.detail-contact-bar')).toContainText('+919811100001');
      expect(aiRequests).toBe(before + 1);
      const geometry = await dialog.evaluate(element => ({ width: element.clientWidth, content: element.scrollWidth, bottom: element.querySelector('.modal-foot')!.getBoundingClientRect().bottom }));
      expect(geometry.content).toBeLessThanOrEqual(geometry.width + 1);
      expect(geometry.bottom).toBeLessThanOrEqual(width === 390 ? 844 : 900);
      expect(await bodyOverflowsX(page)).toBe(false);
      expect(await unreadableText(page)).toEqual([]);
      await shot(page, `ai-details-${path}-${entity}-${width}-${theme}`);
      await dialog.getByRole('tab', { name: 'Overview', exact: true }).click();
      await expect(dialog.getByRole('tabpanel', { name: 'Overview', exact: true })).toBeVisible();
      await dialog.getByRole('tab', { name: 'Manual activity', exact: true }).click();
      await expect(dialog.getByRole('heading', { name: /Verification history/ })).toBeVisible();
      await dialog.getByRole('tab', { name: 'AI activity', exact: true }).click();
      expect(aiRequests).toBe(before + 1);
      await page.keyboard.press('Escape');
      await expect(card).toBeFocused();
      await expect(page).toHaveURL(new RegExp(`/dashboard/${path}\\?q=Raghav$`));

      // The normal Details entry point still starts on Overview.
      await row.getByRole('button', { name: `Details for ${entity}`, exact: true }).click();
      await expect(dialog.getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute('aria-selected', 'true');
      expect(aiRequests).toBe(before + 1);
      await dialog.getByRole('button', { name: 'Close details', exact: true }).click();
    }
    expect(errors).toEqual([]);
  });
}

test('AI entry point survives a details retry and remains execution-scoped for employees', async ({ adminPage: page, employeePage }) => {
  seedAttempts();
  let fail = true;
  await page.route('**/api/details/record/*?section=overview', async route => {
    if (fail) { fail = false; await route.fulfill({ status: 503, json: { error: 'Details temporarily unavailable' } }); }
    else await route.continue();
  });
  await page.goto('/dashboard/raw?q=Raghav');
  await page.getByRole('button', { name: 'Show AI attempts', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('alert')).toContainText("Couldn't load this information. Try again.");
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(dialog.getByRole('tab', { name: 'AI activity', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.locator('.history-count')).toHaveText('3');
  await employeePage.goto('/dashboard/calls?q=Raghav');
  await employeePage.getByRole('button', { name: 'Show AI attempts', exact: true }).click();
  const own = employeePage.getByRole('dialog');
  await expect(own.locator('.history-count')).toHaveText('2');
  await own.getByRole('button', { name: 'History options', exact: true }).click();
  await expect(own.getByLabel('AI history scope')).toHaveCount(0);
  await expect(own.locator('.history-restriction')).toContainText('This execution');
});
