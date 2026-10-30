// Deferred with the unshipped employee overhaul; see README.md.
import {test,expect,bodyOverflowsX} from "../tests/fixtures";
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

test('manual call statuses keep all selections through personal work search and status navigation',async({employeePage:page})=>{
 sql("update bolna_assignments set disposition=case when entity_type='record' then 'busy' else 'connected' end where assignee='priya@eval.test' and state='open'");
 await page.goto('/dashboard/my');let dialog=await panel(page);await dialog.getByRole('tab',{name:'Results',exact:true}).click();await choose(page,'Manual call status',['Busy','Connected']);await dialog.getByRole('button',{name:'Apply',exact:true}).click();await settled(page);
 expect(new URL(page.url()).searchParams.getAll('manual_disposition').sort()).toEqual(['busy','connected']);await expect(page.locator('.task-sheet tbody tr')).toHaveCount(2);
 await page.getByLabel('Search my work').fill('Raghav');await page.getByRole('button',{name:'Apply',exact:true}).click();await settled(page);
 expect(new URL(page.url()).searchParams.getAll('manual_disposition').sort()).toEqual(['busy','connected']);
 dialog=await panel(page);await dialog.getByRole('tab',{name:/Results/}).click();const menu=dialog.locator('details.filter-multi').filter({has:page.locator('.multi-control-label',{hasText:/Manual call status/})});await menu.locator('summary').click();await expect(menu.getByRole('checkbox',{name:'Busy',exact:true})).toBeChecked();await expect(menu.getByRole('checkbox',{name:'Connected',exact:true})).toBeChecked();
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
