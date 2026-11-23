import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { CONTAINER } from '../lib/env.mjs';

const sql = (statement: string) => execFileSync('podman', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-c', statement]);
const panel = (page: Page) => page.getByRole('complementary');
const card = (page: Page) => page.locator('.board-columns .board-card').filter({ hasText: 'Raghav Sharma' });
const column = (page: Page, stage: string) => page.locator(`.board-column[data-stage="${stage}"]`);
const stage = (page: Page) => panel(page).getByRole('combobox', { name: 'Stage', exact: true });
const notes = (page: Page) => panel(page).getByRole('textbox', { name: 'Your notes', exact: true });
const saved = (page: Page, path: string) => page.waitForResponse(r => new URL(r.url()).pathname === `/api/board/${path}` && r.request().method() !== 'GET');
const gate = () => { let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; }); return { wait, release }; };

test('notes, moves, dates and call logging update from the save without reloading the page', async ({ employeePage: page }) => {
  await page.goto('/dashboard/board');
  const freshness = page.locator('.freshness');
  const loadedAt = await freshness.textContent();
  await page.clock.setFixedTime(Date.now() + 120_000);
  await card(page).click();
  await expect(freshness).toHaveText(loadedAt!);
  const refreshes: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/dashboard/board' && request.headers().rsc === '1') refreshes.push(request.url());
  });
  await notes(page).fill('Saved with the returned revisions');
  let response = saved(page, 'tasks/1');
  await panel(page).getByRole('button', { name: 'Save notes' }).click();
  const first = await response;
  expect(first.status()).toBe(200);
  expect(first.request().headers()).toHaveProperty('x-board-view');
  const firstSave = await first.json();
  expect(firstSave.boardView.board.columns[0].cards[0].tasks.find((task: { id: string }) => task.id === '1').revision).toBe(1);
  await expect(panel(page).locator('.board-task-status')).toHaveText('Saved');
  const savedAt = new Date(firstSave.boardSavedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  await expect(freshness).toContainText(`Updated ${savedAt} IST`);

  await stage(page).selectOption('details_collected');
  response = saved(page, 'move');
  await panel(page).getByRole('button', { name: 'Move to Details' }).click();
  expect((await response).status()).toBe(200);
  await expect(column(page, 'details_collected').locator('.board-card')).toContainText('Raghav Sharma');
  await expect(column(page, 'inbound').locator('.board-column-count')).toHaveText('0');

  await panel(page).getByLabel('Next follow-up').fill(new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10));
  response = saved(page, 'follow-up');
  await panel(page).getByRole('button', { name: 'Save follow-up' }).click();
  expect((await response).status()).toBe(200);
  await expect(card(page)).toContainText('Follow up');
  response = saved(page, 'no-answer');
  await panel(page).getByRole('button', { name: 'Log a no-answer call' }).click();
  const logged = await response;
  expect(logged.status()).toBe(200);
  const current = (await logged.json()).boardView.board.columns.flatMap((c: { cards: unknown[] }) => c.cards);
  expect(current.find((c: { name: string }) => c.name === 'Raghav Sharma').tasks.find((t: { id: string }) => t.id === '1').revision).toBe(4);
  await expect(panel(page).locator('.board-panel-status')).toContainText('1 of 5 strikes');
  await expect(panel(page).locator('.board-timeline')).toContainText('Saved with the returned revisions');
  expect(refreshes).toEqual([]);
});

test('a pending drag cannot resubmit old revisions, and the next drag uses the saved revisions', async ({ employeePage: page }) => {
  await page.goto('/dashboard/board');
  const hold = gate(), reached = gate();
  let moves = 0;
  await page.route('**/api/board/move', async route => {
    moves++;
    const response = await route.fetch();
    if (moves === 1) { reached.release(); await hold.wait; }
    await route.fulfill({ response });
  });
  try {
    await card(page).dragTo(column(page, 'awaiting_details'));
    await reached.wait;
    await expect(card(page)).toHaveAttribute('draggable', 'false');
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    const identity = await card(page).getAttribute('data-card-id');
    await transfer.evaluate((data, id) => data.setData('application/x-callongo-card', id!), identity);
    await column(page, 'details_collected').dispatchEvent('drop', { dataTransfer: transfer });
    expect(moves).toBe(1);
  } finally { hold.release(); }
  await expect(column(page, 'awaiting_details').locator('.board-card')).toContainText('Raghav Sharma');
  await expect(card(page)).toHaveAttribute('draggable', 'true');
  const response = saved(page, 'move');
  await card(page).dragTo(column(page, 'details_collected'));
  expect((await response).status()).toBe(200);
  await expect(column(page, 'details_collected').locator('.board-card')).toContainText('Raghav Sharma');
  expect(moves).toBe(2);
});

test('a notes edit updates filtered membership and the total without a page refresh', async ({ employeePage: page }) => {
  sql("update bolna_assignments set remarks='match-this-note' where id=1");
  await page.goto('/dashboard/board?q=match-this-note');
  await card(page).click();
  await notes(page).fill('Different notes');
  const response = saved(page, 'tasks/1');
  await panel(page).getByRole('button', { name: 'Save notes' }).click();
  expect((await response).status()).toBe(200);
  await expect(page.locator('.board-summary')).toHaveText('0 cards');
  await expect(page.locator('.board-card')).toHaveCount(0);
  await expect(panel(page)).toHaveCount(0);
  await expect(page).toHaveURL(/q=match-this-note/);
});

test('moving a paged card refills its source column and retains the requested limits', async ({ employeePage: page }) => {
  sql(`insert into raw_records(id,source,source_record_id,owner_name)
    select md5('board-paging-'||i)::uuid,'board-paging',i::text,'Paging '||i from generate_series(1,60) i;
    insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state,stage)
    select 'record',id,'priya@eval.test','admin@eval.test','open','inbound' from raw_records where source='board-paging'`);
  await page.goto('/dashboard/board?q=Paging');
  await expect(column(page, 'inbound').locator('.board-card')).toHaveCount(50);
  const first = column(page, 'inbound').locator('.board-card').first();
  const name = await first.locator('.board-card-name').textContent();
  await first.click();
  await stage(page).selectOption('details_collected');
  const response = saved(page, 'move');
  await panel(page).getByRole('button', { name: 'Move to Details' }).click();
  const result = await (await response).json();
  expect(result.boardView.board.columns[0]).toMatchObject({ total: 59, limit: 50 });
  await expect(column(page, 'inbound').locator('.board-card')).toHaveCount(50);
  await expect(column(page, 'details_collected').locator('.board-card')).toContainText(name!);
  await expect(page.locator('.board-summary')).toHaveText('60 cards');
});

test('a committed save with a failed snapshot refreshes once and prevents stale follow-up edits', async ({ employeePage: page }) => {
  await page.goto('/dashboard/board');
  await card(page).click();
  const hold = gate(), reached = gate();
  let writes = 0, refreshes = 0;
  await page.route('**/api/board/tasks/*', async route => {
    writes++;
    const response = await route.fetch();
    const body = await response.json();
    delete body.boardView;
    await route.fulfill({ response, json: { ...body, boardRefreshFailed: true } });
  });
  await page.route('**/dashboard/board*', async route => {
    if (route.request().headers().rsc === '1') { refreshes++; reached.release(); await hold.wait; }
    await route.continue();
  });
  try {
    await notes(page).fill('Committed once');
    await panel(page).getByRole('button', { name: 'Save notes' }).click();
    await reached.wait;
    await expect(panel(page).locator('.board-task-status')).toHaveText('Saved');
    await expect(stage(page)).toBeDisabled();
    expect(writes).toBe(1);
  } finally { hold.release(); }
  await expect(stage(page)).toBeEnabled();
  await expect(notes(page)).toHaveValue('Committed once');
  await stage(page).selectOption('details_collected');
  const response = saved(page, 'move');
  await panel(page).getByRole('button', { name: 'Move to Details' }).click();
  expect((await response).status()).toBe(200);
  expect(refreshes).toBe(1);
  expect(writes).toBe(1);
});

test('a late save response cannot replace another employee perspective', async ({ adminPage: page }) => {
  await page.goto('/dashboard/board?employee=priya%40eval.test');
  await card(page).click();
  await stage(page).selectOption('details_collected');
  const hold = gate(), reached = gate();
  await page.route('**/api/board/move?*', async route => {
    const response = await route.fetch(); reached.release(); await hold.wait;
    await route.fulfill({ response });
  });
  try {
    await panel(page).getByRole('button', { name: 'Move to Details' }).click();
    await page.getByRole('dialog', { name: 'Edit this entry?', exact: true }).getByRole('button', { name: 'Confirm and save' }).click();
    await reached.wait;
    await page.getByLabel('View work as', { exact: true }).selectOption('raj@eval.test');
    await expect(page).toHaveURL(/employee=raj/);
    await expect(page.locator('.board-columns')).toContainText('Suresh Kumar');
  } finally { hold.release(); }
  await expect(page.locator('.board-columns')).not.toContainText('Raghav Sharma');
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByLabel('View work as', { exact: true })).toHaveValue('raj@eval.test');
});

test('Back navigation retains a saved move and its revisions', async ({ employeePage: page }) => {
  await page.goto('/dashboard/board');
  await card(page).click();
  await stage(page).selectOption('details_collected');
  const moved = saved(page, 'move');
  await panel(page).getByRole('button', { name: 'Move to Details' }).click();
  expect((await moved).status()).toBe(200);
  await expect(column(page, 'details_collected').locator('.board-card')).toContainText('Raghav Sharma');
  await page.locator('.topnav').getByRole('link', { name: 'My Work', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/my/);
  await page.goBack();
  await expect(page).toHaveURL(/\/dashboard\/board$/);
  await expect(column(page, 'details_collected').locator('.board-card')).toContainText('Raghav Sharma');
  await card(page).click();
  await notes(page).fill('Saved after returning to the board');
  const response = saved(page, 'tasks/1');
  await panel(page).getByRole('button', { name: 'Save notes' }).click();
  expect((await response).status()).toBe(200);
});

test('a late save response preserves filters applied while the save was pending', async ({ employeePage: page }) => {
  await page.goto('/dashboard/board');
  await card(page).click();
  await stage(page).selectOption('details_collected');
  const hold = gate(), reached = gate();
  await page.route('**/api/board/move', async route => {
    const response = await route.fetch(); reached.release(); await hold.wait;
    await route.fulfill({ response });
  });
  try {
    await panel(page).getByRole('button', { name: 'Move to Details' }).click();
    await reached.wait;
    await page.getByRole('searchbox').fill('no-matching-card');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page).toHaveURL(/q=no-matching-card/);
    await expect(page.locator('.board-summary')).toHaveText('0 cards');
  } finally { hold.release(); }
  await expect(page.locator('.board-summary')).toHaveText('0 cards');
  await expect(page.locator('.board-card')).toHaveCount(0);
  await expect(page).toHaveURL(/q=no-matching-card/);
});
