import { test, expect, bodyOverflowsX } from './fixtures';
import { unreadableText } from '../lib/visual-audit';
import type { Page } from '@playwright/test';
import type { QueueSel } from '../../../src/lib/queue';

const contact = (number: number, overrides: Partial<QueueSel> = {}): QueueSel => ({
  id: `a0000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
  name: `Warehouse contact ${number}`, contact: `+91989999${String(number).padStart(4, '0')}`,
  area: 'Pune', state: 'Maharashtra', cat: '', queued: false, ...overrides,
});

async function openPreview(page: Page, rows: QueueSel[]) {
  await page.route('**/api/raw/queue', route => route.fulfill({ json: { rows, total: rows.length, skippedNoPhone: 0, capped: false } }));
  await page.goto('/dashboard/raw');
  await page.locator('.rowsel').first().check();
  await page.getByRole('button', { name: /^Queue for calling/ }).click();
  await expect(page.getByRole('region', { name: 'Calling summary' })).toBeVisible();
  return page.getByRole('dialog', { name: 'Queue for calling', exact: true });
}

async function fitsViewport(page: Page) {
  expect(await bodyOverflowsX(page)).toBe(false);
  const geometry = await page.locator('dialog[open]').evaluate(element => ({
    width: element.clientWidth, content: element.scrollWidth,
    footer: element.querySelector('.modal-foot')!.getBoundingClientRect().bottom, height: innerHeight,
  }));
  expect(geometry.content).toBeLessThanOrEqual(geometry.width + 1);
  expect(geometry.footer).toBeLessThanOrEqual(geometry.height);
  expect(await unreadableText(page)).toEqual([]);
}

for (const width of [1366, 390]) for (const theme of ['light', 'dark']) {
  test(`queued contacts give a clear next step at ${width}px in ${theme}`, async ({ adminPage: page, shot }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 768 });
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    const dialog = await openPreview(page, [
      contact(1, { name: 'North Warehouse', cat: 'unclear', queued: true }),
      contact(2, { name: 'South Warehouse', area: 'Bengaluru', state: 'Karnataka', queued: true }),
    ]);
    await expect(dialog.getByRole('heading', { name: 'No contacts ready to call' })).toBeVisible();
    await expect(dialog.locator('.queue-skipped')).toHaveText('2 already queued');
    await expect(dialog.getByRole('button', { name: 'Recent batches', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Send to Bolna|Download CSV/ })).toHaveCount(0);
    await expect(dialog.locator('details[open]')).toHaveCount(0);
    await expect(dialog.getByLabel('Call language')).toBeHidden();
    await fitsViewport(page);
    await shot(page, `queue-blocked-${width}-${theme}`);

    await dialog.locator('.queue-contacts summary').click();
    await expect(dialog.getByRole('list', { name: 'Contact review' }).getByText('Already queued', { exact: true })).toHaveCount(2);
    await fitsViewport(page);
    await shot(page, `queue-blocked-contacts-${width}-${theme}`);
    await dialog.locator('.modal-foot').getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Queue for calling/ })).toBeFocused();
  });
}

test('outcome and language changes update eligibility and require a fresh confirmation', async ({ adminPage: page, shot }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = await openPreview(page, [
    contact(1, { name: 'North Warehouse', cat: 'unclear' }),
    contact(2, { name: 'South Warehouse', area: 'Bengaluru', state: 'Karnataka' }),
    contact(3, { name: 'Queued Warehouse', cat: 'available', queued: true }),
    contact(4, { name: 'Assigned Warehouse', cat: 'unavailable', owners: [{ email: 'priya@eval.test', name: 'Priya', state: 'open', outcome: null }] }),
  ]);
  let dispatched = 0;
  await page.route('**/api/raw/dispatch', route => { dispatched++; return route.abort(); });
  const ready = (count: number) => dialog.getByRole('heading', { name: `${count} ready to call`, exact: true });
  await expect(ready(2)).toBeVisible();
  await fitsViewport(page);
  await shot(page, 'queue-ready-390-light');
  await dialog.getByRole('button', { name: 'Send to Bolna (2)', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Yes, place calls', exact: true })).toBeVisible();
  await expect(dialog.locator('.queue-repeat-confirm')).toContainText('1 previously called');
  expect(dispatched).toBe(0);
  await fitsViewport(page);
  await shot(page, 'queue-confirm-390-light');

  await dialog.getByLabel('Call language', { exact: true }).selectOption('hindi');
  await expect(ready(1)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Yes, place calls', exact: true })).toHaveCount(0);
  await dialog.locator('.queue-previous summary').click();
  await dialog.getByRole('checkbox', { name: 'Unclear', exact: false }).uncheck();
  await expect(dialog.getByRole('heading', { name: 'No contacts ready to call' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Send to Bolna|Download CSV/ })).toHaveCount(0);
  await dialog.locator('.queue-contacts summary').click();
  for (const [name, reason] of [
    ['North Warehouse', 'Excluded by outcome'], ['South Warehouse', 'Agent unavailable'],
    ['Queued Warehouse', 'Already queued'], ['Assigned Warehouse', 'Assigned to Priya'],
  ]) await expect(dialog.getByRole('listitem').filter({ hasText: name })).toContainText(reason);
  await fitsViewport(page);
  await shot(page, 'queue-reasons-390-light');

  await dialog.getByRole('checkbox', { name: 'Unclear', exact: false }).check();
  await dialog.getByLabel('Call language', { exact: true }).selectOption('auto');
  await expect(ready(2)).toBeVisible();
  await dialog.getByRole('button', { name: 'Send to Bolna (2)', exact: true }).click();
  await dialog.getByRole('button', { name: 'Exclude all called', exact: true }).click();
  await expect(ready(1)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Yes, place calls', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Re-include all called', exact: true }).click();
  await expect(ready(2)).toBeVisible();
  expect(dispatched).toBe(0);
});

test('long contact reviews keep every contact reachable and the footer visible', async ({ adminPage: page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = await openPreview(page, Array.from({ length: 27 }, (_, index) => contact(index + 1)));
  await dialog.locator('.queue-contacts summary').click();
  const contacts = dialog.getByRole('list', { name: 'Contact review' });
  await expect(contacts.getByRole('listitem')).toHaveCount(25);
  await dialog.getByRole('button', { name: 'Next contacts', exact: true }).click();
  await expect(contacts.getByRole('listitem')).toHaveCount(2);
  await expect(contacts).toContainText('Warehouse contact 27');
  await expect(dialog.getByRole('button', { name: 'Next contacts', exact: true })).toBeDisabled();
  await fitsViewport(page);
  await dialog.getByRole('button', { name: 'Previous contacts', exact: true }).click();
  await expect(contacts.getByRole('listitem')).toHaveCount(25);
  await expect(dialog.getByRole('button', { name: 'Send to Bolna (27)', exact: true })).toBeInViewport();
});

test('compact wallet keeps low and stale states visible and refresh available', async ({ adminPage: page }) => {
  let state = 'low';
  await page.route('**/api/balance*', route => route.fulfill({ json: state === 'low'
    ? { balance: 0, unit: 'USD', state: 'stale', low: true, refreshedAt: '2026-10-10T00:00:00Z', message: 'Last known balance' }
    : { balance: 100, unit: 'USD', state: 'fresh', low: false, refreshedAt: '2026-10-12T00:00:00Z', message: null } }));
  const dialog = await openPreview(page, [contact(1)]);
  const balance = dialog.getByRole('complementary', { name: 'Bolna balance' });
  await expect(balance).toContainText('$0.00 USD');
  await expect(balance.getByText('Low balance', { exact: true })).toBeVisible();
  await expect(balance.getByText('Stale', { exact: true })).toBeVisible();
  await expect(balance.getByRole('button', { name: 'Refresh balance', exact: true })).toBeVisible();
  await expect(balance).toHaveAttribute('title',/Last known balance/);
  state = 'fresh';
  await balance.getByRole('button', { name: 'Refresh balance', exact: true }).click();
  await expect(balance).toContainText('$100.00 USD');
  await expect(balance.getByText('Low balance', { exact: true })).toHaveCount(0);
  await expect(balance.getByText('Stale', { exact: true })).toHaveCount(0);
});

test('completed ownership remains inspectable without holding an eligible contact', async ({ adminPage: page }) => {
  const dialog = await openPreview(page, [contact(1, {
    owners: [{ email: 'priya@eval.test', name: 'Priya', state: 'done', outcome: 'Available' }],
  })]);
  await expect(dialog.getByRole('heading', { name: '1 ready to call', exact: true })).toBeVisible();
  await dialog.getByText('Selection details', { exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'Calling ownership preview' })).toContainText('Priya: done · Available');
  await expect(dialog.getByRole('button', { name: 'Send to Bolna (1)', exact: true })).toBeEnabled();
});
