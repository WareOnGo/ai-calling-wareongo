import {test,expect,bodyOverflowsX} from './fixtures';
import {unreadableText} from '../lib/visual-audit';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {CONTAINER} from '../lib/env.mjs';
import type {Page} from '@playwright/test';

test.use({actionTimeout:10000});
const batch='d9000000-0000-4000-8000-000000000001';
const sql=(input:string)=>execFileSync('podman',['exec','-i',CONTAINER,'psql','-U','postgres','-q','-v','ON_ERROR_STOP=1'],{input,stdio:['pipe','ignore','pipe']});
const seed=()=>sql(`update bolna_assignments set added_to_db=true,wh_id='261',remarks='Confirmed by owner' where id=1;
 insert into call_batches(id,created_by,state,agent_language,bolna_batch_id) values ('${batch}','admin@eval.test','completed','hindi','filter-fixture');
 insert into call_batch_items(batch_id,record_id,name,contact_number,area) values ('${batch}','a0000000-0000-4000-8000-000000000001','Raghav Sharma','+919811100001','Rajkot'),('${batch}','a0000000-0000-4000-8000-000000000002','Meera Nair','+919811100002','Delhi');
 update bolna_call_logs set llm_availability='Available' where phone_last10='9811100001';
 update bolna_call_logs set batch_id='filter-fixture' where id='c0000000-0000-4000-8000-000000000001';`);
const choose=async(page:Page,label:string,values:string[])=>{
 const menu=page.locator('details.filter-multi').filter({has:page.locator('.multi-control-label').filter({hasText:new RegExp(`^${label}( \\(|$)`)})});
 await menu.locator('summary').click();for(const value of values)await menu.getByRole('checkbox',{name:value,exact:true}).check();await menu.locator('summary').click();
};
const panel=async(page:Page)=>{await page.getByRole('button',{name:'Toggle filters',exact:true}).click();return page.getByRole('dialog',{name:'Filters',exact:true});};
const settled=async(page:Page)=>expect(page.locator('.dashboard-content')).toHaveAttribute('aria-busy','false');

test('assignee and status apply together from one Filters panel',async({adminPage:page})=>{
 await page.goto('/dashboard/assignments');let dialog=await panel(page);
 await choose(page,'Assignee',['Priya Eval']);await choose(page,'Status',['Done']);
 await expect(page.locator('.assignment-sheet tbody tr')).toHaveCount(5);
 await dialog.getByRole('button',{name:'Apply',exact:true}).click();await settled(page);
 await expect(page.locator('.assignment-sheet tbody tr')).toHaveCount(1);await expect(page.locator('.assignment-sheet tbody')).toContainText('Meera Nair');
 await expect(page.locator('.filters-toggle .fbadge')).toHaveText('2');
 await expect(page.locator('.applied-filters')).toContainText('Assigned to: priya@eval.test');await expect(page.locator('.applied-filters')).toContainText('Status: done');
 await page.getByLabel('Search assignments').fill('Meera');await page.getByRole('button',{name:'Apply',exact:true}).click();await settled(page);
 expect(new URL(page.url()).searchParams.getAll('assignee')).toEqual(['priya@eval.test']);expect(new URL(page.url()).searchParams.get('state')).toBe('done');
 dialog=await panel(page);await dialog.getByRole('button',{name:'Clear all filters',exact:true}).click();await settled(page);await expect(page.locator('.assignment-sheet tbody tr')).toHaveCount(5);
});

test('assignment filters match reporting columns, retain category drafts and preserve criteria in status cards',async({adminPage:page})=>{
 seed();await page.goto('/dashboard/assignments');const dialog=await panel(page);await dialog.getByRole('tab',{name:'Results',exact:true}).click();
 await choose(page,'AI result',['Available']);await dialog.getByLabel('Added to DB',{exact:true}).selectOption('yes');await dialog.getByLabel('WH ID',{exact:true}).fill('261');
 await page.getByRole('tab',{name:/^Assignment/}).click();await dialog.getByLabel('City',{exact:true}).fill('Rajkot');
 await page.getByRole('tab',{name:/^Results/}).click();await expect(dialog.getByLabel('WH ID',{exact:true})).toHaveValue('261');
 await dialog.getByRole('button',{name:'Apply',exact:true}).click();await settled(page);
 await expect(page.locator('table.sheet tbody tr')).toHaveCount(1);await expect(page.locator('table.sheet tbody')).toContainText('Raghav Sharma');
 await expect(page.locator('.applied-filters')).toContainText('Added to DB: Added');
 expect(new URL(page.url()).searchParams.get('ai_result')).toBe('Available');
 await page.locator('a.stat').filter({has:page.locator('.stat-l',{hasText:/^done$/})}).click();await settled(page);
 expect(new URL(page.url()).searchParams.get('wh_id')).toBe('261');await expect(page.locator('.assignment-sheet tbody')).toContainText('No assignments match');
 await page.getByRole('button',{name:'Remove Status filter: done',exact:true}).click();await settled(page);await expect(page.locator('table.sheet tbody tr')).toHaveCount(1);
 const reopened=await panel(page);await reopened.getByRole('button',{name:'Clear all filters',exact:true}).click();await settled(page);expect(new URL(page.url()).search).toBe('');
});

test('clearing a draft resets fields and checkbox state before anything has been applied',async({adminPage:page})=>{
 await page.goto('/dashboard/assignments');let dialog=await panel(page);await dialog.getByRole('tab',{name:'Results',exact:true}).click();
 await expect(dialog.getByRole('button',{name:'Apply',exact:true})).toBeDisabled();
 await choose(page,'AI result',['Available']);await dialog.getByLabel('WH ID',{exact:true}).fill('261');
 await dialog.getByRole('button',{name:'Clear all filters',exact:true}).click();await settled(page);
 dialog=await panel(page);await dialog.getByRole('tab',{name:'Results',exact:true}).click();await expect(dialog.getByLabel('WH ID',{exact:true})).toHaveValue('');
 const result=dialog.locator('details.filter-multi').filter({has:page.locator('.multi-control-label',{hasText:/^AI result/})});
 await result.locator('summary').click();await expect(result.getByRole('checkbox',{name:'Available',exact:true})).not.toBeChecked();
 await expect(dialog.getByRole('button',{name:'Apply',exact:true})).toBeDisabled();
});

test('searchable choices retain hidden selections and category clearing enables Apply',async({adminPage:page})=>{
 sql("insert into bolna_app_users(email,name,role) select 'extra'||n||'@eval.test','Extra Caller '||n,'employee' from generate_series(1,10) n");
 await page.goto('/dashboard/assignments');await panel(page);const menu=page.locator('details.filter-multi').filter({has:page.locator('.multi-control-label',{hasText:/^Assignee/})});
 await menu.locator('summary').click();await menu.getByRole('checkbox',{name:'Priya Eval',exact:true}).check();await menu.getByLabel('Find assignee options').fill('Raj');
 await menu.getByRole('checkbox',{name:'Raj Eval',exact:true}).check();await menu.locator('summary').click();await page.getByRole('button',{name:'Apply',exact:true}).click();await settled(page);
 expect(new URL(page.url()).searchParams.getAll('assignee').sort()).toEqual(['priya@eval.test','raj@eval.test']);
 await panel(page);await menu.locator('summary').click();await menu.getByRole('button',{name:'Clear selection (2)',exact:true}).click();await menu.locator('summary').click();
 await expect(page.getByRole('button',{name:'Apply',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Apply',exact:true}).click();await settled(page);expect(new URL(page.url()).searchParams.has('assignee')).toBe(false);
});

test('raw and call reporting filters apply through the panel and chips clear individually',async({adminPage:page})=>{
 seed();await page.goto('/dashboard/raw');let dialog=await panel(page);await choose(page,'AI history result',['Available']);await page.getByRole('tab',{name:'Reporting',exact:true}).click();
 await dialog.getByLabel('Added to DB',{exact:true}).selectOption('yes');await dialog.getByRole('button',{name:'Apply',exact:true}).click();await settled(page);
 await expect(page.locator('table.sheet tbody tr')).toHaveCount(1);expect(new URL(page.url()).searchParams.get('added_to_db')).toBe('yes');
 await page.getByRole('button',{name:'Remove Added to DB filter: yes',exact:true}).click();await settled(page);expect(new URL(page.url()).searchParams.get('ai_result')).toBe('Available');
 await page.goto('/dashboard/calls');dialog=await panel(page);await page.getByRole('tab',{name:'Call details',exact:true}).click();await dialog.getByLabel('Recording',{exact:true}).selectOption('yes');await dialog.getByLabel('Transcript',{exact:true}).selectOption('yes');await dialog.getByRole('button',{name:'Apply',exact:true}).click();await settled(page);
 const csv=await page.request.get('/api/calls/export?has_recording=yes&has_transcript=yes');expect(csv.status()).toBe(200);expect(Number(csv.headers()['x-export-row-count'])).toBe(await page.locator('table.sheet tbody tr:has(input.rowsel)').count());
});

test('batch search and member filters preserve export and metric navigation context',async({adminPage:page})=>{
 seed();await page.goto('/dashboard/batches');await page.getByLabel('Search batches').fill(batch.slice(0,8));await page.getByRole('button',{name:'Apply',exact:true}).click();await settled(page);await expect(page.locator('.batch-card')).toHaveCount(1);
 await page.getByRole('link',{name:'View contacts →',exact:true}).click();await settled(page);await panel(page);await choose(page,'AI result',['Available']);await page.getByRole('button',{name:'Apply',exact:true}).click();await settled(page);
 await expect(page.locator('.batch-grid tbody tr')).toHaveCount(1);await expect(page.getByRole('link',{name:'Export matching members'})).toHaveAttribute('href',/outcome=Available/);
 await expect(page.locator('.batch-metrics')).toContainText('2');
 await page.getByRole('link',{name:/Latest Unavailable/}).click();await settled(page);expect(new URL(page.url()).searchParams.get('outcome')).toBe('Available');await expect(page.locator('.batch-empty')).toContainText('No batch members match');
});

test('performance caller scope, evidence search and access directory filters work independently',async({adminPage:page})=>{
 sql("insert into bolna_manual_attempts(id,assignment_id,actor,assignee,occurred_at,disposition,request_hash) values (gen_random_uuid(),1,'priya@eval.test','priya@eval.test','2026-08-02T01:00:00Z','connected','fixture')");
 await page.goto('/dashboard/team?date_from=2026-08-02&date_to=2026-08-02');await expect(page.locator('.filter-context')).toHaveText('2 Aug 26 – 2 Aug 26 IST');await panel(page);await page.getByLabel('Caller',{exact:true}).selectOption('priya@eval.test');await page.getByRole('button',{name:'Apply',exact:true}).click();await settled(page);
 await expect(page.getByLabel('Team metrics table').locator('tbody tr')).toHaveCount(1);await page.getByRole('link',{name:'Recorded attempts for priya@eval.test: 1',exact:true}).first().click();await settled(page);
 const panelIds=await page.locator('.filter-panel').evaluateAll(elements=>elements.map(el=>el.id));expect(new Set(panelIds).size).toBe(2);expect(panelIds.every(Boolean)).toBe(true);
 await page.locator('#team-evidence').getByRole('button',{name:'Toggle filters'}).click();await page.getByRole('dialog',{name:'Filters',exact:true}).getByLabel('Current task state').selectOption('open');await page.getByRole('dialog',{name:'Filters',exact:true}).getByLabel('Reported duration').selectOption('no');await page.getByRole('dialog',{name:'Filters',exact:true}).getByLabel('Work type').selectOption('record');await page.getByRole('dialog',{name:'Filters',exact:true}).getByRole('button',{name:'Apply',exact:true}).click();await settled(page);
 expect(new URL(page.url()).searchParams.get('person')).toBe('priya@eval.test');expect(new URL(page.url()).searchParams.get('metric')).toBe('attempts');
 await page.getByLabel('Search evidence').fill('no such evidence');await page.locator('#team-evidence').getByRole('button',{name:'Apply',exact:true}).click();await settled(page);await expect(page.getByLabel('Metric evidence table')).toContainText('No evidence rows');
 const exportHref=await page.getByRole('link',{name:'Export these rows',exact:true}).getAttribute('href');expect(exportHref).toContain('q=no+such+evidence');expect(exportHref).toContain('has_duration=no');expect(exportHref).toContain('entity_type=record');expect((await page.request.get(exportHref!)).headers()['x-export-row-count']).toBe('0');
 await page.goto('/dashboard/team/access');await panel(page);await page.getByLabel('Filter by role').selectOption('employee');await page.getByLabel('Filter by access').selectOption('active');await page.getByRole('button',{name:'Apply',exact:true}).click();await expect(page.locator('.people .person')).toHaveCount(2);
 await page.getByLabel('Search team members').fill('Raj');await page.getByRole('button',{name:'Apply',exact:true}).click();await expect(page.locator('.people .person')).toHaveCount(1);await page.getByRole('button',{name:'Clear filters',exact:true}).click();await expect(page.locator('.people .person')).toHaveCount(4);
});

test('recorded AI attempts can be filtered consistently on records, calls, assignments and personal work',async({adminPage:page,employeePage})=>{
 sql("insert into bolna_ai_attempts(execution_id,provider_call_id,phone_last10,direction,first_observed_at,last_observed_at,raw) values ('c0000000-0000-4000-8000-000000000001','filter-verified-attempt','9811100001','outbound',now(),now(),'{}')");
 for(const [route,tab,count] of [['raw','Call details',1],['calls','Call details',1],['assignments','Results',2]] as const) {
  await page.goto('/dashboard/'+route);const dialog=await panel(page);await dialog.getByRole('tab',{name:tab,exact:true}).click();
  await dialog.getByLabel('AI attempts',{exact:true}).selectOption('yes');await dialog.getByRole('button',{name:'Apply',exact:true}).click();await settled(page);
  expect(new URL(page.url()).searchParams.get('has_ai_calls')).toBe('yes');await expect(page.locator('table.sheet:visible > tbody > tr')).toHaveCount(count);
 }
 await employeePage.goto('/dashboard/my');const dialog=await panel(employeePage);await dialog.getByRole('tab',{name:'Results',exact:true}).click();await dialog.getByLabel('AI attempts',{exact:true}).selectOption('yes');await dialog.getByRole('button',{name:'Apply',exact:true}).click();await settled(employeePage);
 expect(new URL(employeePage.url()).searchParams.get('has_ai_calls')).toBe('yes');await expect(employeePage.locator('.task-sheet tbody tr')).toHaveCount(2);
});

test('manual call statuses keep all selections through personal work search and status navigation',async({employeePage:page})=>{
 sql("update bolna_assignments set disposition=case when entity_type='record' then 'busy' else 'connected' end where assignee='priya@eval.test' and state='open'");
 await page.goto('/dashboard/my');let dialog=await panel(page);await dialog.getByRole('tab',{name:'Results',exact:true}).click();await choose(page,'Manual call status',['Busy','Connected']);await dialog.getByRole('button',{name:'Apply',exact:true}).click();await settled(page);
 expect(new URL(page.url()).searchParams.getAll('manual_disposition').sort()).toEqual(['busy','connected']);await expect(page.locator('.task-sheet tbody tr')).toHaveCount(2);
 await page.getByLabel('Search my work').fill('Raghav');await page.getByRole('button',{name:'Apply',exact:true}).click();await settled(page);
 expect(new URL(page.url()).searchParams.getAll('manual_disposition').sort()).toEqual(['busy','connected']);
 dialog=await panel(page);await dialog.getByRole('tab',{name:/Results/}).click();const menu=dialog.locator('details.filter-multi').filter({has:page.locator('.multi-control-label',{hasText:/Manual call status/})});await menu.locator('summary').click();await expect(menu.getByRole('checkbox',{name:'Busy',exact:true})).toBeChecked();await expect(menu.getByRole('checkbox',{name:'Connected',exact:true})).toBeChecked();
});

test('date ranges accept a new period in one draft and invalid hidden ranges stay in the filter panel',async({adminPage:page})=>{
 await page.goto('/dashboard/raw?date_from=2026-08-01&date_to=2026-08-02');let dialog=await panel(page);await dialog.getByRole('tab',{name:/Call details/}).click();
 await dialog.getByLabel('Last call date from').fill('2026-08-04');await dialog.getByLabel('Last call date to').fill('2026-08-05');await dialog.getByRole('button',{name:'Apply',exact:true}).click();await settled(page);
 expect(new URL(page.url()).searchParams.get('date_from')).toBe('2026-08-04');expect(new URL(page.url()).searchParams.get('date_to')).toBe('2026-08-05');
 dialog=await panel(page);await dialog.getByRole('tab',{name:/Call details/}).click();await dialog.getByLabel('Last call date from').fill('2026-08-10');await dialog.getByRole('tab',{name:'Property',exact:true}).click();await dialog.getByRole('button',{name:'Apply',exact:true}).click();
 await expect(dialog.getByRole('alert')).toContainText('end must be on or after the start');await expect(dialog.getByRole('tab',{name:/Call details/})).toHaveAttribute('aria-selected','true');await expect(dialog.getByLabel('Last call date to')).toBeFocused();expect(new URL(page.url()).searchParams.get('date_from')).toBe('2026-08-04');
 await dialog.getByLabel('Last call date to').fill('2026-08-11');await dialog.getByRole('button',{name:'Apply',exact:true}).click();await settled(page);expect(new URL(page.url()).searchParams.get('date_to')).toBe('2026-08-11');
});

test('call warehouse type, review state and provider batch filters survive search and chip removal',async({adminPage:page})=>{
 seed();sql("update raw_records set warehouse_type='factory' where id='a0000000-0000-4000-8000-000000000001'");
 await page.goto('/dashboard/calls?warehouse_type=factory&needs_review=0&batch_id=filter-fixture');await expect(page.locator('table.sheet tbody tr')).toHaveCount(1);
 let dialog=await panel(page);await expect(dialog.getByLabel('AI review')).toHaveValue('0');await dialog.getByRole('tab',{name:/Call details/}).click();await expect(dialog.getByLabel('Provider batch ID')).toHaveValue('filter-fixture');await dialog.getByRole('button',{name:'Close',exact:true}).click();
 await page.getByLabel('Search calls').fill('Raghav');await page.getByRole('button',{name:'Apply',exact:true}).click();await settled(page);expect(new URL(page.url()).searchParams.get('warehouse_type')).toBe('factory');expect(new URL(page.url()).searchParams.get('needs_review')).toBe('0');
 await page.getByRole('button',{name:'Remove Provider batch filter: filter-fixture',exact:true}).click();await settled(page);expect(new URL(page.url()).searchParams.has('batch_id')).toBe(false);await expect(page.locator('table.sheet tbody tr')).toHaveCount(2);
});

test('assignment completion and batch allocation filters remain visible and preserve export criteria',async({adminPage:page})=>{
 sql("update bolna_assignments set completed_at='2026-08-02T01:00:00Z' where state='done'");
 await page.goto('/dashboard/assignments');let dialog=await panel(page);await dialog.getByRole('tab',{name:'Dates & order',exact:true}).click();await dialog.getByLabel('Completed date from').fill('2026-08-02');await dialog.getByLabel('Completed date to').fill('2026-08-02');await dialog.getByRole('button',{name:'Apply',exact:true}).click();await settled(page);await expect(page.locator('.assignment-sheet tbody tr')).toHaveCount(1);await expect(page.locator('.assignment-sheet tbody')).toContainText('Meera Nair');
 await page.goto('/dashboard/batches/manual/legacy');dialog=await panel(page);await dialog.getByRole('tab',{name:'Contact & ownership',exact:true}).click();await choose(page,'Allocation',['Legacy assignment']);await dialog.getByRole('button',{name:'Apply',exact:true}).click();await settled(page);await expect(page.getByRole('link',{name:'Export matching members'})).toHaveAttribute('href',/allocation=legacy/);
 await page.goto('/dashboard/batches?kind=manual');dialog=await panel(page);await dialog.getByLabel('Created by',{exact:true}).selectOption('admin@eval.test');await dialog.getByRole('button',{name:'Apply',exact:true}).click();await settled(page);expect(new URL(page.url()).searchParams.get('created_by')).toBe('admin@eval.test');
});

test('wallet chip formats USD with a directly accessible refresh icon',async({adminPage:page})=>{
 await page.route('**/api/balance*',route=>route.fulfill({json:{balance:27.789521,unit:'USD',state:'fresh',refreshedAt:'2026-10-14T00:00:00Z',low:false,message:null}}));
 await page.goto('/dashboard/raw');const wallet=page.getByRole('complementary',{name:'Bolna balance'});
 await expect(wallet).toContainText('$27.79 USD');await expect(wallet.getByRole('button',{name:'Refresh balance'})).toBeVisible();await expect(wallet.getByRole('button',{name:'Balance details'})).toHaveCount(0);await expect(wallet).toHaveAttribute('title',/Updated/);
 await expect(page.getByRole('link',{name:'AI Calls',exact:true})).toBeVisible();await page.getByRole('link',{name:'AI Calls',exact:true}).click();await settled(page);await expect(page.locator('.records-header .page-title')).toHaveText('AI Calls');
});

for(const width of [1366,390])for(const theme of ['light','dark'])test(`@render filter audit ${width} ${theme}`,async({adminPage:page,employeePage},testInfo)=>{
 test.setTimeout(120000);seed();const output=resolve(process.env.EVAL_RENDER_DIR||'shots/filter-audit');mkdirSync(output,{recursive:true});const captures:object[]=[];const errors:string[]=[];
 for(const target of [page,employeePage]){await target.setViewportSize({width,height:width===390?844:900});await target.addInitScript(value=>localStorage.setItem('theme',value),theme);target.on('pageerror',error=>errors.push(error.message));}
 const capture=async(target:Page,name:string)=>{
  await target.evaluate(async()=>{await document.fonts.ready;await new Promise<void>(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>done())));});
  const file=`${name}-${width}-${theme}.png`;await target.screenshot({path:resolve(output,file),animations:'disabled'});const metrics=await target.evaluate(()=>{
   const visible=(element:Element)=>{const r=element.getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight;};
   return {visibleRows:[...document.querySelectorAll('table.sheet tbody tr')].filter(visible).length,visibleControls:[...document.querySelectorAll('button,input,select,summary')].filter(visible).length};
  });captures.push({name,label:name.replaceAll('-',' '),file,width,height:width===390?844:900,theme,route:new URL(target.url()).pathname,...metrics});writeFileSync(resolve(output,`manifest-${width}-${theme}.json`),JSON.stringify(captures,null,2));
  await testInfo.attach(name,{path:resolve(output,file),contentType:'image/png'});expect.soft(await bodyOverflowsX(target),name+' overflow').toBe(false);expect.soft(await unreadableText(target),name+' contrast').toEqual([]);
  const dialog=target.locator('dialog[open]');if(await dialog.count())expect.soft(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),name+' panel width').toBe(true);
  // All criteria belong to Filters; only free-text search stays in the toolbar.
  for(const form of await target.locator('form.filterbar').all()) {
   const names=await form.locator('[name]:not([type="hidden"])').evaluateAll(elements=>elements.filter(el=>!el.closest('.filter-panel')).map(el=>el.getAttribute('name')));expect(names.filter(name=>name!=='q')).toEqual([]);expect(names.length).toBeLessThanOrEqual(1);
  }
 };
 for(const [name,path,tab] of [
  ['assignments','/dashboard/assignments','Results'],['raw','/dashboard/raw','Reporting'],['calls','/dashboard/calls','Call details'],['batches','/dashboard/batches','Dates & references'],['batch-members',`/dashboard/batches/ai/${batch}`,'Call activity'],['manual-batches','/dashboard/batches?kind=manual','Batch details'],['manual-members','/dashboard/batches/manual/legacy','Contact & ownership'],
 ] as const){await page.goto(path);await capture(page,name);if(name==='assignments'&&width===1366)expect((await page.locator('.assignment-sheet thead').boundingBox())!.y).toBeLessThan(280);await panel(page);if(name==='assignments')await capture(page,'assignments-people-filters');await page.getByRole('tab',{name:tab,exact:true}).click();await capture(page,name+'-filters');if(name==='assignments'){await page.getByRole('dialog').getByLabel('Added to DB',{exact:true}).selectOption('yes');await capture(page,'assignments-filter-draft');await page.getByRole('tab',{name:'Dates & order',exact:true}).click();await capture(page,'assignment-date-filters');}if(name==='raw'){await page.getByRole('tab',{name:'Call details',exact:true}).click();await capture(page,'raw-call-filters');}if(name==='calls'){await page.getByRole('tab',{name:'Property',exact:true}).click();await capture(page,'calls-property-filters');}}
 await page.goto('/dashboard/assignments?ai_result=Available&added_to_db=yes&wh_id=261');await capture(page,'assignments-applied');
 await page.goto('/dashboard/team');await capture(page,'team-performance');await panel(page);await capture(page,'team-performance-filters');
 await page.goto('/dashboard/team/access');await panel(page);await page.getByLabel('Filter by role').selectOption('employee');await capture(page,'team-access-filters');await page.getByRole('button',{name:'Apply',exact:true}).click();await capture(page,'team-access');
 await page.goto('/dashboard/team?date_from=2026-08-01&date_to=2026-10-31&metric=attempts');await capture(page,'team-evidence');await page.locator('#team-evidence').getByRole('button',{name:'Toggle filters'}).click();await capture(page,'team-evidence-filters');
 await employeePage.goto('/dashboard/my');await capture(employeePage,'my-work');await panel(employeePage);await capture(employeePage,'my-work-filters');
 expect(errors).toEqual([]);
});
