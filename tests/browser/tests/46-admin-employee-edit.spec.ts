import { test, expect, bodyOverflowsX } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { ADMIN, EMPLOYEE, EMPLOYEE2, CONTAINER } from '../lib/env.mjs';

const perspective = `/dashboard/my?${new URLSearchParams({ employee: EMPLOYEE.email })}`;
const endpoint = (id = 1) => `/api/my-work/assignments/${id}?${new URLSearchParams({ employee: EMPLOYEE.email })}`;
const record = (page: Page) => page.locator('[data-entity="record"] tbody tr').filter({ hasText: 'Raghav Sharma' });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Edit this entry?', exact: true });
const saveButton = (row: Locator) => row.getByRole('button', { name: 'Save changes', exact: true });
const sql = (statement: string) => execFileSync('podman', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', '-c', statement], { encoding: 'utf8' }).trim();

async function save(page: Page, action: () => Promise<unknown>, id = 1, status = 200) {
  const response = page.waitForResponse(r => r.url().endsWith(endpoint(id)) && r.request().method() === 'PATCH');
  await action();
  expect((await response).status()).toBe(status);
}
async function confirmSave(page: Page, action: () => Promise<unknown>, id = 1, status = 200) {
  await action();
  await expect(dialog(page)).toBeVisible();
  await save(page, () => dialog(page).getByRole('button', { name: 'Confirm and save', exact: true }).click(), id, status);
  await expect(dialog(page)).toHaveCount(0);
}

test('normal controls confirm the first save and cancel or Escape keeps the draft without writing', async ({ adminPage: page }) => {
  const writes: string[] = [];
  page.on('request', request => { if (request.method() === 'PATCH') writes.push(request.url()); });
  await page.goto(perspective);
  const row = record(page);
  await expect(page.getByRole('button', { name: 'Edit row', exact: true })).toHaveCount(0);
  await expect(row.getByLabel('Employee notes')).toBeEditable();
  await expect(row.getByLabel('Result of the call')).toBeEnabled();
  await row.getByLabel('Employee notes').fill('Keep this draft until I confirm');
  await row.getByLabel('Employee notes').blur();
  await expect(dialog(page)).toHaveCount(0);
  for (const cancel of ['button', 'Escape']) {
    await saveButton(row).click();
    await expect(dialog(page)).toContainText('Raghav Sharma');
    await expect(dialog(page)).toContainText('Priya Eval');
    await expect(dialog(page)).toContainText('recorded as your edits');
    expect(writes).toEqual([]);
    if (cancel === 'button') await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    else await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(saveButton(row)).toBeFocused();
    await expect(row.getByLabel('Employee notes')).toHaveValue('Keep this draft until I confirm');
    await expect(row.locator('.work-row-editing')).toHaveText('Editing');
    expect(sql('select revision from bolna_assignments where id=1')).toBe('0');
  }
  await confirmSave(page, () => saveButton(row).click());
  await expect(row.locator('.work-row-editing')).toHaveText('Saved');
  await row.getByLabel('Employee notes').fill('Second edit to this row');
  await save(page, () => saveButton(row).click());
  await expect(dialog(page)).toHaveCount(0);
  expect(writes).toHaveLength(2);
});

for (const field of ['result', 'notes', 'In DB', 'warehouse ID', 'Done']) {
  test(`the first ${field} change needs confirmation and cancelled changes can be discarded`, async ({ adminPage: page }) => {
    await page.goto(perspective);
    const row = record(page);
    if (field === 'result') await row.getByLabel('Result of the call').selectOption('Available');
    else if (field === 'In DB') await row.getByRole('checkbox').check();
    else if (field === 'Done') await row.getByRole('button', { name: 'Mark done', exact: true }).click();
    else {
      await row.getByLabel(field === 'notes' ? 'Employee notes' : 'Warehouse ID').fill(field === 'notes' ? 'New draft' : '1234');
      await saveButton(row).click();
    }
    await expect(dialog(page)).toBeVisible();
    expect(sql('select revision from bolna_assignments where id=1')).toBe('0');
    await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(row.locator('.work-row-editing')).toHaveText('Editing');
    await row.getByRole('button', { name: 'Discard draft', exact: true }).click();
    await expect(row.getByLabel('Result of the call')).toHaveValue('');
    await expect(row.getByLabel('Employee notes')).toHaveValue('');
    await expect(row.getByLabel('Warehouse ID')).toHaveValue('');
    await expect(row.getByRole('checkbox')).not.toBeChecked();
    await expect(row.locator('.btn-done')).toHaveAttribute('aria-pressed', 'false');
    expect(sql('select revision from bolna_assignments where id=1')).toBe('0');
    // Discarding a cancelled edit must not grant permission to save later edits.
    await confirmSave(page, () => row.getByLabel('Result of the call').selectOption('Available'));
    await expect(row.locator('.work-row-editing')).toHaveText('Saved');
  });
}

test('each listing and AI row confirms separately and saves every field with the admin audit identity', async ({ adminPage: page, employeePage }) => {
  await page.goto(perspective);
  const row = record(page);
  await confirmSave(page, () => row.getByLabel('Result of the call').selectOption('Available'));
  await row.getByLabel('Employee notes').fill('Admin verified the details');
  await save(page, () => saveButton(row).click());
  await row.getByLabel('Warehouse ID').fill('WH-ADMIN-123');
  await save(page, () => saveButton(row).click());
  await save(page, () => row.getByRole('checkbox').check());
  const call = page.locator('[data-entity="call"] tbody tr').first();
  await call.getByLabel('Employee notes').fill('Admin follow-up note');
  await confirmSave(page, () => saveButton(call).click(), 5);
  await save(page, () => call.getByRole('button', { name: 'Mark done', exact: true }).click(), 5);
  await save(page, () => row.getByRole('button', { name: 'Mark done', exact: true }).click());
  await expect(row).toHaveClass('row-done');
  await save(page, () => row.getByRole('button', { name: 'Done', exact: true }).click());
  await expect(row).not.toHaveClass('row-done');
  await expect(row.locator('.work-row-editing')).toHaveText('Saved');
  await expect(call.locator('.work-row-editing')).toHaveText('Saved');
  expect(sql("select count(*) from bolna_assignment_changes where assignment_id in (1,5) and before_values <> '{}'::jsonb and actor='admin@eval.test'")).toBe('8');
  expect(sql("select count(*) from bolna_assignments where id in (1,5) and assignee='priya@eval.test'")).toBe('2');
  expect(await (await employeePage.request.get('/api/my-work/assignments/1')).json()).toMatchObject({ revision: 6, remarks: 'Admin verified the details', wh_id: 'WH-ADMIN-123', added_to_db: true, outcome: 'Available', state: 'open' });
  await page.reload();
  await expect(row.getByLabel('Employee notes')).toHaveValue('Admin verified the details');
  await confirmSave(page, () => row.getByRole('checkbox').uncheck());
});

test('shared Save changes confirms every dirty row in turn before writing it', async ({ adminPage: page }) => {
  const writes: string[] = [];
  page.on('request', request => { if (request.method() === 'PATCH') writes.push(new URL(request.url()).pathname); });
  await page.goto(perspective);
  const row = record(page);
  const call = page.locator('[data-entity="call"] tbody tr').first();
  await row.getByLabel('Employee notes').fill('Admin listing correction');
  await call.getByLabel('Employee notes').fill('Admin follow-up correction');
  await page.locator('.sheet-save-status').getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(dialog(page)).toContainText('listing for Raghav Sharma');
  expect(writes).toEqual([]);
  await save(page, () => dialog(page).getByRole('button', { name: 'Confirm and save', exact: true }).click());
  await expect(dialog(page)).toContainText('AI follow-up for Raghav Sharma');
  await expect(dialog(page).getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await expect(row.locator('.work-row-editing')).toHaveText('Saved');
  await expect(call.locator('.work-row-editing')).toHaveText('Editing');
  expect(writes).toEqual(['/api/my-work/assignments/1']);
  expect(sql('select revision from bolna_assignments where id=5')).toBe('0');
  await save(page, () => dialog(page).getByRole('button', { name: 'Confirm and save', exact: true }).click(), 5);
  await expect(dialog(page)).toHaveCount(0);
  await expect(call.locator('.work-row-editing')).toHaveText('Saved');
  await expect(page.locator('.sheet-save-status')).toHaveText('All changes saved');
  expect(writes).toEqual(['/api/my-work/assignments/1', '/api/my-work/assignments/5']);
  expect(sql("select count(*) from bolna_assignment_changes where assignment_id in (1,5) and before_values <> '{}'::jsonb and actor='admin@eval.test'")).toBe('2');
});

for (const cancel of ['Cancel', 'Escape']) {
  test(`${cancel} skips only the current shared-save confirmation and preserves its draft`, async ({ adminPage: page }) => {
    await page.goto(perspective);
    const row = record(page);
    const call = page.locator('[data-entity="call"] tbody tr').first();
    await row.getByLabel('Employee notes').fill('Keep this listing draft');
    await call.getByLabel('Employee notes').fill('Save this follow-up draft');
    await page.locator('.sheet-save-status').getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(dialog(page)).toContainText('listing for Raghav Sharma');
    if (cancel === 'Cancel') await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    else await page.keyboard.press('Escape');
    await expect(dialog(page)).toContainText('AI follow-up for Raghav Sharma');
    expect(sql('select sum(revision) from bolna_assignments where id in (1,5)')).toBe('0');
    await save(page, () => dialog(page).getByRole('button', { name: 'Confirm and save', exact: true }).click(), 5);
    await expect(dialog(page)).toHaveCount(0);
    await expect(call.locator('.work-row-editing')).toHaveText('Saved');
    await expect(row.locator('.work-row-editing')).toHaveText('Editing');
    await expect(row.getByLabel('Employee notes')).toHaveValue('Keep this listing draft');
    expect(sql('select revision from bolna_assignments where id=1')).toBe('0');
    // Canceling one request must not approve a later save of the same row.
    await confirmSave(page, () => saveButton(row).click());
    await expect(row.locator('.work-row-editing')).toHaveText('Saved');
  });
}

test('row confirmation survives filters and refresh but resets when switching employees', async ({ adminPage: page }) => {
  await page.goto(perspective);
  await confirmSave(page, () => record(page).getByLabel('Result of the call').selectOption('Available'));
  await page.getByLabel('Search my work').fill('Raghav');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(3);
  const refreshed = page.waitForResponse(r => r.url().includes('/dashboard/my') && r.request().headers()['rsc'] === '1');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await refreshed;
  await record(page).getByLabel('Employee notes').fill('Still confirmed after filters and refresh');
  await save(page, () => saveButton(record(page)).click());
  await page.getByLabel('View work as').selectOption(EMPLOYEE2.email);
  await expect(page.locator('.who-name')).toHaveText(['Suresh Kumar']);
  await page.getByLabel('View work as').selectOption(EMPLOYEE.email);
  await expect(record(page)).toBeVisible();
  await confirmSave(page, () => record(page).getByRole('checkbox').check());
});

test('browser Back cancels all queued confirmations and keeps every draft without saving', async ({ adminPage: page }) => {
  const writes: string[] = [];
  page.on('request', request => { if (request.method() === 'PATCH') writes.push(request.url()); });
  await page.goto(perspective);
  await page.getByLabel('Search my work').fill('Raghav');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  const call = page.locator('[data-entity="call"] tbody tr').first();
  await record(page).getByLabel('Employee notes').fill('Keep this draft after Back');
  await call.getByLabel('Employee notes').fill('Keep the queued draft after Back');
  await page.locator('.sheet-save-status').getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
  await page.goBack();
  await expect(page.locator('tbody tr')).toHaveCount(3);
  await expect(dialog(page)).toHaveCount(0);
  await expect(record(page).getByLabel('Employee notes')).toHaveValue('Keep this draft after Back');
  await expect(call.getByLabel('Employee notes')).toHaveValue('Keep the queued draft after Back');
  expect(writes).toEqual([]);
  await confirmSave(page, () => saveButton(record(page)).click());
  await expect(record(page).locator('.work-row-editing')).toHaveText('Saved');
  await confirmSave(page, () => saveButton(call).click(), 5);
  await expect(call.locator('.work-row-editing')).toHaveText('Saved');
});

test('row status follows pending, successful, failed and retried saves', async ({ adminPage: page }) => {
  await page.goto(perspective);
  const row = record(page);
  const status = row.locator('.work-row-editing');
  const notes = row.getByLabel('Employee notes');
  let releaseSave!: () => void;
  const pendingSave = new Promise<void>(resolve => { releaseSave = resolve; });
  await page.route('**/api/my-work/assignments/**', async route => {
    if (route.request().method() === 'PATCH') await pendingSave;
    await route.continue();
  });
  await notes.fill('Wait for confirmation from the server');
  await saveButton(row).click();
  await dialog(page).getByRole('button', { name: 'Confirm and save' }).click();
  await expect(status).toHaveText('Saving…');
  expect(sql('select revision from bolna_assignments where id=1')).toBe('0');
  await save(page, async () => releaseSave());
  await expect(status).toHaveText('Saved');
  await notes.fill('Another unsaved change');
  await expect(status).toHaveText('Editing');
  await page.unroute('**/api/my-work/assignments/**');
  await page.route('**/api/my-work/assignments/**', route => route.request().method() === 'PATCH'
    ? route.fulfill({ status: 500, json: { error: 'Temporary save failure' } }) : route.continue());
  await save(page, () => saveButton(row).click(), 1, 500);
  await expect(status).toHaveText('Not saved');
  expect(sql('select revision from bolna_assignments where id=1')).toBe('1');
  await expect(notes).toHaveValue('Another unsaved change');
  await page.unroute('**/api/my-work/assignments/**');
  await save(page, () => row.getByRole('button', { name: 'Retry', exact: true }).click());
  await expect(status).toHaveText('Saved');
  expect(sql('select remarks from bolna_assignments where id=1')).toBe('Another unsaved change');
});

test('competing employee edits need review before the admin can replace them', async ({ adminPage: page, employeePage }) => {
  await page.goto(perspective);
  expect((await employeePage.request.patch('/api/my-work/assignments/1', { data: { revision: 0, remarks: 'Latest employee note' } })).status()).toBe(200);
  await record(page).getByLabel('Employee notes').fill('Admin correction');
  await confirmSave(page, () => saveButton(record(page)).click(), 1, 409);
  await record(page).getByRole('button', { name: 'Review changes', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review unsaved changes', exact: true });
  await expect(review).toContainText('Latest employee note');
  await expect(review).toContainText('Admin correction');
  await save(page, () => review.getByRole('button', { name: 'Save my changes', exact: true }).click());
  await expect(record(page).locator('.work-row-editing')).toHaveText('Saved');
  expect(sql('select actor from bolna_assignment_changes where assignment_id=1 order by id desc limit 1')).toBe(ADMIN.email);
});

test('discarding a conflicted draft refreshes the latest employee edit', async ({ adminPage: page, employeePage }) => {
  await page.goto(perspective);
  expect((await employeePage.request.patch('/api/my-work/assignments/1', { data: { revision: 0, remarks: 'Latest employee note' } })).status()).toBe(200);
  const row = record(page);
  await row.getByLabel('Employee notes').fill('Discard this admin correction');
  await confirmSave(page, () => saveButton(row).click(), 1, 409);
  await expect(row.locator('.work-row-editing')).toHaveText('Not saved');
  await row.getByRole('button', { name: 'Discard draft', exact: true }).click();
  await expect(row.getByLabel('Employee notes')).toHaveValue('Latest employee note');
  await expect(row.getByRole('button', { name: 'Review changes', exact: true })).toHaveCount(0);
  expect(sql('select revision from bolna_assignments where id=1')).toBe('1');
  expect(sql('select actor from bolna_assignment_changes where assignment_id=1 order by id desc limit 1')).toBe(EMPLOYEE.email);
});

test('failed saves retain drafts, block switching and require fresh confirmation after reload', async ({ adminPage: page }) => {
  await page.goto(perspective);
  await page.route('**/api/my-work/assignments/**', route => route.request().method() === 'PATCH' ? route.fulfill({ status: 500, json: { error: 'Temporary save failure' } }) : route.continue());
  await record(page).getByLabel('Employee notes').fill('Keep my admin draft');
  await confirmSave(page, () => saveButton(record(page)).click(), 1, 500);
  await page.getByLabel('View work as').selectOption(EMPLOYEE2.email);
  await expect(page.locator('.snackbar')).toContainText('Finish saving your changes');
  await expect(page.getByLabel('View work as')).toHaveValue(EMPLOYEE.email);
  page.on('dialog', prompt => prompt.accept());
  await page.reload();
  await expect(record(page).getByLabel('Employee notes')).toHaveValue('Keep my admin draft');
  await expect(record(page).locator('.work-row-editing')).toHaveText('Editing');
  await page.unroute('**/api/my-work/assignments/**');
  // The shared Save changes action must use the same confirmation as the row.
  await confirmSave(page, () => page.locator('.sheet-save-status').getByRole('button', { name: 'Save changes', exact: true }).click());
  await expect(record(page).locator('.work-row-editing')).toHaveText('Saved');
});

test('confirmation cannot bypass employee scope or revoked admin permission', async ({ adminPage: page, employeePage }) => {
  expect((await employeePage.request.patch(`/api/my-work/assignments/4?${new URLSearchParams({ employee: EMPLOYEE2.email })}`, { data: { revision: 0, remarks: 'Must not save' } })).status()).toBe(403);
  await page.goto(perspective);
  await record(page).getByLabel('Employee notes').fill('Must not save');
  await saveButton(record(page)).click();
  await expect(dialog(page)).toBeVisible();
  expect((await page.request.post('/api/view-mode', { data: { mode: 'employee' } })).status()).toBe(200);
  await save(page, () => dialog(page).getByRole('button', { name: 'Confirm and save' }).click(), 1, 403);
  expect(await (await employeePage.request.get('/api/my-work/assignments/1')).json()).toMatchObject({ revision: 0, remarks: null });
});

for (const width of [1366, 390]) for (const theme of ['light', 'dark']) {
  test(`confirmation fits and restores focus at ${width}px in ${theme}`, async ({ adminPage: page, shot }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    await page.goto(perspective);
    const row = record(page);
    await row.getByLabel('Employee notes').fill('Admin checked the listing');
    await saveButton(row).click();
    await expect(dialog(page).getByRole('button', { name: 'Confirm and save' })).toBeInViewport();
    expect(await bodyOverflowsX(page)).toBe(false);
    await dialog(page).getByRole('button', { name: 'Confirm and save' }).focus();
    await page.keyboard.press('Tab');
    await expect(dialog(page).getByRole('button', { name: 'Close', exact: true })).toBeFocused();
    await shot(page, `admin-employee-confirm-${width}-${theme}`);
    await page.keyboard.press('Escape');
    await expect(saveButton(row)).toBeFocused();
    await expect(row.getByLabel('Employee notes')).toHaveValue('Admin checked the listing');
    await confirmSave(page, () => saveButton(row).click());
    await expect(row.locator('.work-row-editing')).toHaveText('Saved');
    expect(await bodyOverflowsX(page)).toBe(false);
    await shot(page, `admin-employee-edit-${width}-${theme}`);
  });
}
