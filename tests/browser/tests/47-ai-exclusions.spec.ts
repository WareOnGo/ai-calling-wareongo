import { test, expect, bodyOverflowsX } from './fixtures';
import { execFileSync } from 'node:child_process';
import type { Page } from '@playwright/test';
import { CONTAINER } from '../lib/env.mjs';
import { unreadableText } from '../lib/visual-audit';

function seedSelection() {
  execFileSync('podman', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'], { input: `
    insert into raw_records(id,source,source_record_id,owner_name,city,state)
      select ('a1000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'exclusions',i::text,
        'Exclusion '||case i when 1 then 'Fresh' when 2 then 'Available' when 3 then 'Unavailable' when 4 then 'No answer' else 'Assigned' end,'Delhi','Delhi'
      from generate_series(1,5) i;
    insert into raw_phone_numbers(phone_last10,phone) select '900111000'||i,'+91900111000'||i from generate_series(1,5) i;
    insert into raw_phones(master_id,phone_id,is_primary)
      select r.id,p.phone_id,true from raw_records r join raw_phone_numbers p on p.phone_last10='900111000'||r.source_record_id where r.source='exclusions';
    insert into bolna_call_logs(id,status,to_number,call_type,llm_availability,phone_id,call_created_at)
      select ('c1000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
        case when i=4 then 'no-answer' else 'completed' end,p.phone,'outbound',
        case i when 2 then 'Available' when 3 then 'Unavailable' when 5 then 'Unclear' end,p.phone_id,now()
      from generate_series(2,5) i join raw_phone_numbers p on p.phone_last10='900111000'||i;
    insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by)
      values('record','a1000000-0000-4000-8000-000000000005','raj@eval.test','admin@eval.test');
  ` });
}

async function fits(page: Page) {
  expect(await bodyOverflowsX(page)).toBe(false);
  const geometry = await page.getByRole('dialog').evaluate(element => ({
    width: element.clientWidth, content: element.scrollWidth,
    footer: element.querySelector('.modal-foot')!.getBoundingClientRect().bottom, viewport: innerHeight,
  }));
  expect(geometry.content).toBeLessThanOrEqual(geometry.width + 1);
  expect(geometry.footer).toBeLessThanOrEqual(geometry.viewport);
  expect(await unreadableText(page)).toEqual([]);
}

for (const width of [1366, 390]) for (const theme of ['light', 'dark']) {
  test(`AI exclusions are immediately reachable at ${width}px in ${theme}`, async ({ adminPage: page, shot }) => {
    seedSelection();
    await page.setViewportSize({ width, height: width === 390 ? 844 : 768 });
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    let dispatched = false;
    await page.route('**/api/raw/dispatch', route => { dispatched = true; return route.abort(); });
    await page.goto('/dashboard/raw?q=Exclusion');
    await page.locator('.selall').check();
    await page.getByRole('button', { name: /^Queue for calling/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Queue for calling', exact: true });
    const history = dialog.getByRole('region', { name: 'Previous AI calls', exact: true });
    await expect(history.getByRole('button', { name: 'Exclude all called', exact: true })).toBeInViewport();
    await expect(history).toContainText('3 included in this batch');
    await expect(dialog.getByRole('heading', { name: '4 ready to call', exact: true })).toBeVisible();
    expect(await history.evaluate(element => !!(element.compareDocumentPosition(document.querySelector('.queue-language')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
    await fits(page);
    await shot(page, `ai-exclusions-${width}-${theme}`);
    await history.getByRole('button', { name: 'Exclude all called', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: '1 ready to call', exact: true })).toBeVisible();
    await expect(history).toContainText('0 included in this batch');
    await history.getByRole('button', { name: 'Re-include all called', exact: true }).click();
    await dialog.getByRole('button', { name: 'Send to Bolna (4)', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Yes, place calls', exact: true })).toBeVisible();
    await history.getByRole('checkbox', { name: /^Available/ }).uncheck();
    await expect(dialog.getByRole('heading', { name: '3 ready to call', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Yes, place calls', exact: true })).toHaveCount(0);
    expect(dispatched).toBe(false);
  });

  test(`manual exclusions change the saved assignment at ${width}px in ${theme}`, async ({ adminPage: page, shot }) => {
    seedSelection();
    await page.setViewportSize({ width, height: width === 390 ? 844 : 768 });
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    await page.goto('/dashboard/raw?q=Exclusion');
    if (width === 390) await page.locator('.selall').check();
    await page.getByRole('button', { name: 'Assign', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Assign records', exact: true });
    const history = dialog.getByRole('region', { name: 'Previous AI calls', exact: true });
    await expect(history.getByRole('button', { name: 'Exclude all called', exact: true })).toBeInViewport();
    await expect(history).toContainText('3 included in this batch');
    await expect(dialog.getByText('1 already assigned to callers', { exact: true })).toBeVisible();
    expect(await history.evaluate(element => !!(element.compareDocumentPosition(document.querySelector('.assignment-mode')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
    await fits(page);
    await shot(page, `manual-exclusions-${width}-${theme}`);
    await history.getByRole('button', { name: 'Exclude all called', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Assign 1', exact: true })).toBeEnabled();
    await expect(history).toContainText('0 included in this batch');
    await history.getByRole('button', { name: 'Re-include all called', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Assign 4', exact: true })).toBeEnabled();
    await history.getByRole('checkbox', { name: /^Available/ }).uncheck();
    await expect(dialog.getByRole('button', { name: 'Assign 3', exact: true })).toBeEnabled();
    const response = page.waitForResponse(response => response.url().endsWith('/api/assignments') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Assign 3', exact: true }).click();
    const saved = await response;
    expect(saved.request().postDataJSON()).toMatchObject({ excludeCats: ['available'] });
    expect(await saved.json()).toMatchObject({ assigned: 3, skippedAi: 1, skippedOwned: 1 });
    await expect(dialog).toContainText('1 excluded by AI history');
  });
}

test('manual follow-up of AI calls supports outcome exclusions with no eligible work', async ({ adminPage: page }) => {
  seedSelection();
  await page.goto('/dashboard/calls?q=900111');
  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Assign calls', exact: true });
  await dialog.getByRole('button', { name: 'Exclude all called', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Assign 0', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Re-include all called', exact: true })).toBeEnabled();
  await dialog.getByRole('checkbox', { name: /^No answer/ }).check();
  await expect(dialog.getByRole('button', { name: 'Assign 1', exact: true })).toBeEnabled();
});
