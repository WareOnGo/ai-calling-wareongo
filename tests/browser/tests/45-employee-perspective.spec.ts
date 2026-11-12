import { test, expect, bodyOverflowsX } from './fixtures';
import { execFileSync } from 'node:child_process';
import { ADMIN, EMPLOYEE, EMPLOYEE2, CONTAINER } from '../lib/env.mjs';

const sql = (statement: string) => execFileSync('podman', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-c', statement]);
const perspective = (email = EMPLOYEE.email) => `/dashboard/my?${new URLSearchParams({ employee: email })}`;
const recordId = 'a0000000-0000-4000-8000-000000000001';

test('admins see the same employee assignments and saved values without edit handlers', async ({ adminPage: page, employeePage }) => {
  await employeePage.goto('/dashboard/my');
  const contacts = await employeePage.locator('.who-name').allTextContents();
  const counts = await employeePage.locator('.work-tabs').innerText();
  const mutations: string[] = [];
  page.on('request', request => { if (['POST', 'PATCH', 'DELETE'].includes(request.method())) mutations.push(request.url()); });
  await page.goto('/dashboard/my');
  await expect(page.getByLabel('View work as')).toHaveValue('');
  await expect(page.getByLabel('View work as').locator('option')).toHaveText(['My work (me)', 'Priya Eval (priya@eval.test)', 'Raj Eval (raj@eval.test)']);
  await page.getByLabel('View work as').selectOption(EMPLOYEE.email);
  await expect(page.locator('tbody tr')).toHaveCount(3);
  await expect(page.getByText('Read-only employee view', { exact: true })).toBeVisible();
  expect(await page.locator('.who-name').allTextContents()).toEqual(contacts);
  expect(await page.locator('.work-tabs').innerText()).toBe(counts);
  await expect(page.locator('.work-scope')).toHaveText('All assignments to Priya Eval');
  await expect(page.locator('.sheet-save-status')).toHaveCount(0);
  const rows = page.locator('tbody tr');
  for (const row of await rows.all()) {
    await expect(row.getByLabel('Result of the call')).toBeDisabled();
    await expect(row.getByLabel('Employee notes')).toHaveAttribute('readonly', '');
    await expect(row.getByLabel('Warehouse ID')).toHaveAttribute('readonly', '');
    await expect(row.getByRole('checkbox')).toBeDisabled();
    await expect(row.locator('.btn-done')).toBeDisabled();
  }
  const done = rows.filter({ hasText: 'Meera Nair' });
  await expect(done.getByLabel('Result of the call')).toHaveValue('Available');
  await expect(done.getByLabel('Employee notes')).toHaveValue('confirmed 8000 sqft');
  await expect(done.getByLabel('Warehouse ID')).toHaveValue('1008');
  await expect(done).toHaveClass('row-done');
  expect(mutations).toEqual([]);
  // A forged perspective parameter never changes the actor of the write API.
  expect((await page.request.patch('/api/my-work/assignments/1?employee=priya%40eval.test', { data: { revision: 0, remarks: 'Must not save' } })).status()).toBe(409);
  expect(await (await employeePage.request.get('/api/my-work/assignments/1')).json()).toMatchObject({ revision: 0, remarks: null });
});

test('filters, status tabs, resets and quick/saved views retain the selected employee', async ({ adminPage: page }) => {
  await page.goto(perspective());
  await page.getByLabel('Search my work').fill('Raghav');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(page.getByLabel('View work as')).toHaveValue(EMPLOYEE.email);
  await page.getByRole('navigation', { name: 'Work status' }).getByRole('link', { name: /^Done/ }).click();
  await expect(page.locator('.work-empty')).toContainText('No work matches these filters');
  await page.locator('.work-empty').getByRole('link', { name: 'Clear filters' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody')).toContainText('Meera Nair');
  expect(new URL(page.url()).searchParams.get('employee')).toBe(EMPLOYEE.email);

  await page.locator('.views-menu > summary').click();
  await page.getByRole('button', { name: 'Not called yet', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(page.getByLabel('View work as')).toHaveValue(EMPLOYEE.email);
  await page.locator('.views-menu > summary').click();
  await page.getByRole('button', { name: 'Save current filters…' }).click();
  await page.getByRole('textbox', { name: 'View name' }).fill('Uncalled work');
  await page.getByRole('button', { name: 'Save view', exact: true }).click();
  await page.getByLabel('View work as').selectOption(EMPLOYEE2.email);
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody')).toContainText('Suresh Kumar');
  await page.getByRole('link', { name: 'Reset', exact: true }).click();
  await expect(page.getByLabel('Filter by result')).toHaveValue('');
  await page.locator('.views-menu > summary').click();
  await page.getByRole('button', { name: 'Uncalled work', exact: true }).click();
  await expect(page.getByLabel('Filter by result')).toHaveValue('none');
  await expect(page.getByLabel('View work as')).toHaveValue(EMPLOYEE2.email);
  await page.getByRole('button', { name: 'Remove Result filter' }).click();
  await expect(page.getByLabel('Filter by result')).toHaveValue('');
  await page.getByLabel('Search my work').fill('Suresh');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Clear filters', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page.getByLabel('Search my work')).toHaveValue('');
  expect(new URL(page.url()).searchParams.get('employee')).toBe(EMPLOYEE2.email);
  await page.reload();
  await expect(page.getByLabel('View work as')).toHaveValue(EMPLOYEE2.email);
  await expect(page.locator('tbody')).toContainText('Suresh Kumar');
});

test('pagination stays scoped and switching employees resets both page numbers', async ({ adminPage: page }) => {
  sql(`insert into raw_records(id,source,source_record_id,owner_name)
    select md5('perspective-'||n)::uuid,'perspective',n::text,'Perspective owner '||n from generate_series(1,26) n;
    insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state)
    select 'record',id,'priya@eval.test','admin@eval.test','open' from raw_records where source='perspective';`);
  await page.goto(`${perspective()}&sort=name`);
  await expect(page.locator('[data-entity="record"] tbody tr')).toHaveCount(25);
  await expect(page.locator('.work-tabs')).toContainText('All29');
  await page.getByRole('navigation', { name: 'Listings to call pages' }).getByRole('link', { name: 'Next' }).click();
  await expect(page.locator('[data-entity="record"] tbody tr')).toHaveCount(3);
  expect(new URL(page.url()).searchParams.get('employee')).toBe(EMPLOYEE.email);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.locator('.work-pager')).toContainText('Page 2 of 2');
  await page.getByLabel('View work as').selectOption(EMPLOYEE2.email);
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody')).toContainText('Suresh Kumar');
  const params = new URL(page.url()).searchParams;
  expect(params.has('records_page')).toBe(false);
  expect(params.has('calls_page')).toBe(false);
  expect(params.get('sort')).toBe('name');
  await page.goBack();
  await expect(page.getByLabel('View work as')).toHaveValue(EMPLOYEE.email);
  await expect(page.locator('.work-pager')).toContainText('Page 2 of 2');
});

for (const viewer of ['admin', 'employee'] as const) for (const width of [1366, 390]) {
  test(`${viewer} paging brings the updated work list into view at ${width}px`, async ({ adminPage, employeePage, shot }) => {
    sql(`insert into raw_records(id,source,source_record_id,owner_name)
      select md5('paging-listing-'||n)::uuid,'paging',n::text,'Paging listing '||n from generate_series(1,30) n;
      insert into bolna_call_logs(id,status,context_details)
      select md5('paging-call-'||n)::uuid,'completed',jsonb_build_object('recipient_data',jsonb_build_object('name','Paging caller '||n)) from generate_series(1,55) n;
      insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state)
      select 'record',id,'priya@eval.test','admin@eval.test','open' from raw_records where source='paging'
      union all select 'call',id,'priya@eval.test','admin@eval.test','open' from bolna_call_logs where context_details->'recipient_data'->>'name' like 'Paging caller %';`);
    const page = viewer === 'admin' ? adminPage : employeePage;
    await page.setViewportSize({ width, height: 768 });
    await page.goto(viewer === 'admin' ? perspective() : '/dashboard/my');
    const content = page.locator('.work-content');
    const records = page.locator('[data-entity="record"]');
    const calls = page.locator('[data-entity="call"]');
    const firstRecords = await records.locator('.who-name').allTextContents();
    const firstCalls = await calls.locator('.who-name').allTextContents();

    for (const [label, target, firstRow] of [['Next', 2, '26'], ['Next', 3, '51'], ['Previous', 2, '26'], ['Previous', 1, '1']] as const) {
      await calls.getByRole('link', { name: label, exact: true }).click();
      await expect(calls.locator('.work-pager')).toContainText(`Page ${target} of 3`);
      await expect(calls.locator('tbody .rownum').first()).toHaveText(firstRow);
      // Check the actual visible section, not just data elsewhere in the DOM.
      await expect(calls.locator('.section-head')).toBeInViewport();
      await expect(calls.locator('.section-head')).toBeFocused();
      await expect(calls.locator('tbody tr').first()).toBeInViewport();
      expect(await content.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      expect(await records.locator('.who-name').allTextContents()).toEqual(firstRecords);
      if (target === 2 && label === 'Next') await shot(page, `my-work-paging-${viewer}-${width}`);
      if (target === 1) expect(await calls.locator('.who-name').allTextContents()).toEqual(firstCalls);
      else expect(await calls.locator('.who-name').allTextContents()).not.toEqual(firstCalls);
      if (viewer === 'admin') expect(new URL(page.url()).searchParams.get('employee')).toBe(EMPLOYEE.email);
    }
    await records.getByRole('link', { name: 'Next', exact: true }).click();
    await expect(records.locator('tbody .rownum').first()).toHaveText('26');
    await expect(records.locator('.section-head')).toBeInViewport();
    await expect(records.locator('.section-head')).toBeFocused();
    expect(await calls.locator('.who-name').allTextContents()).toEqual(firstCalls);
  });
}

test('detail drawers use the selected employee scope including verification history', async ({ adminPage: page }) => {
  sql(`insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state,remarks)
    values ('record','${recordId}','raj@eval.test','admin@eval.test','dropped','Other employee private history');`);
  await page.goto(perspective());
  const response = page.waitForResponse(r => r.url().includes(`/api/details/record/${recordId}?employee=`));
  await page.locator('[data-entity="record"] tbody tr').filter({ hasText: 'Raghav Sharma' }).getByRole('button', { name: 'Details for record' }).click();
  const data = await (await response).json();
  expect(data.history).toHaveLength(1);
  expect(data.history[0].assignee).toBe(EMPLOYEE.email);
  const drawer = page.getByRole('dialog');
  await expect(drawer).toContainText('Priya Eval');
  await expect(drawer).not.toContainText('Other employee private history');
  await drawer.getByRole('button', { name: 'Close details' }).click();
  const otherRecord = '/api/details/record/a0000000-0000-4000-8000-000000000003';
  expect((await page.request.get(`${otherRecord}?employee=priya%40eval.test`)).status()).toBe(404);
  expect((await page.request.get(otherRecord)).status()).toBe(200);
  for (const employee of ['gone@eval.test', 'unknown@eval.test']) {
    expect((await page.request.get(`/api/details/record/${recordId}?${new URLSearchParams({ employee })}`)).status()).toBe(404);
  }
});

test('employee URLs and admin employee mode cannot select another person', async ({ adminPage, employeePage: page }) => {
  await page.goto(perspective(EMPLOYEE2.email));
  await expect(page.getByLabel('View work as')).toHaveCount(0);
  await expect(page.locator('tbody tr')).toHaveCount(3);
  await expect(page.locator('.work-content')).not.toContainText('Suresh Kumar');
  await expect(page.locator('.work-content')).not.toContainText('Raj Eval');
  await expect(page.getByLabel('Result of the call').first()).toBeEnabled();
  expect((await page.request.get('/api/details/record/a0000000-0000-4000-8000-000000000003?employee=raj%40eval.test')).status()).toBe(404);
  expect((await adminPage.request.post('/api/view-mode', { data: { mode: 'employee' } })).status()).toBe(200);
  await adminPage.goto(perspective());
  await expect(adminPage.getByLabel('View work as')).toHaveCount(0);
  await expect(adminPage.locator('tbody tr')).toHaveCount(0);
  await expect(adminPage.locator('.work-empty')).toContainText('Nothing is assigned to you yet');
});

test('admins can return to their editable own work and view employees with no assignments', async ({ adminPage: page }) => {
  sql(`insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state)
    values ('record','a0000000-0000-4000-8000-000000000006','${ADMIN.email}','${ADMIN.email}','open');
    insert into bolna_app_users(email,role,active) values ('new@eval.test','employee',true);`);
  await page.goto('/dashboard/my');
  await expect(page.getByLabel('Result of the call')).toBeEnabled();
  await page.getByLabel('View work as').selectOption(EMPLOYEE.email);
  await expect(page.getByLabel('Result of the call').first()).toBeDisabled();
  await page.getByLabel('View work as').selectOption('');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.getByLabel('Your notes')).toBeEditable();
  const save = page.waitForResponse(r => r.url().includes('/api/my-work/assignments/') && r.request().method() === 'PATCH');
  await page.getByLabel('Your notes').fill('My own admin task');
  await page.getByLabel('Your notes').blur();
  expect((await save).status()).toBe(200);
  await page.getByLabel('View work as').selectOption('new@eval.test');
  await expect(page.locator('.work-empty')).toContainText('Nothing is assigned to new@eval.test yet');
  await expect(page.getByText('Read-only employee view', { exact: true })).toBeVisible();
  await page.getByLabel('View work as').selectOption('');
  await expect(page.getByLabel('Your notes')).toHaveValue('My own admin task');
});

for (const width of [1600, 390]) for (const theme of ['light', 'dark']) {
  test(`employee perspective fits at ${width}px in ${theme}`, async ({ adminPage: page, shot }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    await page.goto(perspective());
    const picker = page.getByLabel('View work as');
    await expect(picker).toBeVisible();
    await picker.focus();
    await expect(picker).toBeFocused();
    expect(await bodyOverflowsX(page)).toBe(false);
    const box = await picker.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await shot(page, `employee-perspective-${width}-${theme}`);
    await picker.selectOption(EMPLOYEE2.email);
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('.work-content')).toContainText('Suresh Kumar');
  });
}
