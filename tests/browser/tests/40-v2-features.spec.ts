import {test,expect,type Page} from '@playwright/test';
import pg from 'pg';
import {readFileSync} from 'node:fs';
import {ADMIN,EMPLOYEE,DB_URL,PORT} from '../lib/env.mjs';
import {sessionCookie} from '../lib/session.mjs';

// Use the guarded local DB URL directly so these checks also run without a container runtime.
test.use({actionTimeout:10000});
const pool=new pg.Pool({connectionString:DB_URL,ssl:false});
test.beforeEach(async()=>{await pool.query(readFileSync(new URL('../scripts/seed.sql',import.meta.url),'utf8'));});
test.afterAll(async()=>{await pool.end();});
async function login(page:Page,email=ADMIN.email) {
  await page.context().addCookies([sessionCookie(email,PORT) as never]);
  await page.route('**/api/balance*',route=>route.fulfill({json:{balance:42,unit:'USD',state:'fresh',refreshedAt:new Date().toISOString(),low:false,message:null}}));
}
async function ready(page:Page) {
  await expect(page.locator('.dashboard-content')).toHaveAttribute('data-hydrated','true');
  await expect(page.locator('.dashboard-content')).toHaveAttribute('aria-busy','false');
  await expect(page.locator('[data-loading-view]')).toHaveCount(0);
  await expect(page.locator('[hidden][id^="S:"]')).toHaveCount(0);
}
async function panel(page:Page) {
  await page.getByRole('button',{name:'Toggle filters',exact:true}).click();
  return page.getByRole('dialog',{name:'Filters',exact:true});
}
async function mismatches(page:Page) {
  const filters=await panel(page);
  await filters.getByRole('tab',{name:'Results',exact:true}).click();
  await filters.getByLabel('AI–human comparison',{exact:true}).selectOption('mismatch');
  await filters.getByRole('button',{name:'Apply',exact:true}).click();await ready(page);
}

test('assignment bulk selection previews and unassigns only open rows',async({page},info)=>{
  await login(page);await page.goto('/dashboard/assignments');await ready(page);
  const invalidJson=await page.request.post('/api/assignments/bulk',{headers:{'content-type':'application/json'},data:Buffer.from('{')});
  expect(invalidJson.status()).toBe(400);expect(await invalidJson.json()).toMatchObject({error:'Invalid JSON body'});
  expect((await page.request.post('/api/assignments/bulk',{data:{action:'unassign'}})).status()).toBe(400);
  const deduplicated=await page.request.post('/api/assignments/bulk',{data:{action:'unassign',ids:['1','1']}});
  expect(deduplicated.status()).toBe(200);expect(await deduplicated.json()).toMatchObject({selected:1,eligible:1});
  await page.locator('input.rowsel[data-id="1"]').check();
  await page.getByLabel('Select assignment for Meera Nair',{exact:true}).check();
  await expect(page.getByLabel('Select all assignments on this page')).toHaveJSProperty('indeterminate',true);
  await page.getByRole('button',{name:'Unassign selected',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Unassign assignments',exact:true});
  await expect(dialog).toContainText('1 of 2 assignments');
  await expect(dialog).toContainText('1 skipped: not open');
  await page.screenshot({path:info.outputPath('bulk-preview.png'),fullPage:true});
  await dialog.getByRole('button',{name:'Unassign 1',exact:true}).click();await expect(dialog).toHaveCount(0);await ready(page);
  expect((await pool.query('select state from bolna_assignments where id=1')).rows[0].state).toBe('dropped');
  expect((await pool.query('select state from bolna_assignments where id=2')).rows[0].state).toBe('done');
  await expect(page.getByRole('group',{name:'Bulk assignment actions'})).toHaveCount(0);
});

test('all-matching selection respects the caller filter and is cleared on navigation',async({page})=>{
  await login(page);await page.goto('/dashboard/assignments?assignee=priya%40eval.test');await ready(page);
  await page.locator('input.rowsel[data-id="1"]').check();
  await page.getByRole('button',{name:/Select all .* matching/}).click();
  await page.getByRole('button',{name:'Unassign selected',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Unassign assignments',exact:true});
  await expect(dialog).toContainText('2 of 4 assignments');
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await mismatches(page);
  expect(new URL(page.url()).searchParams.get('assignee')).toBe('priya@eval.test');
  await expect(page.getByRole('group',{name:'Bulk assignment actions'})).toHaveCount(0);
});

test('city and state use source fallback and mismatch filter isolates comparable calls',async({page},info)=>{
  await pool.query("update bolna_call_logs set context_details='{}'::jsonb,llm_availability='Available',status='completed' where id='c0000000-0000-4000-8000-000000000001'; update bolna_assignments set outcome='Unavailable' where id=5");
  await login(page);await page.goto('/dashboard/assignments');await ready(page);
  const filters=await panel(page);await filters.getByLabel('City',{exact:true}).fill('Rajkot');await filters.getByLabel('Filter by state').fill('Gujarat');
  await filters.getByRole('button',{name:'Apply',exact:true}).click();await ready(page);
  await expect(page.locator('.assignment-sheet tbody tr')).toHaveCount(2);
  await expect(page.getByRole('navigation',{name:'Assignment views'})).toHaveCount(0);
  await mismatches(page);
  await expect(page.locator('.assignment-sheet tbody tr')).toHaveCount(1);await expect(page.locator('.assignment-sheet tbody')).toContainText('≠ AI');
  expect(new URL(page.url()).searchParams.get('region')).toBe('Gujarat');
  const chip=page.getByRole('button',{name:'Remove AI–human comparison filter: mismatch',exact:true});
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('Results disagree');
  await page.screenshot({path:info.outputPath('mismatch-review.png'),fullPage:true});
  await chip.click();await ready(page);
  await expect(page.locator('.assignment-sheet tbody tr')).toHaveCount(2);
  expect(new URL(page.url()).searchParams.get('region')).toBe('Gujarat');
  expect(new URL(page.url()).searchParams.get('city')).toBe('Rajkot');
  await page.setViewportSize({width:390,height:844});await panel(page);
  await page.screenshot({path:info.outputPath('assignment-filters-mobile.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1)).toBe(true);
});

test('manual batch rows keep caller notes, follow-ups and ownership history accessible',async({page},info)=>{
  const notes='Owner asked to discuss rent after the site visit.\nThe available area is 12,000 sq ft; confirm access for trucks.\nSend the location before calling again.\nKeep this final instruction visible when expanded.';
  await pool.query(`update bolna_assignments set remarks=$1,disposition='callback',last_attempt_at='2026-10-15T04:00:00Z',next_due_at='2026-10-16T04:00:00Z',added_to_db=true where id=1`,[notes]);
  await pool.query(`insert into bolna_manual_attempts(id,assignment_id,actor,assignee,occurred_at,disposition,notes,next_due_at,request_hash)
    values(gen_random_uuid(),1,'priya@eval.test','priya@eval.test','2026-10-15T04:00:00Z','callback','Owner requested a call after the site visit.','2026-10-16T04:00:00Z','batch-notes-fixture')`);
  await pool.query("update bolna_assignments set completed_at='2026-10-15T06:00:00Z',closure_reason='resolved',added_to_db=true where id=2");
  await pool.query("update bolna_assignments set remarks='Original caller requested the floor plan.' where id=3");
  await pool.query(`insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,remarks)
    values('record','a0000000-0000-4000-8000-000000000005','raj@eval.test','admin@eval.test','New owner will arrange the visit.')`);
  await login(page);await page.goto('/dashboard/batches/manual/legacy');await ready(page);
  const rows=page.locator('.batch-grid tbody tr');
  const followup=rows.filter({hasText:notes});
  await expect(followup.locator('.batch-caller')).toContainText('Priya Eval');
  await expect(followup.locator('.batch-caller')).toContainText('Assigned by Eval Admin');
  await expect(followup.locator('.assignment-notes .notes-preview')).toBeVisible();
  await followup.getByRole('button',{name:'Show more',exact:true}).click();
  await expect(followup.locator('.assignment-notes .notes-preview')).toHaveCount(0);
  await followup.getByText('Assignment instructions',{exact:true}).click();
  await expect(followup.getByText('verify area + rent',{exact:true})).toBeVisible();
  await expect(followup.locator('.batch-call-activity')).toContainText('Follow-up:');
  await expect(followup.locator('.batch-call-activity')).toContainText('1 logged call');
  await expect(followup).toContainText('Marked added to DB');
  await followup.getByRole('button',{name:'Call history for record',exact:true}).click();
  const drawer=page.getByRole('dialog');
  await expect(drawer.getByRole('tab',{name:'Manual activity',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(drawer.getByText('Owner requested a call after the site visit.',{exact:true})).toBeVisible();
  await drawer.getByRole('button',{name:'Close details',exact:true}).click();
  const original=rows.filter({hasText:'Original caller requested the floor plan.'});
  await expect(original.locator('.batch-caller')).toContainText('Priya Eval');
  await expect(original.locator('.batch-caller')).toContainText('Now with Raj Eval');
  await expect(original.locator('.batch-caller-notes')).not.toContainText('New owner will arrange the visit.');
  const completed=rows.filter({hasText:'Meera Nair'});
  await expect(completed).toContainText('Completed 15 Oct 26');
  await expect(completed).toContainText('Closure: Resolved');
  await expect(completed).toContainText('WH ID: 1008');
  await expect(completed.getByRole('button',{name:'Call history for record',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'Export matching members',exact:true})).toHaveCount(0);
  await followup.getByRole('button',{name:'Show less',exact:true}).click();
  await followup.getByText('Assignment instructions',{exact:true}).click();
  await page.screenshot({path:info.outputPath('manual-batch-notes.png'),fullPage:true});
  await page.evaluate(()=>document.documentElement.setAttribute('data-theme','dark'));
  await page.screenshot({path:info.outputPath('manual-batch-notes-dark.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1)).toBe(true);
});

test('All time survives caller history and manual exports, then returns to a date range',async({page},info)=>{
  await pool.query("insert into callyzer_calls(account_key,source_id,employee_number,caller_email,client_name,occurred_at,duration_seconds,call_type,call_method,call_mode) values('browser-test','all-time-history','91-9876543210','priya@eval.test','History contact',now(),20,'Outgoing','PhoneCall','Voice')");
  await login(page);await page.goto('/dashboard/team');await ready(page);
  let filters=await panel(page);await filters.getByRole('tab',{name:'Dates',exact:true}).click();
  await filters.getByRole('button',{name:'All time',exact:true}).click();await expect(filters.getByLabel('Report from')).toBeDisabled();
  await filters.getByRole('button',{name:'Apply',exact:true}).click();await ready(page);
  expect(new URL(page.url()).searchParams.get('range')).toBe('all');await expect(page.locator('.filter-context')).toContainText('All time');
  await page.getByRole('link',{name:'Call history for priya@eval.test',exact:true}).click();await ready(page);
  await expect(page.getByLabel('Caller call history table')).toContainText('History contact');
  expect(new URL(page.url()).searchParams.get('range')).toBe('all');
  const href='/api/team/export?range='+new URL(page.url()).searchParams.get('range')+'&metric=attempts&caller=priya%40eval.test';expect(href).toContain('range=all');
  expect((await page.request.get(href!)).status()).toBe(200);
  await page.screenshot({path:info.outputPath('team-all-time.png'),fullPage:true});
  await page.getByRole('link',{name:'Close history'}).click();await ready(page);
  filters=await panel(page);await filters.getByRole('tab',{name:'Dates',exact:true}).click();
  await filters.getByRole('button',{name:'This month',exact:true}).click();await expect(filters.getByLabel('Report from')).toBeEnabled();
  await filters.getByRole('button',{name:'Apply',exact:true}).click();await ready(page);
  expect(new URL(page.url()).searchParams.has('range')).toBe(false);expect(new URL(page.url()).searchParams.has('date_from')).toBe(true);
});

test('clearing an unapplied All time choice restores the applied date range',async({page})=>{
  await login(page);await page.goto('/dashboard/team');await ready(page);
  let filters=await panel(page);await filters.getByRole('tab',{name:'Dates',exact:true}).click();
  const original=await filters.getByLabel('Report from').inputValue();
  await filters.getByRole('button',{name:'All time',exact:true}).click();
  await filters.getByRole('button',{name:'Clear all filters',exact:true}).click();await ready(page);
  filters=await panel(page);await filters.getByRole('tab',{name:'Dates',exact:true}).click();
  await expect(filters.getByLabel('Report from')).toBeEnabled();
  await expect(filters.getByLabel('Report from')).toHaveValue(original);
  await expect(filters.getByRole('button',{name:'All time',exact:true})).toHaveAttribute('aria-pressed','false');
  await filters.getByLabel('Report from').fill('2026-01-02');
  await filters.getByRole('button',{name:'All time',exact:true}).click();
  await filters.getByRole('button',{name:'All time',exact:true}).click();
  await expect(filters.getByLabel('Report from')).toBeEnabled();
  await expect(filters.getByLabel('Report from')).toHaveValue('2026-01-02');
  await filters.getByRole('button',{name:'Apply',exact:true}).click();await ready(page);
  expect(new URL(page.url()).searchParams.get('date_from')).toBe('2026-01-02');
  expect(new URL(page.url()).searchParams.has('range')).toBe(false);
});

test('bulk reopening rejects a stale preview and succeeds after reviewing the latest state',async({page})=>{
  await login(page);await page.goto('/dashboard/assignments');await ready(page);
  await page.getByLabel('Select assignment for Meera Nair',{exact:true}).check();
  await page.getByRole('button',{name:'Reopen selected',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Reopen assignments',exact:true});
  await expect(dialog).toContainText('1 of 1 assignments');
  await pool.query('update bolna_assignments set revision=revision+1 where id=2');
  await dialog.getByRole('button',{name:'Reopen 1',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('Assignments or ownership changed');
  expect((await pool.query('select state from bolna_assignments where id=2')).rows[0].state).toBe('done');
  await dialog.getByRole('button',{name:'Review again',exact:true}).click();
  await expect(dialog).toContainText('1 of 1 assignments');
  await dialog.getByRole('button',{name:'Reopen 1',exact:true}).click();await expect(dialog).toHaveCount(0);await ready(page);
  expect((await pool.query('select state,completed_at from bolna_assignments where id=2')).rows[0]).toEqual({state:'open',completed_at:null});
});

test('single reopening explains a shared-phone conflict with production guards disabled',async({page})=>{
  const owner=(await pool.query(`insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by)
    values('call','c0000000-0000-4000-8000-000000000002','raj@eval.test','admin@eval.test') returning id::text`)).rows[0].id;
  await pool.query('alter table bolna_assignments disable trigger bolna_assignment_contacts_sync; alter table bolna_assignments disable trigger bolna_assignment_quality_guard');
  try {
    await login(page);await page.goto('/dashboard/assignments?q=Meera&state=done');await ready(page);
    await page.getByRole('button',{name:'Reopen',exact:true}).click();
    await expect(page.locator('.assignment-sheet tbody tr').filter({hasText:'Meera Nair'}).getByRole('alert'))
      .toContainText('This phone number already has open work');
    expect((await pool.query('select state,revision from bolna_assignments where id=2')).rows[0]).toEqual({state:'done',revision:0});
    expect((await page.request.delete(`/api/assignments/${owner}`)).status()).toBe(200);
    await page.getByRole('button',{name:'Reopen',exact:true}).click();await ready(page);
    await expect(page.getByRole('button',{name:'Reopen',exact:true})).toHaveCount(0);
    expect((await pool.query('select state,completed_at,remarks from bolna_assignments where id=2')).rows[0])
      .toEqual({state:'open',completed_at:null,remarks:'confirmed 8000 sqft'});
  } finally {
    await pool.query('alter table bolna_assignments enable trigger bolna_assignment_contacts_sync; alter table bolna_assignments enable trigger bolna_assignment_quality_guard');
  }
});

test('PDF items retain batch IDs, attribution, timestamps, USD balance and caller workloads',async({page})=>{
  const batch='b0000000-0000-4000-8000-000000000040';
  await pool.query(`insert into bolna_assignment_batches(id,intent_key,created_by,created_at,entity_type,distribution,assignees,selection,request_hash)
    values($1,$1,'admin@eval.test','2026-10-14T19:30:00Z','record','single',array['priya@eval.test'],'{}','review-fixture');`,[batch]);
  await pool.query("update bolna_assignments set assigned_at='2026-10-14T19:30:00Z',batch_id=$1 where id in(1,2)",[batch]);
  await pool.query("update bolna_assignments set completed_at='2026-10-15T19:30:00Z' where id=2");
  await pool.query("insert into bolna_assignment_batch_items(batch_id,entity_id,assignment_id,disposition,assignee,phones) select $1,entity_id,id,'assign',assignee,array[]::text[] from bolna_assignments where id in(1,2)",[batch]);
  await login(page);
  const attempt=await page.request.post('/api/assignments/1/attempts',{data:{id:'d0000000-0000-4000-8000-000000000040',revision:0,occurred_at:'2026-10-15T10:00:00+05:30',disposition:'busy',notes:'No response on this attempt'}});
  expect(attempt.status()).toBe(200);
  await page.goto('/dashboard/assignments?q=Meera');await ready(page);
  const card=page.locator('.assignee-card');await expect(card).toContainText('Assigned by Eval Admin on 15 Oct 26');await expect(card).not.toContainText('@');
  await expect(page.locator('.assignment-completed')).toHaveText('16 Oct 26');await card.click();
  const batchDialog=page.getByRole('dialog',{name:'Assignment batch',exact:true});
  await expect(batchDialog.getByRole('list',{name:'Batch records'}).locator('li')).toHaveCount(2);
  await batchDialog.getByRole('link',{name:'Open full batch',exact:true}).click();await ready(page);await expect(batchDialog).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe(`/dashboard/batches/manual/${batch}`);
  await expect(page.locator('.batch-grid tbody tr')).toHaveCount(2);
  await page.goto('/dashboard/raw?q=Raghav');await ready(page);
  await expect(page.getByLabel('Bolna balance',{exact:true})).toContainText('$42.00 USD');
  await page.getByTitle('Open details for Raghav Sharma',{exact:true}).click();
  const details=page.getByRole('dialog');await details.getByRole('tab',{name:'Manual activity',exact:true}).click();
  await expect(details.locator('.detail-history').filter({hasText:'No response on this attempt'})).toContainText('15 Oct 2026');
  await expect(details.locator('.detail-history').filter({hasText:'No response on this attempt'})).toContainText('Busy');
  await page.keyboard.press('Escape');
  await page.goto('/dashboard/team/access');await ready(page);
  const person=page.locator('.person').filter({hasText:'priya@eval.test'});
  await expect(person.getByRole('link',{name:'2 open',exact:true})).toBeVisible();
  await person.getByRole('link',{name:'1 done',exact:true}).click();await ready(page);
  await expect(page.locator('.assignment-sheet tbody tr')).toHaveCount(1);await expect(page.locator('.assignment-sheet tbody')).toContainText('Meera Nair');
});
