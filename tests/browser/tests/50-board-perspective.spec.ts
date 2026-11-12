import { test, expect, bodyOverflowsX } from './fixtures';
import { execFileSync } from 'node:child_process';
import { ADMIN, EMPLOYEE, EMPLOYEE2, CONTAINER } from '../lib/env.mjs';
import { unreadableText } from '../lib/visual-audit';

const sql = (statement: string) => execFileSync('podman', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-c', statement]);
const perspective = (email = EMPLOYEE.email) => `/dashboard/board?${new URLSearchParams({ employee: email })}`;
const cards = '.board-columns .board-card';
const listing = 'a0000000-0000-4000-8000-000000000001';

test('admins see the employee board with normal controls and confirmation before writing', async ({ adminPage: page, employeePage }) => {
  await employeePage.goto('/dashboard/board');
  const expectedCards = await employeePage.locator(cards).allTextContents();
  const expectedCounts = await employeePage.locator('.board-column-count').allTextContents();
  const writes: string[] = [];
  page.on('request', request => { if (['POST', 'PATCH', 'DELETE'].includes(request.method()) && request.url().includes('/api/board/')) writes.push(request.url()); });
  await page.goto('/dashboard/board');
  const picker = page.getByLabel('View work as');
  await expect(picker.locator('option')).toHaveText(['My work (me)', 'Priya Eval (priya@eval.test)', 'Raj Eval (raj@eval.test)']);
  await expect(page.locator('.board-summary')).toHaveText('0 cards');
  await picker.selectOption(EMPLOYEE.email);
  await expect(page.getByText('Confirm once per entry', { exact: true })).toBeVisible();
  await expect(page.locator(cards)).toHaveText(expectedCards);
  await expect(page.locator('.board-column-count')).toHaveText(expectedCounts);
  await expect(page.locator(cards)).toHaveAttribute('draggable', 'true');
  const activity = page.waitForResponse(r => r.url().includes('/api/board/timeline?'));
  await page.locator(cards).click();
  const activityResponse = await activity;
  expect(new URL(activityResponse.url()).searchParams.get('employee')).toBe(EMPLOYEE.email);
  expect(activityResponse.status()).toBe(200);
  const panel = page.getByRole('complementary');
  await expect(panel.getByRole('heading', { level: 3 })).toHaveText(['Next step', 'Employee notes', 'Listing details', 'Calls', 'Activity']);
  await expect(panel.getByRole('textbox', { name: 'Employee notes' })).toBeEditable();
  await expect(panel.getByRole('combobox', { name: 'Stage' })).toBeEnabled();
  await expect(panel.getByRole('button', { name: /manual calls/ })).toHaveCount(0);
  const transfer = await page.evaluateHandle(() => { const data = new DataTransfer(); data.setData('application/x-callongo-card', document.querySelector('.board-card')!.getAttribute('data-card-id')!); return data; });
  await page.locator('.board-column[data-code="2A"]').dispatchEvent('drop', { dataTransfer: transfer });
  const confirm = page.getByRole('dialog', { name: 'Edit this entry?', exact: true });
  await expect(confirm).toBeVisible();
  expect(writes).toEqual([]);
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.board-column[data-code="1"] .board-card')).toHaveCount(1);
  expect(writes).toEqual([]);
});

test('employee scope follows full details, AI calls, saved summaries and task tabs', async ({ adminPage: page }) => {
  await page.goto(perspective());
  await page.locator(cards).click();
  const panel = page.getByRole('complementary');
  const aiResponse = page.waitForResponse(r => r.url().includes(`/api/details/record/${listing}/ai?`));
  await panel.getByRole('button', { name: 'Show AI calls' }).click();
  const ai = await aiResponse;
  expect(ai.status()).toBe(200);
  expect(new URL(ai.url()).searchParams.get('employee')).toBe(EMPLOYEE.email);
  const summaryResponse = page.waitForResponse(r => r.url().includes(`/api/details/record/${listing}?`));
  await panel.getByRole('button', { name: 'View saved record details' }).click();
  expect(new URL((await summaryResponse).url()).searchParams.get('employee')).toBe(EMPLOYEE.email);
  await expect(panel.getByRole('region', { name: 'Saved AI summary' })).toContainText('AI notes');
  const detailsResponse = page.waitForResponse(r => r.url().includes(`/api/details/record/${listing}?employee=`));
  await panel.getByRole('button', { name: 'Details for this listing' }).click();
  const details = await (await detailsResponse).json();
  expect(details.history.every((entry: { assignee: string }) => entry.assignee === EMPLOYEE.email)).toBe(true);
  await expect(page.getByRole('dialog').getByRole('tab', { name: 'Manual activity' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close details' }).click();
  await panel.getByRole('tab', { name: 'AI follow-up' }).click();
  const callResponse = page.waitForResponse(r => r.url().includes('/ai?'));
  await panel.getByRole('button', { name: 'Show AI calls' }).click();
  const call = await callResponse;
  expect(new URL(call.url()).searchParams.get('employee')).toBe(EMPLOYEE.email);
  expect(await call.json()).toMatchObject({ scope: 'execution' });
  await panel.getByRole('button', { name: 'History options' }).click();
  await expect(panel.getByLabel('AI history scope')).toHaveCount(0);
  expect((await page.request.get('/api/details/record/a0000000-0000-4000-8000-000000000003/ai?employee=priya%40eval.test')).status()).toBe(404);
});

test('filters, saved views, clearing and refresh retain the selected employee', async ({ adminPage: page }) => {
  await page.goto(perspective());
  await page.getByLabel('Work type', { exact: true }).selectOption('record');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove Work type filter: record' })).toBeEnabled();
  await expect(page.getByLabel('View work as')).toHaveValue(EMPLOYEE.email);
  await expect(page.locator(cards)).toHaveCount(1);
  await page.locator('.views-menu > summary').click();
  await page.getByRole('button', { name: 'Save current filters…' }).click();
  await page.getByRole('textbox', { name: 'View name' }).fill('Listings only');
  await page.getByRole('button', { name: 'Save view', exact: true }).click();
  await page.getByLabel('View work as').selectOption(EMPLOYEE2.email);
  await expect(page.locator(cards)).toContainText('Suresh Kumar');
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page.getByLabel('Work type', { exact: true })).toHaveValue('');
  await expect(page.locator('.board-filters')).toHaveAttribute('aria-busy', 'false');
  await page.locator('.views-menu > summary').click();
  await page.getByRole('button', { name: 'Listings only', exact: true }).click();
  await expect(page.getByLabel('Work type', { exact: true })).toHaveValue('record');
  await expect(page.getByLabel('View work as')).toHaveValue(EMPLOYEE2.email);
  await page.getByRole('button', { name: 'Remove Work type filter: record' }).click();
  await expect(page.getByLabel('Work type', { exact: true })).toHaveValue('');
  await expect(page.locator('.board-filters')).toHaveAttribute('aria-busy', 'false');
  await page.getByLabel('Search the board').fill('Suresh');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page).toHaveURL(/q=Suresh/);
  await expect(page.locator(cards)).toHaveCount(1);
  await page.reload();
  await expect(page.getByLabel('View work as')).toHaveValue(EMPLOYEE2.email);
  await expect(page.getByLabel('Search the board')).toHaveValue('Suresh');
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page.getByLabel('Search the board')).toHaveValue('');
  expect(new URL(page.url()).searchParams.get('employee')).toBe(EMPLOYEE2.email);
});

test('column paging stays scoped and switching employees resets loaded pages and the panel', async ({ adminPage: page }) => {
  sql(`insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state,stage,updated_at)
    select 'record',gen_random_uuid(),'priya@eval.test','admin@eval.test','open','inbound',now()-make_interval(mins=>g) from generate_series(1,55) g;`);
  await page.goto(perspective());
  const inbound = page.locator('.board-column[data-code="1"]');
  await expect(inbound.locator('.board-card')).toHaveCount(50);
  await inbound.locator('.board-cards').evaluate(el => el.scrollTo({ top: el.scrollHeight }));
  await expect(inbound.locator('.board-card')).toHaveCount(56);
  expect(new URL(page.url()).searchParams.get('employee')).toBe(EMPLOYEE.email);
  expect(new URL(page.url()).searchParams.get('inbound_cards')).toBe('100');
  await inbound.locator('.board-card').filter({ hasText: 'Raghav Sharma' }).click();
  await expect(page.getByRole('complementary')).toBeVisible();
  await page.getByLabel('View work as').selectOption(EMPLOYEE2.email);
  await expect(page.locator(cards)).toHaveCount(1);
  await expect(page.locator(cards)).toContainText('Suresh Kumar');
  await expect(page.getByRole('complementary')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has('inbound_cards')).toBe(false);
  await page.getByLabel('View work as').selectOption(EMPLOYEE.email);
  await expect(inbound.locator('.board-card')).toHaveCount(50);
  expect(await inbound.locator('.board-cards').evaluate(el => el.scrollTop)).toBe(0);
});

test('Junk proposals can be inspected without confirming or scheduling anything', async ({ adminPage: page }) => {
  sql(`insert into bolna_manual_attempts(id,assignment_id,actor,assignee,occurred_at,disposition,request_hash)
    select gen_random_uuid(),a.id,a.assignee,a.assignee,((now() at time zone 'Asia/Kolkata')::date - g + time '12:00') at time zone 'Asia/Kolkata','no_answer','fixture'
    from bolna_assignments a cross join generate_series(1,5) g where a.id=1;`);
  await page.goto(perspective());
  await page.getByRole('region', { name: 'Junk proposals' }).getByRole('button', { name: 'Review 1 lead' }).click();
  const review = page.getByRole('dialog', { name: 'Review Junk proposals' });
  await expect(review.locator('.board-proposal')).toContainText('Raghav Sharma');
  await expect(review.locator('.board-proposal')).toContainText('5 strikes');
  await expect(review.getByRole('button', { name: /Move .* to Junk|Keep trying/ })).toHaveCount(2);
  await expect(review.getByLabel('Try again on')).toBeEnabled();
  await review.getByRole('button', { name: 'Move Raghav Sharma to Junk' }).click();
  await page.getByRole('dialog', { name: 'Edit this entry?', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(review.locator('.board-proposal')).toContainText('Raghav Sharma');
});

test('returning to own work restores editing, and empty and unavailable employees are handled', async ({ adminPage: page }) => {
  sql(`insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state)
    values ('record','a0000000-0000-4000-8000-000000000006','${ADMIN.email}','${ADMIN.email}','open');
    insert into bolna_app_users(email,role,active) values ('new@eval.test','employee',true);`);
  await page.goto(perspective());
  await page.getByLabel('View work as').selectOption('');
  await expect(page.locator(cards)).toHaveAttribute('draggable', 'true');
  await page.locator(cards).click();
  const panel = page.getByRole('complementary');
  await expect(panel.getByLabel('Stage', { exact: true })).toBeEnabled();
  await panel.getByRole('textbox', { name: 'Your notes' }).fill('My own admin task');
  const save = page.waitForResponse(r => r.url().includes('/api/board/tasks/') && r.request().method() === 'PATCH');
  await panel.getByRole('button', { name: 'Save notes' }).click();
  expect((await save).status()).toBe(200);
  await page.getByLabel('View work as').selectOption('new@eval.test');
  await expect(page.locator('.board-summary')).toHaveText('0 cards');
  await expect(page.getByText('Confirm once per entry', { exact: true })).toBeVisible();
  for (const email of ['gone@eval.test', 'missing@eval.test']) {
    await page.goto(perspective(email));
    await expect(page.getByRole('heading', { name: '404', exact: true })).toBeVisible();
  }
});

test('employees and admin employee mode cannot widen their scope through the URL', async ({ adminPage, employeePage: page }) => {
  await page.goto(perspective(EMPLOYEE2.email));
  await expect(page.getByLabel('View work as')).toHaveCount(0);
  await expect(page.locator(cards)).toContainText('Raghav Sharma');
  await expect(page.locator(cards)).not.toContainText('Suresh Kumar');
  await expect(page.locator(cards)).toHaveAttribute('draggable', 'true');
  expect((await adminPage.request.post('/api/view-mode', { data: { mode: 'employee' } })).status()).toBe(200);
  await adminPage.goto(perspective());
  await expect(adminPage.getByLabel('View work as')).toHaveCount(0);
  await expect(adminPage.locator(cards)).toHaveCount(0);
});

for (const theme of ['light', 'dark']) for (const width of [1366, 390]) {
  test(`employee board fits at ${width}px in ${theme}`, async ({ adminPage: page, shot }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    await page.goto(perspective());
    const picker = page.getByLabel('View work as');
    await expect(picker).toBeInViewport();
    await picker.focus();
    await expect(picker).toBeFocused();
    expect(await bodyOverflowsX(page)).toBe(false);
    expect(await unreadableText(page, '.board-perspective')).toEqual([]);
    await shot(page, `board-perspective-${width}-${theme}`);
    await page.locator(cards).click();
    await expect(page.getByRole('complementary').getByRole('heading', { name: 'Employee notes' })).toBeVisible();
    await shot(page, `board-perspective-panel-${width}-${theme}`);
  });
}
