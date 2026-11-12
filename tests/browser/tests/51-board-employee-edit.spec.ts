import { test, expect, bodyOverflowsX } from './fixtures';
import type { Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { EMPLOYEE, EMPLOYEE2, CONTAINER } from '../lib/env.mjs';

const perspective = `/dashboard/board?${new URLSearchParams({ employee: EMPLOYEE.email })}`;
const sql = (statement: string) => execFileSync('podman', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', '-c', statement], { encoding: 'utf8' }).trim();
const card = (page: Page) => page.locator('.board-columns .board-card').filter({ hasText: 'Raghav Sharma' });
const panel = (page: Page) => page.getByRole('complementary');
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Edit this entry?', exact: true });
const notes = (page: Page) => panel(page).getByRole('textbox', { name: 'Employee notes' });
const saveNotes = (page: Page) => panel(page).getByRole('button', { name: 'Save notes', exact: true });
async function confirmSave(page: Page, path: string, action: () => Promise<unknown>, status = 200) {
  await action();
  await expect(dialog(page)).toBeVisible();
  return save(page, path, () => dialog(page).getByRole('button', { name: 'Confirm and save', exact: true }).click(), status);
}
async function save(page: Page, path: string, action: () => Promise<unknown>, status = 200) {
  const response = page.waitForResponse(r => new URL(r.url()).pathname === `/api/board/${path}` && r.request().method() !== 'GET');
  await action();
  const result = await response;
  expect(result.status()).toBe(status);
  expect(new URL(result.url()).searchParams.get('employee')).toBe(EMPLOYEE.email);
  return result;
}

test('normal controls ask once per entry and cancel or Escape preserves the draft without writing', async ({ adminPage: page }) => {
  const writes: string[] = [];
  page.on('request', req => { if (req.url().includes('/api/board/') && req.method() !== 'GET') writes.push(req.url()); });
  await page.goto(perspective);
  await expect(page.getByRole('button', { name: /Edit employee.s work|Enable editing/ })).toHaveCount(0);
  await card(page).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(card(page)).toHaveAttribute('draggable', 'true');
  await expect(notes(page)).toBeEditable();
  await expect(panel(page).getByLabel('Stage', { exact: true })).toBeEnabled();
  await notes(page).fill('Draft awaiting entry confirmation');
  for (const cancel of ['button', 'Escape']) {
    await saveNotes(page).click();
    await expect(dialog(page)).toContainText('Priya Eval');
    await expect(dialog(page)).toContainText('Raghav Sharma');
    await expect(dialog(page)).toContainText('recorded as your edits');
    expect(writes).toEqual([]);
    if (cancel === 'button') await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    else await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(saveNotes(page)).toBeFocused();
    await expect(notes(page)).toHaveValue('Draft awaiting entry confirmation');
    await expect(panel(page).locator('.board-task-status')).not.toHaveText('Saved');
    expect(sql('select revision from bolna_assignments where id=1')).toBe('0');
  }
  await confirmSave(page, 'tasks/1', () => saveNotes(page).click());
  await expect(panel(page).locator('.board-timeline')).toContainText('Draft awaiting entry confirmation');
  await notes(page).fill('Second edit to the same entry');
  await save(page, 'tasks/1', () => saveNotes(page).click());
  await expect(dialog(page)).toHaveCount(0);
  expect(writes).toHaveLength(2);
});

test('confirming one entry never unlocks another, and closing a card retains its confirmation', async ({ adminPage: page }) => {
  const id = sql("insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state) values ('record','a0000000-0000-4000-8000-000000000006','priya@eval.test','admin@eval.test','open') returning id").split('\n')[0];
  const other = page.locator('.board-columns .board-card').filter({ hasText: 'No Phone Owner' });
  await page.goto(perspective);
  await card(page).click();
  await notes(page).fill('First card confirmed');
  await confirmSave(page, 'tasks/1', () => saveNotes(page).click());
  await expect(panel(page).locator('.board-timeline')).toContainText('First card confirmed');
  await panel(page).getByRole('button', { name: 'Close lead' }).click();
  await other.click();
  await notes(page).fill('Other entry needs its own confirmation');
  await saveNotes(page).click();
  await expect(dialog(page)).toContainText('No Phone Owner');
  await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(sql(`select revision from bolna_assignments where id=${id}`)).toBe('0');
  await panel(page).getByRole('button', { name: 'Discard draft', exact: true }).click();
  await card(page).click();
  await notes(page).fill('First card still confirmed');
  await save(page, 'tasks/1', () => saveNotes(page).click());
  await expect(panel(page).locator('.board-timeline')).toContainText('First card still confirmed');
  await other.click();
  await notes(page).fill('Now confirm the other entry');
  await confirmSave(page, `tasks/${id}`, () => saveNotes(page).click());
  await expect(dialog(page)).toHaveCount(0);
});

test('admin saves notes, follow-ups, calls and warehouse completion with their audit identity', async ({ adminPage: page }) => {
  await page.goto(perspective);
  await card(page).click();
  await panel(page).getByRole('textbox', { name: 'Employee notes' }).fill('Admin verified the listing');
  await confirmSave(page, 'tasks/1', () => saveNotes(page).click());
  await expect(panel(page).locator('.board-timeline')).toContainText('Admin verified the listing');
  await panel(page).getByRole('tab', { name: 'AI follow-up' }).click();
  await panel(page).getByRole('textbox', { name: 'Employee notes' }).fill('Admin follow-up note');
  await save(page, 'tasks/5', () => panel(page).getByRole('button', { name: 'Save notes' }).click());
  await expect(page.locator('.sheet-save-status')).toHaveCount(0);
  await panel(page).getByLabel('Stage', { exact: true }).selectOption('awaiting_details');
  await save(page, 'move', () => panel(page).getByRole('button', { name: 'Move to Awaiting' }).click());
  await expect(page.locator('.board-column[data-code="2C"] .board-card')).toContainText('Raghav Sharma');
  const due = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);
  await panel(page).getByLabel('Next follow-up').fill(due);
  await save(page, 'follow-up', () => panel(page).getByRole('button', { name: 'Save follow-up' }).click());
  await expect(card(page)).toContainText('Follow up');
  await save(page, 'no-answer', () => panel(page).getByRole('button', { name: 'Log a no-answer call' }).click());
  await expect(panel(page).locator('.board-panel-note')).toHaveText('Logged. 1 of 5 strikes.');
  await panel(page).getByLabel('Stage', { exact: true }).selectOption('warehouse_created');
  await panel(page).getByLabel('Warehouse ID', { exact: true }).fill('7654');
  await save(page, 'move', () => panel(page).getByRole('button', { name: 'Move to Warehouse', exact: true }).click());
  await expect(page.locator('.board-column[data-code="4"] .board-card')).toContainText('Raghav Sharma');
  expect(sql("select count(*) from bolna_assignments where id in (1,5) and assignee='priya@eval.test' and stage='warehouse_created' and state='done' and wh_id='7654'")).toBe('2');
  expect(sql("select count(*) from bolna_assignment_changes where assignment_id in (1,5) and before_values<>'{}'::jsonb and actor<>'admin@eval.test'")).toBe('0');
  expect(sql("select count(*) from bolna_manual_attempts where assignment_id in (1,5) and actor='admin@eval.test' and assignee='priya@eval.test'")).toBe('2');
});

test('drag confirmation stays with the entry through filters and refresh, and resets on employee switch or reload', async ({ adminPage: page }) => {
  const drop = (code: string) => card(page).dragTo(page.locator(`.board-column[data-code="${code}"]`));
  await page.goto(perspective);
  await drop('2C');
  await expect(dialog(page)).toBeVisible();
  expect(sql('select revision from bolna_assignments where id=1')).toBe('0');
  await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.board-column[data-code="1"] .board-card')).toHaveCount(1);
  await confirmSave(page, 'move', () => drop('2C'));
  await expect(page.locator('.board-column[data-code="2C"] .board-card')).toHaveCount(1);
  // A task filter changes the card's visible tasks, not its entry identity.
  await page.getByLabel('Work type', { exact: true }).selectOption('record');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove Work type filter: record' })).toBeEnabled();
  await save(page, 'move', () => drop('2A'));
  await expect(page.locator('.board-column[data-code="2A"] .board-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page.getByLabel('Work type', { exact: true })).toHaveValue('');
  await expect(page.locator('.board-filters')).toHaveAttribute('aria-busy', 'false');
  const refreshed = page.waitForResponse(r => r.url().includes('/dashboard/board') && r.request().headers()['rsc'] === '1');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await refreshed;
  await card(page).click();
  await notes(page).fill('Confirmed card after filters and refresh');
  await save(page, 'tasks/1', () => saveNotes(page).click());
  await expect(panel(page).locator('.board-timeline')).toContainText('Confirmed card after filters and refresh');
  await page.getByLabel('View work as').selectOption(EMPLOYEE2.email);
  await expect(page.locator('.board-columns .board-card')).toContainText('Suresh Kumar');
  await page.getByLabel('View work as').selectOption(EMPLOYEE.email);
  await expect(card(page)).toBeVisible();
  await confirmSave(page, 'move', () => drop('2C'));
  await expect(page.locator('.board-column[data-code="2C"] .board-card')).toHaveCount(1);
  await page.reload();
  await drop('2A');
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.board-column[data-code="2C"] .board-card')).toHaveCount(1);
});

for (const action of ['keep', 'junk']) test(`admin can ${action === 'keep' ? 'keep trying' : 'close'} a proposed lead after confirmation`, async ({ adminPage: page }) => {
  sql(`insert into bolna_manual_attempts(id,assignment_id,actor,assignee,occurred_at,disposition,request_hash)
    select gen_random_uuid(),a.id,a.assignee,a.assignee,((now() at time zone 'Asia/Kolkata')::date - g + time '12:00') at time zone 'Asia/Kolkata','no_answer','fixture'
    from bolna_assignments a cross join generate_series(1,5) g where a.id=1;`);
  await page.goto(perspective);
  await page.getByRole('button', { name: 'Review 1 lead' }).click();
  const review = page.getByRole('dialog', { name: 'Review Junk proposals' });
  const decide = review.getByRole('button', { name: action === 'keep' ? 'Keep trying Raghav Sharma' : 'Move Raghav Sharma to Junk' });
  await decide.click();
  await expect(dialog(page)).toContainText('Raghav Sharma');
  await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(decide).toBeFocused();
  expect(sql('select revision from bolna_assignments where id=1')).toBe('0');
  await confirmSave(page, action === 'keep' ? 'follow-up' : 'move', () => decide.click());
  await expect(review).toContainText('No leads waiting for review');
  expect(sql("select count(*) from bolna_assignment_changes where assignment_id in (1,5) and actor='admin@eval.test' and before_values<>'{}'::jsonb")).toBe('2');
});

test('failed employee-note saves preserve the draft and block switching, closing or moving', async ({ adminPage: page }) => {
  await page.goto(perspective);
  await card(page).click();
  await page.route('**/api/board/tasks/**', route => route.fulfill({ status: 500, json: { error: 'Temporary save failure' } }));
  await panel(page).getByRole('textbox', { name: 'Employee notes' }).fill('Keep this admin draft');
  await confirmSave(page, 'tasks/1', () => saveNotes(page).click(), 500);
  await page.getByLabel('View work as').selectOption(EMPLOYEE2.email);
  await expect(page.locator('.snackbar')).toContainText('Finish saving your changes');
  await expect(page.getByLabel('View work as')).toHaveValue(EMPLOYEE.email);
  await panel(page).getByRole('button', { name: 'Close lead' }).click();
  await expect(panel(page).getByRole('textbox', { name: 'Employee notes' })).toHaveValue('Keep this admin draft');
  await panel(page).getByLabel('Stage', { exact: true }).selectOption('rnr');
  await panel(page).getByRole('button', { name: 'Move to RnR' }).click();
  expect(sql('select stage from bolna_assignments where id=1')).toBe('inbound');
  await page.unroute('**/api/board/tasks/**');
  await save(page, 'tasks/1', () => panel(page).getByRole('button', { name: 'Save notes' }).click());
  await expect(panel(page).locator('.board-timeline')).toContainText('Keep this admin draft');
});

test('stale notes never replace employee edits and can be discarded to load the latest value', async ({ adminPage: page, employeePage }) => {
  await page.goto(perspective);
  await card(page).click();
  await panel(page).getByRole('textbox', { name: 'Employee notes' }).fill('Stale admin draft');
  expect((await employeePage.request.patch('/api/board/tasks/1', { data: { revision: 0, remarks: 'Latest employee note' } })).status()).toBe(200);
  await confirmSave(page, 'tasks/1', () => saveNotes(page).click(), 409);
  await expect(panel(page).getByRole('textbox', { name: 'Employee notes' })).toHaveValue('Stale admin draft');
  expect(sql('select remarks from bolna_assignments where id=1')).toBe('Latest employee note');
  await panel(page).getByRole('button', { name: 'Discard draft and reload' }).click();
  await expect(panel(page).getByRole('textbox', { name: 'Employee notes' })).toHaveValue('Latest employee note');
  expect(sql('select actor from bolna_assignment_changes where assignment_id=1 order by id desc limit 1')).toBe(EMPLOYEE.email);
});

test('entry confirmation cannot bypass revoked admin permission', async ({ adminPage: page }) => {
  await page.goto(perspective);
  await card(page).click();
  await notes(page).fill('Must not save');
  await saveNotes(page).click();
  await expect(dialog(page)).toBeVisible();
  expect((await page.request.post('/api/view-mode', { data: { mode: 'employee' } })).status()).toBe(200);
  await save(page, 'tasks/1', () => dialog(page).getByRole('button', { name: 'Confirm and save' }).click(), 403);
  expect(sql('select revision from bolna_assignments where id=1')).toBe('0');
});

for (const width of [1366, 390]) for (const theme of ['light', 'dark']) {
  test(`entry confirmation fits at ${width}px in ${theme} and restores the draft on cancel`, async ({ adminPage: page, shot }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    await page.goto(perspective);
    await card(page).click();
    await notes(page).fill('Admin checked the listing details');
    await saveNotes(page).click();
    await expect(dialog(page).getByRole('button', { name: 'Confirm and save' })).toBeInViewport();
    expect(await bodyOverflowsX(page)).toBe(false);
    await shot(page, `board-entry-confirm-${width}-${theme}`);
    await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(saveNotes(page)).toBeFocused();
    await expect(notes(page)).toHaveValue('Admin checked the listing details');
    await expect(notes(page)).toBeEditable();
    await shot(page, `board-employee-edit-${width}-${theme}`);
  });
}
