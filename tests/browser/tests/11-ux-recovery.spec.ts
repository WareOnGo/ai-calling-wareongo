import { test,logConnected, expect, bodyOverflowsX } from './fixtures';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { CONTAINER } from '../lib/env.mjs';

const mine = (page: any) => page.locator('table.task-sheet').first().locator('tbody tr').filter({hasText:'Raghav Sharma'});
const callId = 'c0000000-0000-4000-8000-000000000001';
const rawId = 'a0000000-0000-4000-8000-000000000001';
const sql = (statement: string) => execFileSync('podman',['exec','-i',CONTAINER,'psql','-U','postgres','-v','ON_ERROR_STOP=1','-q','-c',statement]);

test('call edits persist when restored to their original value', async ({adminPage:page}) => {
  await page.goto('/dashboard/calls');
  const input = page.getByRole('textbox',{name:'Manual follow-up notes'}).and(page.locator(':enabled')).first();
  for (const value of ['Follow up','']) {
    await input.fill(value);
    const response = page.waitForResponse(r => r.url().includes('/api/assignments/') && r.request().method() === 'PATCH');
    await input.blur(); expect((await response).status()).toBe(200);
    await expect(page.locator('.sheet-save-status')).toHaveText('All changes saved');
  }
  await page.reload(); await expect(page.getByRole('textbox',{name:'Manual follow-up notes'}).and(page.locator(':enabled')).first()).toHaveValue('');
});

test('failed checkbox rolls back and offers a working retry', async ({employeePage:page,shot}) => {
  await page.goto('/dashboard/my');
  let fail = true;
  await page.route('**/api/assignments/1', route => fail ? route.fulfill({status:500,json:{error:'test failure'}}) : route.continue());
  const row = mine(page); const checkbox = row.locator('.checkfield input');
  await checkbox.check(); await expect(row.locator('.save-status')).toContainText("Couldn't confirm");
  await expect(checkbox).not.toBeChecked();
  await expect(page.locator('.sheet-save-status')).toContainText("hasn't saved");
  await shot(page,'ux-checkbox-retry');
  fail = false; await row.getByRole('button',{name:'Retry',exact:true}).click();
  await expect(row.locator('.save-status')).toHaveText('Saved'); await expect(checkbox).toBeChecked();
});

test('failed notes survive another save and block navigation until retry', async ({employeePage:page}) => {
  await page.goto('/dashboard/my'); let fail = true;
  await page.route('**/api/assignments/1', route => fail && route.request().postDataJSON().remarks ? route.fulfill({status:500,json:{error:'failed'}}) : route.continue());
  const row = mine(page); const notes = row.getByRole('textbox',{name:'Your notes'});
  await notes.fill('Keep this important draft'); await notes.blur(); await expect(row.locator('.save-status')).toContainText("Couldn't confirm");
  await row.locator('select').selectOption('Available');
  await expect(row.locator('.save-status')).toContainText('Retry');
  await page.locator('.brand-link').click();
  await expect(page).toHaveURL(/dashboard\/my/); await expect(notes).toHaveValue('Keep this important draft');
  fail = false; await row.getByRole('button',{name:'Retry',exact:true}).click(); await expect(row.locator('.save-status')).toHaveText('Saved');
  await page.locator('.brand-link').click(); await expect(page).toHaveURL(/dashboard$/);
});

test('Done updates totals immediately and rolls back on failure', async ({employeePage:page}) => {
  expect((await page.request.patch('/api/assignments/1',{data:{revision:0,outcome:'Unavailable'}})).status()).toBe(200);
  await page.goto('/dashboard/my');
  await expect(page.locator('.title-sub:visible')).toContainText('2 still to do');
  await logConnected(page,mine(page));
  await mine(page).getByRole('button',{name:'Mark done'}).click();
  await expect(page.locator('.title-sub:visible')).toContainText('1 still to do');
  await expect(mine(page)).toHaveClass(/row-done/);
  await expect(mine(page).locator('.save-status')).toHaveText('Saved');
  await page.route('**/api/assignments/1',r => r.fulfill({status:500,json:{error:'failed'}}));
  await mine(page).getByRole('button',{name:'Done',exact:true}).click();
  await expect(mine(page).locator('.save-status')).toContainText('Retry');
  await expect(page.locator('.title-sub:visible')).toContainText('1 still to do');
  await expect(mine(page)).toHaveClass(/row-done/);
});

test('selected call export downloads only those rows and preserves employee scope', async ({adminPage:page,employeePage}) => {
  await page.goto('/dashboard/calls');
  await page.locator(`.rowsel[data-id="${callId}"]`).check();
  await page.getByRole('button',{name:'Export CSV',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('1 selected rows');
  const response = page.waitForResponse(r => r.url().includes('/api/calls/export')&&r.request().method()==='POST');
  const download = page.waitForEvent('download');
  await page.getByRole('button',{name:'Download CSV',exact:true}).click();
  const res = await response; const file = await download;
  expect(res.request().postDataJSON().ids).toEqual([callId]);
  expect((await readFile((await file.path())!, 'utf8')).trim().split('\n')).toHaveLength(2);
  const scoped = await employeePage.request.get(`/api/calls/export?ids=${callId},c0000000-0000-4000-8000-000000000002`);
  expect((await scoped.text()).trim().split('\n')).toHaveLength(2);
  const invalid = await employeePage.request.get('/api/calls/export?ids=------------------------------------');
  expect(invalid.status()).toBe(400);
});

test('all matching selection carries through export, assignment and queue', async ({adminPage:page}) => {
  await page.goto('/dashboard/raw'); await page.locator('.rowsel:not(:disabled)').first().check();
  await page.getByRole('button',{name:'Select all 6 matching'}).click();
  await page.getByRole('button',{name:'Export CSV',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('6 rows matching'); await page.keyboard.press('Escape');
  await page.locator('.btn-assign').click();
  await expect(page.locator('.assign-scope input').nth(1)).toBeChecked(); await page.keyboard.press('Escape');
  const response = page.waitForResponse(r => r.url().includes('/api/raw/queue'));
  await page.getByRole('button',{name:/Queue for calling/}).click(); expect((await response).status()).toBe(200);
  await expect(page.getByRole('dialog')).toContainText('6 records →');
  await expect(page.getByRole('dialog')).toContainText('duplicate');
});

test('filters keep the existing grid visible while fetching and use client navigation', async ({adminPage:page,shot}) => {
  await page.goto('/dashboard/raw');
  await page.evaluate(() => (window as any).__uxDocument = 'same document');
  let release!: () => void; const gate = new Promise<void>(resolve => release=resolve);
  await page.route('**/dashboard/raw?**',async route => {if(new URL(route.request().url()).searchParams.get('q') === 'Meera') await gate; await route.continue();});
  await page.getByRole('textbox',{name:'Search records'}).fill('Meera');
  await page.getByRole('button',{name:'Apply',exact:true}).click();
  try { await expect(page.locator('.navigation-progress')).toBeVisible(); await expect(page.locator('tbody tr')).toHaveCount(6); await expect(page.getByRole('button',{name:'Applying…'})).toBeDisabled(); await shot(page,'ux-filter-pending'); }
  finally { release(); }
  await expect(page.locator('tbody tr')).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).__uxDocument)).toBe('same document');
  await expect(page.locator('.applied-filters')).toContainText('Search: Meera');
});

test('assignment stays open while saving and refreshes even when dismissed with Escape', async ({adminPage:page}) => {
  await page.goto('/dashboard/raw');
  await page.locator('tbody tr').filter({hasText:'Latha Menon'}).locator('.rowsel').check();
  await page.locator('.btn-assign').click(); await page.getByRole('dialog').locator('select').selectOption('raj@eval.test');
  await expect(page.getByRole('dialog').getByRole('region',{name:'Assignment preview'})).toContainText('1 eligible of 1 rows');
  let release!: () => void; const gate = new Promise<void>(resolve => release=resolve);
  await page.route('**/api/assignments',async route => {await gate;await route.continue();});
  await page.getByRole('button',{name:'Assign 1',exact:true}).click();
  try {await expect(page.getByRole('button',{name:'Assigning…'})).toBeDisabled(); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toBeVisible(); await expect(page.getByRole('button',{name:'Close',exact:true})).toBeDisabled();}
  finally {release();}
  await expect(page.locator('.assign-done')).toBeVisible(); await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.locator('tbody tr').filter({hasText:'Latha Menon'})).toContainText('raj@eval.test');
});

test('details are scoped, contain readable transcript and restore keyboard focus', async ({employeePage:page,shot}) => {
  expect((await page.request.get('/api/details/record/a0000000-0000-4000-8000-000000000003')).status()).toBe(404);
  expect((await page.request.get(`/api/details/call/${callId}`)).status()).toBe(200);
  expect((await page.request.get('/api/details/call/------------------------------------')).status()).toBe(404);
  expect((await page.request.patch('/api/assignments/3',{data:{revision:0,remarks:'no longer owned'}})).status()).toBe(409);
  await page.goto('/dashboard/my');
  const trigger = page.locator('.worklist').nth(1).getByRole('button',{name:'Details for call'});
  await trigger.click();
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Raghav Sharma');
  await expect(page.locator('dialog .transcript')).toContainText('haan ji available hai');
  await expect(page.locator('dialog audio')).toHaveAttribute('preload','none');
  for(let i=0;i<8;i++){await page.keyboard.press('Tab'); expect(await page.evaluate(()=>!!document.activeElement?.closest('dialog'))).toBe(true);}
  await shot(page,'ux-record-drawer'); await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
});

test('My Work totals and pagination include work beyond the former 200-row cap', async ({employeePage:page}) => {
  sql(`insert into raw_records (id,source,source_record_id,owner_name) select md5('ux-'||n)::uuid,'ux',n::text,'UX owner '||n from generate_series(1,205) n;
    insert into raw_phones(master_id,phone_id,is_primary) select id,(select phone_id from raw_phone_numbers limit 1),true from raw_records where source='ux';
    insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state) select 'record',id,'priya@eval.test','admin@eval.test','open' from raw_records where source='ux';`);
  await page.goto('/dashboard/my');
  await expect(page.locator('.title-sub:visible')).toContainText('207 still to do');
  await expect(page.locator('.worklist').first().locator('tbody tr')).toHaveCount(25);
  await expect(page.locator('.work-pager').first()).toContainText('Page 1 of 9');
  await page.locator('.work-pager').first().getByRole('link',{name:'Next'}).click(); await expect(page.locator('.work-pager').first()).toContainText('Page 2 of 9');
  await page.goto('/dashboard/my?records_page=9'); await expect(page.locator('.worklist').first().locator('tbody tr')).toHaveCount(7);
  await expect(page.locator('.work-pager').first().getByRole('button',{name:'Next'})).toBeDisabled();
});

test('saved filter views survive reload', async ({adminPage:page}) => {
  await page.goto('/dashboard/raw?city=Rajkot'); await page.locator('.views-menu summary').click();
  await page.getByRole('button',{name:'Save current filters…'}).click(); await page.getByRole('textbox',{name:'View name'}).fill('Rajkot queue');
  await page.getByRole('button',{name:'Save view',exact:true}).click();
  await page.goto('/dashboard/raw'); await page.locator('.views-menu summary').click(); await page.getByRole('button',{name:'Rajkot queue',exact:true}).click();
  await expect(page).toHaveURL(/city=Rajkot/); await expect(page.locator('.applied-filters')).toContainText('City: Rajkot');
});

test('unassign failure stays visible and retry refreshes the row', async ({adminPage:page}) => {
  await page.goto('/dashboard/assignments'); let fail=true;
  await page.route('**/api/assignments/*',r => fail ? r.fulfill({status:500,json:{error:'failed'}}) : r.continue());
  const row=page.locator('tbody tr').filter({hasText:'Suresh Kumar'}).first();
  await row.getByRole('button',{name:'Unassign',exact:true}).click(); await row.getByRole('button',{name:'Confirm',exact:true}).click();
  await expect(row.getByRole('alert')).toBeVisible(); fail=false; await row.getByRole('button',{name:'Retry',exact:true}).click();
  await expect(page.locator('.snackbar')).toContainText('Work unassigned');
});

test('Team reports a failed change beside the person and can retry', async ({adminPage:page}) => {
  await page.goto('/dashboard/team'); let fail=true;
  await page.route('**/api/users',r=>fail?r.fulfill({status:500,json:{error:'failed'}}):r.continue());
  const row=page.locator('.person').filter({hasText:'priya@eval.test'}); await row.getByRole('switch').click();
  await expect(row.locator('.team-feedback')).toContainText("Couldn't confirm"); await expect(row.getByRole('switch')).toHaveAttribute('aria-checked','true');
  fail=false; await row.getByRole('button',{name:'Retry',exact:true}).click(); await expect(row.getByRole('switch')).toHaveAttribute('aria-checked','false');
});

test('batch history remains available and uncertain dispatch does not offer blind retry', async ({adminPage:page,employeePage}) => {
  sql("update bolna_assignments set state='dropped' where state='open'");
  expect((await employeePage.request.get('/api/batches')).status()).toBe(403);
  expect((await page.request.get('/api/batches')).status()).toBe(200);
  await page.goto('/dashboard/raw'); await page.locator(`.rowsel[data-id="${rawId}"]`).check();
  let requests=0; await page.route('**/api/raw/dispatch',r=>{requests++;return r.abort('failed');});
  await page.getByRole('button',{name:/Queue for calling/}).click(); await page.getByRole('button',{name:/Send to Bolna/}).click(); await page.getByRole('button',{name:'Yes, place calls'}).click();
  await expect(page.getByRole('dialog',{name:'Queue for calling',exact:true}).getByRole('alert')).toContainText('could not be confirmed'); await expect(page.getByRole('button',{name:/Send to Bolna/})).toBeDisabled();
  await page.getByRole('dialog').getByRole('button',{name:'Recent batches',exact:true}).click(); await expect(page.getByRole('dialog',{name:'Recent calling batches'})).toBeVisible();
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await page.getByRole('button',{name:/Queue for calling/}).click(); await expect(page.getByRole('dialog',{name:'Queue for calling',exact:true}).getByRole('alert')).toContainText('could not be confirmed'); expect(requests).toBe(1);
});

for (const width of [1366,1024,390]) test(`screens contain horizontal overflow at ${width}px`,async ({adminPage:page,employeePage,shot})=>{
  await page.setViewportSize({width,height:900}); await employeePage.setViewportSize({width,height:900});
  for(const path of ['calls','raw','assignments','team']){
    await page.goto(`/dashboard/${path}`); expect(await bodyOverflowsX(page),path).toBe(false);
    await expect(page.locator('.topnav a[aria-current="page"]')).toBeVisible();
    if(width!==1024) await shot(page,`ux-${path}-${width}`);
  }
  await employeePage.goto('/dashboard/my'); expect(await bodyOverflowsX(employeePage)).toBe(false);
  if(width>=1024){expect(await employeePage.locator('.worklist .gridwrap').evaluateAll(els=>els.every(el=>el.scrollWidth<=el.clientWidth+1))).toBe(true);}
  await shot(employeePage,`ux-my-${width}`);
  if(width===390){await mine(employeePage).getByRole('button',{name:'Details for record'}).click(); await expect(employeePage.getByRole('dialog')).toBeVisible(); await shot(employeePage,'ux-drawer-390');}
});

test('column visibility, keyboard navigation and reduced motion remain usable',async ({adminPage:page})=>{
  await page.goto('/dashboard/calls');
  await page.locator('.column-menu:not(.views-menu) summary').click();
  for(const name of ['AI result','AI attempts','Manual result'])await page.locator('.column-options').getByRole('checkbox',{name,exact:true}).uncheck();
  await page.locator('.column-menu:not(.views-menu) summary').click();
  const row=page.locator('tbody tr').filter({has:page.getByLabel('Manual follow-up notes').and(page.locator(':enabled'))}).first();
  const phone=row.locator('td').filter({has:page.locator('.copytext')});
  await phone.click({position:{x:12,y:5}});
  await expect(page.locator('td.selected, td[tabindex="0"]')).toHaveCount(0);
  await phone.getByRole('button',{name:'Copy phone number'}).focus();
  await page.keyboard.press('Tab');
  await expect(row.getByLabel('Manual follow-up notes')).toBeFocused();
  await page.reload(); await expect(page.locator('th').filter({hasText:'AI result',visible:true})).toHaveCount(0);
  await page.emulateMedia({reducedMotion:'reduce'}); await page.locator('tbody .details-trigger').first().click();
  const animation=await page.locator('.navigation-progress span').count(); expect(animation).toBe(0);
});


test('drafts recover after browser Back and Forward',async ({employeePage:page})=>{
  await page.goto('/dashboard/calls');
  await page.locator('.topnav').getByRole('link',{name:'My Work',exact:true}).click();
  const notes=mine(page).getByRole('textbox',{name:'Your notes'});
  await notes.fill('Recover this tab draft');
  await page.goBack(); await expect(page).toHaveURL(/dashboard\/calls/);
  await page.goForward(); await expect(page).toHaveURL(/dashboard\/my/);
  await expect(mine(page).getByRole('textbox',{name:'Your notes'})).toHaveValue('Recover this tab draft');
  await expect(page.locator('.sheet-save-status')).toContainText('Unsaved changes');
  await page.locator('.sheet-save-status').getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(page.locator('.sheet-save-status')).toHaveText('All changes saved');
});


test('first page load shows skeleton rows and respects reduced motion',async ({adminPage:page,shot})=>{
  const {Client} = await import('pg'); const {DB_URL}=await import('../lib/env.mjs');
  const db=new Client({connectionString:DB_URL,ssl:false}); await db.connect();
  await page.emulateMedia({reducedMotion:'reduce'});
  try {
    await db.query('begin'); await db.query('lock table bolna_call_logs in access exclusive mode');
    await page.goto('/dashboard/calls',{waitUntil:'commit'});
    await expect(page.locator('.skeleton-row').first()).toBeVisible();
    await expect(page.locator('.skeleton:visible').first()).toHaveCSS('animation-name','none');
    await page.screenshot({path:'shots/ux-loading-skeleton.png',animations:'disabled'});
  } finally {await db.query('commit');await db.end();}
  await expect(page.locator('tbody tr')).toHaveCount(5);
});

test('navigation waits for the blur save without requiring another click',async ({employeePage:page})=>{
  await page.goto('/dashboard/my');
  let release!:()=>void; const gate=new Promise<void>(resolve=>release=resolve);
  await page.route('**/api/assignments/1',async route=>{await gate;await route.continue();});
  await mine(page).getByRole('textbox',{name:'Your notes'}).fill('Save before leaving');
  await page.locator('.brand-link').click();
  try {await expect(page.locator('.sheet-save-status')).toHaveText('Saving changes…');await expect(page).toHaveURL(/dashboard\/my/);} finally {release();}
  await expect(page).toHaveURL(/dashboard$/);
  await page.locator('.topnav').getByRole('link',{name:'My Work',exact:true}).click();
  await expect(mine(page).getByRole('textbox',{name:'Your notes'})).toHaveValue('Save before leaving');
});

test('expired session retains the draft and offers sign-in recovery',async ({employeePage:page})=>{
  await page.goto('/dashboard/my');
  await page.route('**/api/assignments/1',r=>r.fulfill({status:401,json:{error:'unauthorized'}}));
  const row=mine(page);await row.getByRole('textbox',{name:'Your notes'}).fill('Keep through sign-in');await row.getByRole('textbox',{name:'Your notes'}).blur();
  await expect(row.getByRole('link',{name:'Sign in again'})).toHaveAttribute('target','_blank');
  await expect(row.getByRole('textbox',{name:'Your notes'})).toHaveValue('Keep through sign-in');
});

test('recent batches reads scheduled jobs and their received results',async ({adminPage:page,shot})=>{
  const id='d0000000-0000-4000-8000-000000000001';
  sql(`insert into call_batches(id,state,callable,bolna_batch_id,created_by,scheduled_at) values('${id}','scheduled',3,'ux-batch','admin@eval.test',now());update bolna_call_logs set batch_id='ux-batch' where id='${callId}';`);
  try {
    const result=await page.request.get('/api/batches');expect(result.status()).toBe(200);
    expect((await result.json()).batches.find((b:any)=>b.id===id)).toMatchObject({callable:3,results_received:1,state:'scheduled'});
    await page.goto('/dashboard/raw');await page.getByRole('button',{name:'Recent batches',exact:true}).click();
    await expect(page.getByRole('dialog')).toContainText('1 call results received');
    await page.locator('dialog[open] .modal-close').click();await page.getByRole('button',{name:'Recent batches',exact:true}).click();
    await expect(page.getByRole('dialog')).toContainText('ux-batch');await shot(page,'ux-batch-history');
  } finally {sql(`delete from call_batches where id='${id}'`);}
});
