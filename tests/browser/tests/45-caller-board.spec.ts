import { test, expect, bodyOverflowsX } from './fixtures';
import { execFileSync } from 'node:child_process';
import { CONTAINER } from '../lib/env.mjs';
import { unreadableText } from '../lib/visual-audit';

// Seed ids: 1 Raghav (priya, open listing), 2 Meera (priya, done, WH 1008),
// 3 Latha (priya, dropped), 4 Suresh (raj, open), 5 Raghav's AI follow-up (priya, open).
const sql = (statement: string) => execFileSync('podman', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-c', statement]);
const board = (page: any) => page.locator('.board-columns');
const column = (page: any, code: string) => page.locator(`.board-column[data-code="${code}"]`);
const card = (page: any, name: string) => board(page).locator('.board-card').filter({ hasText: name });
const STAGE_HEADINGS = ['1 Inbound', '2A RnR', '2B Unavailable / rejected', '2C Available, details awaited', '3 Details collected', '4 Warehouse ID created', '5 Junk'];

test('callers see their own work grouped by phone in seven stage columns', async ({ employeePage: page, shot }) => {
  await page.goto('/dashboard/board');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Board');
  await expect(board(page).getByRole('heading', { level: 2 })).toHaveText(STAGE_HEADINGS);
  // The open listing and the AI follow-up share one phone, so they form one card.
  await expect(column(page, '1').locator('.board-card')).toHaveCount(1);
  await expect(card(page, 'Raghav Sharma')).toContainText('2 tasks');
  await expect(card(page, 'Raghav Sharma')).toContainText('+919811100001');
  for (const hidden of ['Suresh Kumar', 'Meera Nair', 'Latha Menon']) await expect(card(page, hidden)).toHaveCount(0);
  await expect(page.locator('.board-strip [data-code="1"]')).toContainText('1');
  await expect(page.locator('.board-summary')).toHaveText('1 card');
  await expect(page.getByRole('link', { name: 'Board', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Toggle filters' }).click();
  await expect(page.getByRole('group', { name: 'Assigned to' })).toHaveCount(0);
  await shot(page, 'caller-board-employee');
});

// A phone-less listing, so it can be given to anyone without phone-ownership conflicts.
const ownTask = (assignee: string, stage: string, extra = '') => sql(`insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state,stage${extra ? ',next_due_at' : ''})
  values ('record','a0000000-0000-4000-8000-000000000006','${assignee}','admin@eval.test','open','${stage}'${extra ? `,${extra}` : ''})`);

test('cards show follow-up dates, overdue work, finished work and warehouse IDs', async ({ employeePage: page }) => {
  // Raghav's listing (RnR, worked last) and AI follow-up (Inbound) share a phone: one card, in RnR.
  // updated_at is set by the database, so work the follow-up first in its own transaction.
  sql(`update bolna_assignments set remarks='checked' where id=5`);
  sql(`update bolna_assignments set stage='rnr', next_due_at=now()-interval '1 day' where id=1;
       update bolna_assignments set stage='warehouse_created' where id=2`);
  ownTask('priya@eval.test', 'awaiting_details', "now()+interval '2 days'");
  await page.goto('/dashboard/board');
  await expect(card(page, 'Raghav Sharma')).toHaveCount(1);
  await expect(column(page, '2A').locator('.board-card')).toContainText('2 tasks');
  await expect(column(page, '2A').locator('.board-card')).toContainText('Overdue');
  await expect(column(page, '2C').locator('.board-card')).toContainText('Follow up');
  await expect(column(page, '2C').locator('.board-card .board-followup.overdue')).toHaveCount(0);
  const finished = card(page, 'Meera Nair');
  await expect(finished).toContainText('Closed');
  await expect(finished.locator('.board-wh')).toHaveText('1 warehouse');
});

test('the board is personal like My Work, for admins too', async ({ adminPage: page }) => {
  await page.goto('/dashboard/board');
  await expect(page.locator('.board-summary')).toHaveText('0 cards');
  for (const others of ['Suresh Kumar', 'Raghav Sharma']) await expect(card(page, others)).toHaveCount(0);
  await page.getByRole('button', { name: 'Toggle filters' }).click();
  await expect(page.getByRole('group', { name: 'Assigned to' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  // An assignee filter in the URL cannot widen the view either.
  ownTask('admin@eval.test', 'rnr');
  await page.goto('/dashboard/board?assignee=raj%40eval.test');
  await expect(page.locator('.board-summary')).toHaveText('1 card');
  await expect(card(page, 'No Phone Owner')).toHaveCount(1);
  await expect(card(page, 'No Phone Owner')).not.toContainText('Eval Admin');
  await expect(page.getByRole('navigation', { name: 'Board pages' }).getByRole('link', { name: 'Funnel' })).toBeVisible();
});

test('a column shows one page of cards and loads more on request', async ({ employeePage: page }) => {
  sql(`insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state,stage,updated_at)
       select 'record',gen_random_uuid(),'priya@eval.test','admin@eval.test','open','inbound',now()-make_interval(mins=>g) from generate_series(1,55) g`);
  await page.goto('/dashboard/board');
  const inbound = column(page, '1');
  await expect(inbound.locator('.board-card')).toHaveCount(50);
  await expect(inbound.locator('.board-column-count')).toHaveText('56');
  await inbound.getByRole('button', { name: 'Show 6 more' }).click();
  await expect(page).toHaveURL(/inbound_cards=100/);
  await expect(inbound.locator('.board-card')).toHaveCount(56);
  await expect(inbound.getByRole('button', { name: /Show \d+ more/ })).toHaveCount(0);
});

test('search and filters narrow every column and can be cleared', async ({ employeePage: page }) => {
  sql(`update bolna_assignments set stage='rejected' where id=2`);
  await page.goto('/dashboard/board');
  await expect(page.locator('.board-summary')).toHaveText('2 cards');
  await page.getByRole('searchbox', { name: 'Search the board' }).fill('Meera');
  await page.getByRole('button', { name: 'Apply' }).first().click();
  await expect(page).toHaveURL(/q=Meera/);
  await expect(page.locator('.board-summary')).toHaveText('1 card');
  await expect(card(page, 'Meera Nair')).toHaveCount(1);
  await expect(column(page, '1').locator('.board-empty')).toHaveText('No cards');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.locator('.board-summary')).toHaveText('2 cards');
  await page.goto('/dashboard/board?city=Delhi');
  await expect(page.locator('.board-summary')).toHaveText('1 card');
  await expect(page.getByRole('button', { name: 'Remove City filter: Delhi' })).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  test(`the board stays readable on a laptop and a phone in the ${theme} theme`, async ({ employeePage: page, shot }) => {
    sql(`update bolna_assignments set stage='rnr', next_due_at=now()-interval '1 day' where id=1;
         update bolna_assignments set stage='warehouse_created' where id=2`);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/dashboard/board');
    if (theme === 'dark') { await page.locator('.theme-toggle').click(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark'); }
    expect(await unreadableText(page, '.dashboard-content')).toEqual([]);
    // Seven columns scroll inside the board, never the page.
    expect(await bodyOverflowsX(page)).toBe(false);
    await shot(page, `caller-board-1366-${theme}`);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(board(page)).toBeVisible();
    expect(await bodyOverflowsX(page)).toBe(false);
    expect(await unreadableText(page, '.dashboard-content')).toEqual([]);
    await shot(page, `caller-board-390-${theme}`);
  });
}
