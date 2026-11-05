import { test, expect, bodyOverflowsX } from './fixtures';
import { execFileSync } from 'node:child_process';
import { CONTAINER } from '../lib/env.mjs';
import { unreadableText } from '../lib/visual-audit';

// Priya: Raghav (tasks 1 and 5, one phone) in 2C and Meera (task 2, done, WH 1008) in 4. Raj: Suresh (task 4) in RnR.
const sql = (statement: string) => execFileSync('podman', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-c', statement]);
const seed = () => sql(`update bolna_assignments set stage='awaiting_details' where id in (1,5);
  update bolna_assignments set stage='warehouse_created' where id=2; update bolna_assignments set stage='rnr' where id=4`);
const row = (page: any, name: string) => page.getByRole('row').filter({ has: page.getByRole('rowheader', { name }) });
const kpi = (page: any, label: string) => page.locator('.funnel-kpi').filter({ hasText: label });

test('admins open the funnel from the board and see each caller\'s leads by stage', async ({ adminPage: page, shot }) => {
  seed();
  await page.goto('/dashboard/board');
  await page.getByRole('navigation', { name: 'Board pages' }).getByRole('link', { name: 'Funnel' }).click();
  await expect(page).toHaveURL(/\/dashboard\/board\/funnel$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Funnel by caller');
  await expect(page.getByRole('columnheader')).toHaveText(['Caller', '1 Inbound', '2A RnR', '2B Rejected', '2C Awaiting', '3 Details', '4 Warehouse', '5 Junk', 'Leads', 'To warehouse', 'Warehouse IDs', 'Funnel mix']);
  await expect(row(page, 'Priya Eval').getByRole('cell')).toHaveText(['0', '0', '0', '1', '0', '1', '0', '2', '50%', '1', '']);
  await expect(row(page, 'Raj Eval').getByRole('cell')).toHaveText(['0', '1', '0', '0', '0', '0', '0', '1', '0%', '0', '']);
  await expect(row(page, 'All callers').getByRole('cell')).toHaveText(['0', '1', '0', '1', '0', '1', '0', '3', '33%', '1', '']);
  await expect(kpi(page, 'Total leads')).toContainText('3');
  await expect(kpi(page, 'Reached warehouse ID')).toContainText('33%');
  await expect(kpi(page, 'Warehouse IDs created')).toContainText('1');
  await expect(kpi(page, 'Awaiting details')).toContainText('1');
  await expect(page.locator('.funnel-note')).toHaveText('Credit for a warehouse ID goes to the caller whose lead reached stage 4.');
  await shot(page, 'board-funnel');
});

test('funnel filters change the numbers', async ({ adminPage: page }) => {
  seed();
  await page.goto('/dashboard/board/funnel?city=Delhi');
  await expect(row(page, 'Priya Eval').getByRole('cell').nth(7)).toHaveText('1');
  await expect(row(page, 'Raj Eval')).toHaveCount(0);
  await expect(row(page, 'All callers').getByRole('cell').nth(7)).toHaveText('1');
  await expect(page.getByRole('button', { name: 'Remove City filter: Delhi' })).toBeVisible();
});

test('a caller\'s name opens their board', async ({ adminPage: page }) => {
  seed();
  await page.goto('/dashboard/board/funnel');
  await page.getByRole('link', { name: 'Raj Eval' }).click();
  await expect(page).toHaveURL(/\/dashboard\/board\?assignee=raj%40eval\.test$/);
  await expect(page.locator('.board-columns .board-card')).toHaveText([/Suresh Kumar/]);
});

test('employees cannot open the funnel and see no funnel tab', async ({ employeePage: page }) => {
  await page.goto('/dashboard/board');
  await expect(page.getByRole('navigation', { name: 'Board pages' })).toHaveCount(0);
  await page.goto('/dashboard/board/funnel');
  await expect(page).toHaveURL(/\/dashboard\/my$/);
});

for (const theme of ['light', 'dark'] as const) {
  test(`the funnel stays readable on a laptop and a phone in the ${theme} theme`, async ({ adminPage: page, shot }) => {
    seed();
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/dashboard/board/funnel');
    if (theme === 'dark') { await page.locator('.theme-toggle').click(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark'); }
    expect(await unreadableText(page, '.dashboard-content')).toEqual([]);
    expect(await bodyOverflowsX(page)).toBe(false);
    await shot(page, `board-funnel-1366-${theme}`);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await bodyOverflowsX(page)).toBe(false);
    expect(await unreadableText(page, '.dashboard-content')).toEqual([]);
    await shot(page, `board-funnel-390-${theme}`);
  });
}
