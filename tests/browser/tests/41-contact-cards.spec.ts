import { test, expect, bodyOverflowsX } from './fixtures';
import { execFileSync } from 'node:child_process';
import { CONTAINER } from '../lib/env.mjs';

const record = 'a0000000-0000-4000-8000-000000000001';
const call = 'c0000000-0000-4000-8000-000000000001';
const batch = 'd0000000-0000-4000-8000-000000000001';
const phone = '+919811100001';
const sql = (input: string) => execFileSync('podman', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1'], { input, stdio: ['pipe', 'ignore', 'pipe'] });

for (const width of [1366, 390]) {
  test(`contact identity and independent copy/details actions work across tables at ${width}px`, async ({ adminPage: admin, employeePage: employee, shot }) => {
    sql(`insert into call_batches(id,created_by,state,bolna_batch_id) values ('${batch}','admin@eval.test','completed','contact-card-provider');
      insert into call_batch_items(batch_id,record_id,name,contact_number) values ('${batch}','${record}','Raghav Sharma','${phone}');
      update bolna_call_logs set batch_id='contact-card-provider' where id='${call}';
      insert into bolna_manual_attempts(id,assignment_id,actor,assignee,occurred_at,disposition,outcome,request_hash)
        values(gen_random_uuid(),1,'priya@eval.test','priya@eval.test','2026-10-13T09:00:00Z','connected','Available','contact-card-fixture');`);
    for (const page of [admin, employee]) {
      await page.setViewportSize({ width, height: 844 });
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    }
    const cases = [
      { page: admin, path: '/dashboard/raw?q=Raghav', table: 'table.sheet', label: 'raw' },
      { page: admin, path: '/dashboard/calls?q=Raghav', table: 'table.sheet', label: 'calls' },
      { page: admin, path: '/dashboard/assignments?q=Raghav', table: 'table.sheet', label: 'assignments' },
      { page: admin, path: '/dashboard/batches/ai/' + batch, table: '.batch-grid table', label: 'ai-batch' },
      { page: admin, path: '/dashboard/batches/manual/legacy', table: '.batch-grid table', label: 'manual-batch' },
      { page: admin, path: '/dashboard/team?metric=attempts&date_from=2026-01-01&date_to=2099-01-01', table: '.team-evidence-grid table', label: 'team-evidence' },
    ];
    for (const { page, path, table: selector, label } of cases) {
      await page.goto(path);
      const table = page.locator(selector);
      const card = table.locator('.contact-card').filter({ hasText: 'Raghav Sharma' }).first();
      await expect(table.getByRole('columnheader', { name: 'Contact', exact: true })).toBeAttached();
      await expect(table.getByRole('columnheader', { name: /^(Who|Owner|Phone|Number)$/ })).toHaveCount(0);
      // AI batches retain their existing normalized contact-number format.
      const displayedPhone = label === 'ai-batch' ? '9811100001' : phone;
      await expect(card.locator('.contact-card-phone')).toContainText(displayedPhone);
      await card.getByRole('button', { name: 'Copy phone number', exact: true }).click();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(displayedPhone);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      const details = card.getByRole('button', { name: /^Details for/ });
      // The whole card is the trigger, including its padding and phone text.
      // Copy remains a separate button, not nested inside the opening button.
      await expect(details.locator('button')).toHaveCount(0);
      await expect(card.getByText('Details', { exact: true })).toHaveCount(0);
      const bounds = await card.boundingBox(), hitArea = await details.boundingBox();
      expect(bounds!.width, `${label}: compact contact card`).toBeLessThanOrEqual(240);
      expect(hitArea!.width).toBeGreaterThanOrEqual(bounds!.width - 2);
      expect(hitArea!.height).toBeGreaterThanOrEqual(bounds!.height - 2);
      await card.click({ position: { x: 8, y: 8 } });
      const dialog = page.getByRole('dialog');
      await expect(dialog).toHaveAccessibleName('Raghav Sharma');
      await expect(dialog.getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute('aria-selected', 'true');
      await expect(dialog.locator('.detail-contact-bar')).toContainText(phone);
      await page.keyboard.press('Escape');
      await expect(details).toBeFocused();
      await page.keyboard.press('Space');
      await expect(dialog.getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute('aria-selected', 'true');
      await page.keyboard.press('Escape');
      await expect(details).toBeFocused();
      // Clicking the phone text itself also follows the card's opening action.
      const number = await card.locator('.copytext-v').boundingBox();
      await page.mouse.click(number!.x + 4, number!.y + number!.height / 2);
      await expect(dialog).toHaveAccessibleName('Raghav Sharma');
      await page.keyboard.press('Escape');
      await expect(details).toBeFocused();
      expect(new URL(page.url()).pathname).toBe(path.split('?')[0]);
      const geometry = await card.evaluate(element => ({ content: element.scrollWidth, width: element.clientWidth }));
      expect(geometry.content, label).toBeLessThanOrEqual(geometry.width + 1);
      expect(await bodyOverflowsX(page), label).toBe(false);
      await shot(page, `contact-${label}-${width}`);
    }
  });
}

test('search highlights preserve the copied number, inbound contacts use the caller, and missing values stay readable', async ({ adminPage: page, shot }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  for (const path of ['raw', 'calls']) {
    await page.goto(`/dashboard/${path}?q=9811100001`);
    const card = page.locator('.contact-card').first();
    await expect(card.locator('.contact-card-phone mark')).toHaveText('9811100001');
    await card.getByRole('button', { name: 'Copy phone number' }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(phone);
  }
  sql(`update bolna_call_logs set call_type='inbound',from_number='${phone}',to_number='+918000000000' where id='${call}';
    update raw_records set owner_name=null where source_record_id='G-2';`);
  await page.goto('/dashboard/calls?q=9811100001');
  for (const card of await page.locator('.contact-card').all()) {
    await expect(card.locator('.copytext-v')).toHaveText(phone);
  }
  await page.goto('/dashboard/raw?has_phone=0');
  const empty = page.locator('.contact-card').first();
  await expect(empty).toContainText('Unnamed contact');
  await expect(empty).toContainText('No phone number');
  await expect(empty.getByRole('button', { name: 'Copy phone number' })).toHaveCount(0);
  await expect(empty.getByRole('button', { name: 'Details for record' })).toBeVisible();
  await expect(page.locator('input.rowsel').first()).toBeDisabled();
  sql(`update raw_records set owner_name=repeat('Long contact name ',8) where id='${record}';`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard/raw?q=9811100001');
  const long = page.locator('.contact-card');
  expect(await long.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  expect((await long.boundingBox())!.height, 'long names do not expand the compact card').toBeLessThanOrEqual(60);
  await shot(page, 'contact-long-name-390');
  await long.getByRole('button', { name: 'Details for record' }).click();
  await expect(page.getByRole('dialog').getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('old Raw Dataset contact-type preferences cannot hide the new identity card', async ({ adminPage: page }) => {
  await page.goto('/dashboard/raw');
  await page.evaluate(() => localStorage.setItem('dashboard-hidden-v1:/dashboard/raw', JSON.stringify([
    'Owner', 'Phone', 'Contact', 'State', 'Address', 'Record ID', 'Last Status', 'Last Result', 'Last Called', 'Transcript', 'Audio', 'Notes',
  ])));
  await page.reload();
  await expect(page.getByRole('columnheader', { name: 'Contact', exact: true })).toBeVisible();
  await expect(page.locator('th[data-column="Contact type"]')).toBeHidden();
  await page.locator('details.column-menu:not(.views-menu) summary').click();
  const options = page.locator('details.column-menu:not(.views-menu)');
  await expect(options.getByRole('checkbox', { name: 'Contact', exact: true })).toHaveCount(0);
  await options.getByRole('checkbox', { name: 'Contact type', exact: true }).check();
  await page.reload();
  await expect(page.getByRole('columnheader', { name: 'Contact type', exact: true })).toBeVisible();
  await expect(page.locator('.contact-card').first()).toContainText('+91');
});
