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
// As on My Work: two quick filters, the rest behind "More filters".
const QUICK_FILTERS = ['Work type', 'Follow-up'];
const MORE_FILTERS = ['City', 'State', 'Assigned by', 'Assignment batch', 'Last updated'];
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
  // My Work-style filter dropdowns sit in the toolbar where the count strip used to be.
  await expect(page.locator('.board-strip')).toHaveCount(0);
  for (const name of QUICK_FILTERS) await expect(page.getByRole('combobox', { name, exact: true })).toBeVisible();
  for (const name of MORE_FILTERS) await expect(page.getByRole('combobox', { name, exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'More filters' }).click();
  await expect(page.getByRole('button', { name: 'More filters' })).toHaveAttribute('aria-expanded', 'true');
  for (const name of MORE_FILTERS) await expect(page.getByRole('combobox', { name, exact: true })).toBeVisible();
  await expect(page.locator('.board-summary')).toHaveText('1 card');
  await expect(page.getByRole('link', { name: 'Board', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('combobox', { name: 'Assigned to' })).toHaveCount(0);
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
  await expect(page.getByRole('combobox', { name: 'Assigned to' })).toHaveCount(0);
  // An assignee filter in the URL cannot widen the view either.
  ownTask('admin@eval.test', 'rnr');
  await page.goto('/dashboard/board?assignee=raj%40eval.test');
  await expect(page.locator('.board-summary')).toHaveText('1 card');
  await expect(card(page, 'No Phone Owner')).toHaveCount(1);
  await expect(card(page, 'No Phone Owner')).not.toContainText('Eval Admin');
  await expect(page.getByRole('navigation', { name: 'Board pages' }).getByRole('link', { name: 'Funnel' })).toBeVisible();
});

/** Open tasks with no listing behind them: each is its own card in Inbound. */
const seedInbound = (count: number) => sql(`insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state,stage,updated_at)
     select 'record',gen_random_uuid(),'priya@eval.test','admin@eval.test','open','inbound',now()-make_interval(mins=>g) from generate_series(1,${count}) g`);
const scrollToEnd = (list: any) => list.evaluate((node: HTMLElement) => node.scrollTo({ top: node.scrollHeight }));

test('scrolling to the end of a column loads its next page in place', async ({ employeePage: page }) => {
  seedInbound(55);
  await page.goto('/dashboard/board');
  const inbound = column(page, '1');
  const list = inbound.locator('.board-cards');
  await expect(inbound.locator('.board-card')).toHaveCount(50);
  await expect(inbound.locator('.board-column-count')).toHaveText('56');
  await expect(inbound.locator('.board-column-progress')).toHaveText('Showing 50 of 56');
  // There is no button to press: reaching the end is the request.
  await expect(inbound.getByRole('button', { name: /more/i })).toHaveCount(0);
  const before = await page.evaluate(() => history.length);
  await scrollToEnd(list);
  await expect(inbound.locator('.board-card')).toHaveCount(56);
  await expect(page).toHaveURL(/inbound_cards=100/);
  // The page replaces the URL, so Back leaves the board instead of unloading cards.
  expect(await page.evaluate(() => history.length)).toBe(before);
  // The list keeps its place, and the progress line goes once everything is shown.
  expect(await list.evaluate((node: HTMLElement) => node.scrollTop)).toBeGreaterThan(0);
  await expect(inbound.locator('.board-column-progress')).toHaveCount(0);
  // Other columns are untouched.
  await expect(page).not.toHaveURL(/rnr_cards/);
});

test('each column pages on its own, even when two reach their end together', async ({ employeePage: page }) => {
  seedInbound(55);
  sql(`insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state,stage,updated_at)
       select 'record',gen_random_uuid(),'priya@eval.test','admin@eval.test','open','rnr',now()-make_interval(mins=>g) from generate_series(1,70) g;
       insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state,stage,updated_at)
       select 'record',gen_random_uuid(),'priya@eval.test','admin@eval.test','open','awaiting_details',now()-make_interval(mins=>g) from generate_series(1,60) g`);
  await page.goto('/dashboard/board');
  const inbound = column(page, '1'), rnr = column(page, '2A'), awaiting = column(page, '2C');
  await expect(rnr.locator('.board-card')).toHaveCount(50);
  // A third column scrolled part-way keeps its cards and its place.
  await awaiting.locator('.board-cards').evaluate((node: HTMLElement) => { node.scrollTop = 300; });
  // Both lists reach their end in the same frame.
  await page.evaluate(() => document.querySelectorAll<HTMLElement>('[data-code="1"] .board-cards, [data-code="2A"] .board-cards')
    .forEach(node => node.scrollTo({ top: node.scrollHeight })));
  await expect(inbound.locator('.board-card')).toHaveCount(56);
  await expect(rnr.locator('.board-card')).toHaveCount(70);
  await expect(page).toHaveURL(/inbound_cards=100/);
  await expect(page).toHaveURL(/rnr_cards=100/);
  await expect(page).not.toHaveURL(/awaiting_details_cards/);
  await expect(awaiting.locator('.board-card')).toHaveCount(50);
  await expect(awaiting.locator('.board-column-progress')).toHaveText('Showing 50 of 60');
  expect(await awaiting.locator('.board-cards').evaluate((node: HTMLElement) => node.scrollTop)).toBe(300);
});

test('keyboard focus reaching the last card loads the next page too', async ({ employeePage: page }) => {
  seedInbound(60);
  await page.goto('/dashboard/board');
  const inbound = column(page, '1');
  await expect(inbound.locator('.board-card')).toHaveCount(50);
  await inbound.locator('.board-card').last().focus();
  await expect(inbound.locator('.board-card')).toHaveCount(61);
  await expect(inbound.locator('.board-card').nth(49)).toBeFocused();
});

test('a column stops at the ceiling and says how to find the rest', async ({ employeePage: page }) => {
  seedInbound(505);
  await page.goto('/dashboard/board?inbound_cards=500');
  const inbound = column(page, '1');
  await expect(inbound.locator('.board-card')).toHaveCount(500);
  await expect(inbound.locator('.board-column-progress')).toHaveText('Showing the first 500 of 506. Search or filter to find the rest.');
  await scrollToEnd(inbound.locator('.board-cards'));
  await expect(page).toHaveURL(/inbound_cards=500$/);
  await expect(inbound.locator('.board-card')).toHaveCount(500);
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
  await page.getByRole('button', { name: 'More filters' }).click();
  await page.getByRole('combobox', { name: 'City', exact: true }).selectOption('Delhi');
  await page.getByRole('button', { name: 'Apply' }).first().click();
  await expect(page).toHaveURL(/city=Delhi/);
  await expect(page.locator('.board-summary')).toHaveText('1 card');
  await expect(page.getByRole('button', { name: 'Remove City filter: Delhi' })).toBeVisible();
  // An active "more" filter keeps its section open, and a quick filter keeps it applied.
  await expect(page.getByRole('combobox', { name: 'City', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Work type' }).selectOption('record');
  await page.getByRole('button', { name: 'Apply' }).first().click();
  await expect(page).toHaveURL(/city=Delhi/);
  await expect(page).toHaveURL(/type=record/);
});

test('work type and follow-up dropdowns narrow the board like My Work', async ({ employeePage: page }) => {
  sql(`update bolna_assignments set next_due_at=now()-interval '1 hour' where id=5`);
  await page.goto('/dashboard/board');
  await page.getByRole('combobox', { name: 'Work type' }).selectOption('call');
  await page.getByRole('button', { name: 'Apply' }).first().click();
  await expect(page).toHaveURL(/type=call/);
  // Raghav's card keeps only its AI follow-up task.
  await expect(card(page, 'Raghav Sharma')).not.toContainText('2 tasks');
  await page.goto('/dashboard/board?follow_up=none');
  await expect(page.locator('.board-summary')).toHaveText('1 card');
  await expect(card(page, 'Raghav Sharma')).not.toContainText('Overdue');
  await page.goto('/dashboard/board?follow_up=overdue');
  await expect(card(page, 'Raghav Sharma')).toContainText('Overdue');
  await expect(page.getByRole('button', { name: 'Remove Follow-up filter: overdue' })).toHaveText(/Follow-up: Overdue/);
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
