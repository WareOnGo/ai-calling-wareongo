import { test, expect, bodyOverflowsX } from './fixtures';
import { execFileSync } from 'node:child_process';
import { Client } from 'pg';
import { CONTAINER, DB_URL } from '../lib/env.mjs';

const sql = (statement: string) => execFileSync('podman', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-c', statement]);
const mine = (page: any) => page.locator('[data-entity="record"] tbody tr').filter({hasText: 'Raghav Sharma'});

for (const [query, count, subject] of [
  ['q=verify%20area', 1, 'Raghav Sharma'],
  ['q=8000', 1, 'Meera Nair'],
  ['q=9811100001', 2, 'Raghav Sharma'],
  ['type=call', 1, 'Raghav Sharma'],
  ['outcome=Available', 1, 'Meera Nair'],
  ['outcome=none', 2, 'Raghav Sharma'],
  ['city=Delhi', 1, 'Meera Nair'],
  ['assigned_by=admin%40eval.test&added_to_db=no', 3, 'Raghav Sharma'],
] as const) {
  test(`My Work applies ${query} before counting and paging`, async ({employeePage: page}) => {
    await page.goto(`/dashboard/my?${query}`);
    await expect(page.locator('tbody tr')).toHaveCount(count);
    await expect(page.locator('.work-content')).toContainText(subject);
    await expect(page.locator('.work-result-summary')).toContainText(`${count} assignment`);
    await expect(page.locator('.work-tabs a').first()).toContainText(String(count));
    await expect(page.locator('.work-scope')).toHaveText('Counts match your filters');
  });
}

test('assigner notes are labelled, expandable, and separate from personal updates', async ({employeePage: page, shot}) => {
  sql("update bolna_assignments set note = repeat('Please verify the rental terms and access road. ', 10) || 'Call after 4 pm.' where id = 1");
  await page.goto('/dashboard/my');
  const row = mine(page);
  await expect(row.locator('.work-note-label')).toHaveText("Assigner's note");
  await expect(row.locator('.work-assigned-meta')).toContainText('Assigned by Eval Admin');
  await expect(row.locator('.work-assigned-meta time')).toHaveAttribute('datetime', /\d/);
  await row.getByRole('button', {name: 'Read full note'}).click();
  await expect(row.locator('.brief-preview')).toHaveCount(0);
  await expect(row.locator('.brief')).toContainText('Call after 4 pm.');
  await shot(page, 'my-work-full-assignment-note');
  await row.getByRole('button', {name: 'Show less'}).click();
  const response = page.waitForResponse(r => r.url().endsWith('/api/assignments/1') && r.request().method() === 'PATCH');
  await row.getByRole('textbox', {name: 'Your notes', exact: true}).fill('Spoke to owner; visit tomorrow');
  await row.getByRole('textbox', {name: 'Your notes', exact: true}).blur();
  expect((await response).status()).toBe(200);
  await expect(page.locator('.sheet-save-status')).toHaveText('All changes saved');
  await page.reload();
  await expect(mine(page).locator('.brief')).toContainText('Call after 4 pm.');
  await expect(mine(page).getByRole('textbox', {name: 'Your notes', exact: true})).toHaveValue('Spoke to owner; visit tomorrow');
});

test('property chips omit missing rent and empty instructions in AI follow-ups', async ({employeePage: page, shot}) => {
  sql("update bolna_call_logs set expected_rent = null, context_details = jsonb_set(context_details, '{recipient_data,area}', '\"Visakhapatnam\"') where id = 'c0000000-0000-4000-8000-000000000001'; update bolna_assignments set note = null where entity_type = 'call'; update bolna_app_users set name = null where email = 'admin@eval.test'");
  await page.goto('/dashboard/my?type=call');
  const row = page.locator('[data-entity="call"] tbody tr');
  await expect(row.locator('.work-fact').filter({has: page.locator('dt', {hasText: /^City$/})})).toContainText('Visakhapatnam');
  await expect(row.locator('.work-fact').filter({has: page.locator('dt', {hasText: /^Area$/})})).toContainText('12,000 sqft');
  await expect(row.locator('.work-fact dt', {hasText: /^Rent$/})).toHaveCount(0);
  await expect(row.locator('.work-assignment-note')).toHaveCount(0);
  await expect(row).not.toContainText('No assigner note');
  await expect(row.locator('.work-assigned-meta')).toContainText('admin@eval.test');
  await expect(row.locator('.work-person-heading').getByRole('button', {name: 'Details for call', exact: true})).toBeVisible();
  await shot(page, 'my-work-compact-followup');
});

test('status tabs and clearing a filter preserve the rest of the view', async ({employeePage: page}) => {
  await page.goto('/dashboard/my?city=Rajkot&type=record');
  await page.getByRole('navigation', {name: 'Work status'}).getByRole('link', {name: /^Done/}).click();
  await expect(page).toHaveURL(/view=done/);
  expect(new URL(page.url()).searchParams.get('city')).toBe('Rajkot');
  expect(new URL(page.url()).searchParams.get('type')).toBe('record');
  await expect(page.locator('.work-empty')).toContainText('No work matches these filters');
  await page.getByRole('button', {name: 'Remove City filter'}).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody:visible')).toContainText('Meera Nair');
  expect(new URL(page.url()).searchParams.get('view')).toBe('done');
  await page.getByRole('button', {name: 'Clear filters', exact: true}).click();
  await expect(page).toHaveURL(/\/dashboard\/my\?view=done$/);
});

test('advanced filters and saved views restore the intended personal workload', async ({employeePage: page}) => {
  await page.goto('/dashboard/my?view=open');
  await page.getByRole('button', {name: 'Toggle filters'}).click();
  await page.getByRole('textbox', {name: 'Filter by city'}).fill('Rajkot');
  await page.getByRole('combobox', {name: 'Assigned by', exact: true}).selectOption('admin@eval.test');
  await page.getByRole('combobox', {name: 'Sort my work'}).selectOption('oldest');
  await page.getByRole('button', {name: 'Apply', exact: true}).click();
  await expect(page.locator('.applied-filters')).toContainText('Sort: Oldest assigned');
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await page.locator('.views-menu > summary').click();
  await page.getByRole('button', {name: 'Save current filters…'}).click();
  await page.getByRole('dialog').getByRole('textbox').fill('Rajkot follow-ups');
  await page.getByRole('button', {name: 'Save view', exact: true}).click();
  await page.goto('/dashboard/my');
  await page.locator('.views-menu > summary').click();
  await page.getByRole('button', {name: 'Rajkot follow-ups', exact: true}).click();
  await expect(page.locator('.applied-filters')).toContainText('City: Rajkot');
  expect(new URL(page.url()).searchParams.get('view')).toBe('open');
  expect(new URL(page.url()).searchParams.get('sort')).toBe('oldest');
  await page.locator('.views-menu > summary').click();
  await page.getByRole('button', {name: 'No manual result', exact: true}).click();
  await expect(page).toHaveURL(/view=open&outcome=none/);
});

test('personal filters cannot reveal another employee or dropped work', async ({employeePage: page}) => {
  sql("update bolna_assignments set assigned_by = 'raj@eval.test' where id = 4");
  await page.goto('/dashboard/my?assignee=raj%40eval.test&q=Suresh');
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await expect(page.locator('.work-empty')).toContainText('No work matches');
  await page.goto('/dashboard/my?q=Latha');
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await page.goto('/dashboard/my');
  await page.getByRole('button', {name: 'Toggle filters'}).click();
  await expect(page.getByRole('combobox', {name: 'Assigned by', exact: true}).locator('option')).toHaveCount(2);
  await expect(page.getByRole('combobox', {name: 'Assigned by', exact: true})).not.toContainText('Raj Eval');
});

test('filters apply to the entire workload and pagination keeps them', async ({employeePage: page}) => {
  sql(`insert into raw_records (id,source,source_record_id,owner_name,city) select md5('my-filter-'||n)::uuid,'my-filter',n::text,'Followup '||n,'Pune' from generate_series(1,28) n;
    insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,note,assigned_at) select 'record',id,'priya@eval.test','admin@eval.test','Verify rent',now() - source_record_id::int * interval '1 day' from raw_records where source='my-filter';`);
  await page.goto('/dashboard/my?city=Pune&type=record&view=open&sort=oldest');
  await expect(page.locator('tbody tr')).toHaveCount(25);
  await expect(page.locator('.work-result-summary')).toContainText('28 open assignments matching filters');
  await expect(page.locator('tbody .who-name').first()).toHaveText('Followup 28');
  await page.locator('.work-pager').getByRole('link', {name: 'Next', exact: true}).click();
  await expect(page.locator('tbody tr')).toHaveCount(3);
  const params = new URL(page.url()).searchParams;
  expect(params.get('city')).toBe('Pune');expect(params.get('sort')).toBe('oldest');expect(params.get('view')).toBe('open');
  await expect(page.locator('tbody .rownum').first()).toHaveText('26');
  await page.getByRole('button', {name: 'Toggle filters'}).click();
  await page.getByRole('textbox', {name: 'Filter by city'}).fill('Rajkot');
  await page.getByRole('button', {name: 'Apply', exact: true}).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  expect(new URL(page.url()).searchParams.has('records_page')).toBe(false);
});

test('filtering retains visible rows while waiting and protects failed drafts', async ({employeePage: page}) => {
  await page.goto('/dashboard/my');
  let release!: () => void; const gate = new Promise<void>(resolve => release = resolve);
  await page.route('**/dashboard/my?**', async route => {if (new URL(route.request().url()).searchParams.get('q') === 'Meera') await gate; await route.continue();});
  await page.getByRole('textbox', {name: 'Search my work'}).fill('Meera');
  await page.getByRole('button', {name: 'Apply', exact: true}).click();
  try {await expect(page.locator('.navigation-progress')).toBeVisible();await expect(page.locator('tbody tr')).toHaveCount(3);} finally {release();}
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.goto('/dashboard/my');
  await page.route('**/api/assignments/1', r => r.fulfill({status: 500, json: {error: 'test failure'}}));
  await mine(page).getByRole('textbox', {name: 'Your notes', exact: true}).fill('Keep my failed draft');
  await mine(page).getByRole('textbox', {name: 'Your notes', exact: true}).blur();
  await expect(page.locator('.sheet-save-status')).toContainText("hasn't saved");
  await page.getByRole('combobox', {name: 'Work type', exact: true}).selectOption('call');
  await page.getByRole('button', {name: 'Apply', exact: true}).click();
  await expect(page).toHaveURL(/\/dashboard\/my$/);
  await expect(mine(page).getByRole('textbox', {name: 'Your notes', exact: true})).toHaveValue('Keep my failed draft');
});

for (const width of [1366, 1024, 390]) {
  test(`My Work filters and notes fit at ${width}px in both themes`, async ({employeePage: page, shot}) => {
    const errors: string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.setViewportSize({width, height: 900});
    await page.goto('/dashboard/my');
    for (const dark of [false, true]) {
      if (dark) await page.getByRole('button', {name: 'Toggle dark mode'}).click();
      expect(await bodyOverflowsX(page)).toBe(false);
      if (width >= 1024) expect(await page.locator('.worklist .gridwrap').evaluateAll(els=>els.every(el=>el.scrollWidth <= el.clientWidth+1))).toBe(true);
      await expect(page.getByRole('combobox', {name: 'Work type', exact: true})).toBeVisible();
      await expect(mine(page).locator('.work-assignment-note')).toBeVisible();
      await shot(page, `my-work-filters-${width}-${dark ? 'dark' : 'light'}`);
    }
    await page.getByRole('button', {name: 'Toggle filters'}).click();
    expect(await bodyOverflowsX(page)).toBe(false);
    await shot(page, `my-work-more-filters-${width}`);
    expect(errors).toEqual([]);
  });
}

test('filtered My Work loading uses the selected channel and real toolbar geometry', async ({employeePage: page}) => {
  await page.setViewportSize({width: 390, height: 900});
  const errors: string[] = [];page.on('pageerror', error => errors.push(error.message));
  const db = new Client({connectionString: DB_URL, ssl:false});await db.connect();
  let before: {y:number;height:number}|null=null;
  try {
    await db.query('begin');await db.query('lock table bolna_assignments in access exclusive mode');
    await page.goto('/dashboard/my?type=call&city=Rajkot&outcome=none', {waitUntil: 'commit'});
    await expect(page.locator('[data-loading-view="my"] .section-head:visible')).toHaveCount(1);
    await expect(page.locator('.worklist')).toHaveCount(1);
    // Hydration can replace the loading header after the locator resolves but
    // before boundingBox reads it. Measure a live header while the DB is locked.
    await expect.poll(async () => {
      before = await page.locator('[data-loading-view="my"] .section-head:visible').boundingBox();
      return before?.height ?? 0;
    }).toBeGreaterThan(0);
    await page.screenshot({path: 'shots/my-work-filtered-loading-390.png', animations: 'disabled'});
  } finally {await db.query('commit');await db.end();}
  await expect(page.locator('[data-loading-view]')).toHaveCount(0);
  await expect(page.locator('.dashboard-content')).toHaveAttribute('data-hydrated','true');
  await expect(page.locator('.worklist')).toHaveCount(1);
  let after: {y:number;height:number}|null=null;
  await expect.poll(async () => {
    after = await page.locator('.worklist .section-head:visible').boundingBox();
    return after?.height ?? 0;
  }).toBeGreaterThan(0);
  expect(Math.abs(after!.y - before!.y)).toBeLessThanOrEqual(2);
  expect(after!.height).toBe(before!.height);
  expect(errors).toEqual([]);
});
