import { test, expect, bodyOverflowsX } from './fixtures';
import { execFileSync } from 'node:child_process';
import { CONTAINER,BASE_URL } from '../lib/env.mjs';

const sql = (statement: string) => execFileSync('podman', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-c', statement]);
const ownCall = 'c0000000-0000-4000-8000-000000000002';

test('completed assignments retain attribution and remain distinct from current ownership', async ({adminPage:page}) => {
  await page.goto('/dashboard/raw?q=Meera');
  await expect(page.locator('.assignment-attribution')).toContainText('Priya Eval');
  await expect(page.locator('.assignment-attribution')).toContainText('Assignment completed');
  await expect(page.locator('.assignment-attribution')).toHaveAttribute('title', /priya@eval.test/);
  sql(`begin;
    insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,outcome,disposition) values('call','${ownCall}','raj@eval.test','admin@eval.test','Unavailable','connected');
    insert into bolna_manual_attempts(id,assignment_id,actor,assignee,occurred_at,disposition,outcome,request_hash)
      select gen_random_uuid(),id,'raj@eval.test','raj@eval.test',now(),'connected','Unavailable','completed-attribution-fixture'
      from bolna_assignments where entity_type='call' and entity_id='${ownCall}';
    update bolna_assignments set state='done' where entity_type='call' and entity_id='${ownCall}';
    commit;`);
  await page.goto('/dashboard/calls?q=Meera');
  await expect(page.locator('.assignment-attribution')).toContainText('Raj Eval');
  await expect(page.locator('.assignment-attribution')).toContainText('Assignment completed');
  sql("update bolna_app_users set active=false where email='priya@eval.test'");
  await page.goto('/dashboard/raw?q=Meera');
  await expect(page.locator('.assignment-attribution')).toContainText('priya@eval.test');
  sql("insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by) values('record','a0000000-0000-4000-8000-000000000002','raj@eval.test','admin@eval.test')");
  await page.reload();await expect(page.locator('.assignment-attribution')).toHaveCount(0);
  await expect(page.locator('table.sheet tbody')).toContainText('raj@eval.test');
});

test('contact identity leads assignments and follow-up notes remain expandable', async ({adminPage: page, shot}) => {
  sql("update bolna_assignments set remarks = repeat('Owner confirmed the warehouse is available. ', 12) || 'Final inspection booked.' where id = 1");
  await page.goto('/dashboard/assignments');
  await expect(page.locator('.colheads th').nth(1)).toHaveText('Contact');
  await expect(page.locator('.contact-card').first().locator('.copytext-v')).toContainText('+91');
  await expect(page.getByRole('button',{name:'Toggle filters'})).toBeVisible();
  await expect(page.locator('.filter-multi summary').filter({hasText:'Assignee'})).toBeHidden();
  await expect(page.locator('.filter-multi summary[aria-label="Status"]')).toBeHidden();
  const notes = page.locator('.assignment-notes').filter({hasText: 'Final inspection booked.'});
  await notes.getByRole('button', {name: 'Show more'}).click();
  await expect(notes.locator('.notes-preview')).toHaveCount(0);
  await expect(notes.getByRole('button', {name: 'Show less'})).toHaveAttribute('aria-expanded', 'true');
  await shot(page, 'assignments-contact-first');
  const person = page.locator('tbody .assignment-person').first();
  const left = (await person.boundingBox())!.x;
  await page.locator('.gridwrap').evaluate(el => el.scrollLeft = 650);
  expect(Math.abs((await person.boundingBox())!.x - left)).toBeLessThanOrEqual(1);
});

test('assignee workload cards retain the person and show matching totals', async ({adminPage: page}) => {
  await page.goto('/dashboard/assignments');
  await page.getByRole('button',{name:'Toggle filters'}).click();
  await page.locator('.filter-multi summary').filter({hasText:'Assignee'}).click();await page.getByRole('checkbox',{name:'Raj Eval',exact:true}).check();
  await page.getByRole('button', {name: 'Apply', exact: true}).click();
  await expect(page.locator('.assignment-stat-scope')).toContainText('All work for Raj Eval');
  await expect(page.locator('.stat-n')).toHaveText(['1', '0', '0', '1']);
  await page.locator('a.stat').filter({hasText: 'done'}).click();
  await expect(page).toHaveURL(/assignee=raj%40eval.test&state=done/);
  await expect(page.locator('tbody:visible')).toContainText('No assignments match');
  await expect(page.locator('a.stat').filter({hasText: 'done'})).toHaveAttribute('aria-current', 'page');
  await page.locator('.empty-actions').getByRole('link', {name: 'Clear filters'}).click();
  await expect(page.locator('tbody tr')).toHaveCount(5);
});

test('assignment search includes display names and original brief', async ({adminPage: page}) => {
  await page.goto('/dashboard/assignments?q=Raj%20Eval');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody:visible')).toContainText('Suresh Kumar');
  await page.goto('/dashboard/assignments?q=follow%20up%20on%20rent');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.locator('details.column-menu:not(.views-menu) summary').click();await page.getByRole('checkbox',{name:'Channel',exact:true}).check();await expect(page.locator('tbody .pill-call')).toBeVisible();
});

test('admin employee view scopes pages and APIs and survives a reload', async ({adminPage: page, shot}) => {
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  sql(`insert into bolna_assignments(entity_type, entity_id, assignee, assigned_by) values ('call', '${ownCall}', 'admin@eval.test', 'admin@eval.test')`);
  await page.goto('/dashboard/assignments');
  if(await page.locator('.account-menu').getAttribute('open')===null)await page.locator('.account-menu > summary').click();
  await page.getByRole('button', {name: 'Employee view', exact: true}).click();
  await expect(page).toHaveURL(/dashboard\/my$/);
  if(await page.locator('.account-menu').getAttribute('open')===null)await page.locator('.account-menu > summary').click();
  await expect(page.getByRole('button', {name: 'Employee view', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.topnav a')).toHaveCount(1);
  await expect(page.locator('[data-loading-view]')).toHaveCount(0);
  await expect(page.locator('.title-sub')).toContainText('1 still to do');
  await expect(page.locator('tbody:visible')).toHaveCount(1);
  await expect(page.locator('tbody:visible')).not.toContainText('Raghav Sharma');
  await page.reload();
  if(await page.locator('.account-menu').getAttribute('open')===null)await page.locator('.account-menu > summary').click();
  await expect(page.getByRole('button', {name: 'Employee view', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/dashboard/calls');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('.selcol')).toHaveCount(0);
  expect((await page.request.get('/api/users')).status()).toBe(403);
  expect((await page.request.get('/api/raw/queue')).status()).toBe(403);
  expect((await page.request.patch('/api/assignments/1', {data: {revision:0,remarks: 'out of scope'}})).status()).toBe(409);
  expect((await page.request.get('/api/details/call/c0000000-0000-4000-8000-000000000001')).status()).toBe(404);
  const csv = await page.request.get('/api/calls/export');
  expect(csv.status()).toBe(200); expect((await csv.text()).trim().split('\n')).toHaveLength(2);
  await page.goto('/dashboard/team');
  await expect(page).toHaveURL(/dashboard\/my$/);
  await shot(page, 'admin-employee-view');
  if(await page.locator('.account-menu').getAttribute('open')===null)await page.locator('.account-menu > summary').click();
  await page.getByRole('button', {name: 'Admin view', exact: true}).click();
  await expect(page).toHaveURL(/dashboard$/);
  await expect(page.locator('.topnav a')).toHaveCount(6);
  expect((await page.request.get('/api/users')).status()).toBe(200);
  expect(errors).toEqual([]);
});

test('employees cannot enable admin mode with the endpoint or a forged view cookie', async ({employeePage: page}) => {
  expect((await page.request.post('/api/view-mode', {data: {mode: 'admin'}})).status()).toBe(403);
  await page.context().addCookies([{name: 'bp_view', value: 'admin', url:BASE_URL}]);
  await page.goto('/dashboard');
  await expect(page.locator('.view-mode')).toHaveCount(0);
  await expect(page.locator('.topnav a')).toHaveCount(1);
  expect((await page.request.get('/api/users')).status()).toBe(403);
});

test('view switching protects failed drafts and handles a failed request', async ({adminPage: page}) => {
  sql(`insert into bolna_assignments(entity_type, entity_id, assignee, assigned_by) values ('call', '${ownCall}', 'admin@eval.test', 'admin@eval.test')`);
  await page.goto('/dashboard/my');
  await page.route('**/api/my-work/assignments/*', route => route.fulfill({status: 500, json: {error: 'test failure'}}));
  const input = page.getByRole('textbox', {name: 'Your notes'}).first();
  await input.fill('Keep my draft'); await input.blur();
  await expect(page.locator('.sheet-save-status')).toContainText("hasn't saved");
  if(await page.locator('.account-menu').getAttribute('open')===null)await page.locator('.account-menu > summary').click();
  await page.getByRole('button', {name: 'Employee view', exact: true}).click();
  await expect(page.locator('.snackbar')).toContainText('Save or discard');
  await expect(page).toHaveURL(/dashboard\/my$/);
  await expect(input).toHaveValue('Keep my draft');
  await page.locator('.sheet-save-status').getByRole('button', {name: /Discard/}).click();
  await page.getByRole('dialog').getByRole('button', {name: 'Discard changes', exact: true}).click();
  await page.route('**/api/view-mode', route => route.fulfill({status: 500, json: {error: 'test failure'}}));
  if(await page.locator('.account-menu').getAttribute('open')===null)await page.locator('.account-menu > summary').click();
  await page.getByRole('button', {name: 'Employee view', exact: true}).click();
  await expect(page.locator('.snackbar')).toContainText("Couldn't confirm");
  if(await page.locator('.account-menu').getAttribute('open')===null)await page.locator('.account-menu > summary').click();
  await expect(page.getByRole('button', {name: 'Admin view', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await page.unroute('**/api/view-mode');
  if(await page.locator('.account-menu').getAttribute('open')===null)await page.locator('.account-menu > summary').click();
  await page.getByRole('button', {name: 'Employee view', exact: true}).click();
  await expect(page).toHaveURL(/dashboard\/my$/);
});

test('demoting an admin in employee view removes the ability to switch back', async ({adminPage: page}) => {
  expect((await page.request.post('/api/view-mode', {data: {mode: 'employee'}})).status()).toBe(200);
  sql("update bolna_app_users set role = 'employee' where email = 'admin@eval.test'");
  expect((await page.request.post('/api/view-mode', {data: {mode: 'admin'}})).status()).toBe(403);
  await page.goto('/dashboard/my');
  await expect(page.locator('.view-mode')).toHaveCount(0);
  expect((await page.request.get('/api/users')).status()).toBe(403);
});

for (const width of [1366, 1024, 390]) {
  test(`assignment controls and view toggle fit at ${width}px in both themes`, async ({adminPage: page, shot}) => {
    await page.setViewportSize({width, height: 900});
    await page.goto('/dashboard/assignments');
    for (const dark of [false, true]) {
      if (dark) await page.getByRole('button', {name: 'Toggle dark mode'}).click();
      expect(await bodyOverflowsX(page)).toBe(false);
      if(await page.locator('.account-menu').getAttribute('open')===null)await page.locator('.account-menu > summary').click();
      await expect(page.getByRole('button', {name: 'Employee view', exact: true})).toBeVisible();
      await expect(page.getByRole('button', {name: 'Sign out', exact: true})).toBeVisible();
      await expect(page.locator('.colheads th').nth(1)).toBeVisible();
      await shot(page, `assignments-${width}-${dark ? 'dark' : 'light'}`);
    }
  });
}
