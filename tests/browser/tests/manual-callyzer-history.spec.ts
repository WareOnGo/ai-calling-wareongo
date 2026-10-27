import {test,expect,bodyOverflowsX} from './fixtures';
import pg from 'pg';
import {DB_URL} from '../lib/env.mjs';

async function seed(withStaffLog=false){
 const db=new pg.Client({connectionString:DB_URL,ssl:false});await db.connect();
 try{
  await db.query(`insert into callyzer_calls(account_key,source_id,employee_number,caller_email,client_number,occurred_at,duration_seconds,call_type,call_method,call_mode)
   values('browser-test','priya-provider','91-9000000001','priya@eval.test','91-9811100001','2026-10-20T10:00:00Z',42,'Outgoing','PhoneCall','Voice'),
   ('browser-test','raj-provider','91-9000000002','raj@eval.test','91-9811100001','2026-10-20T10:02:00Z',null,'Incoming','WhatsAppCall','Video')`);
  if(withStaffLog)await db.query(`insert into bolna_manual_attempts(id,assignment_id,actor,assignee,occurred_at,disposition,notes,duration_seconds,request_hash)
   values(gen_random_uuid(),1,'priya@eval.test','priya@eval.test','2026-10-20T10:01:00Z','connected','Owner confirmed the callback time.',15,'fixture')`);
 }finally{await db.end();}
}

for(const width of [1366,390])for(const theme of ['light','dark']){
 test(`combined manual timeline is readable at ${width}px in ${theme}`,async({adminPage:page,shot})=>{
  await seed(true);await page.setViewportSize({width,height:width===390?844:900});await page.addInitScript(value=>localStorage.setItem('theme',value),theme);
  await page.goto('/dashboard/raw?q=Raghav');await page.getByRole('button',{name:'Manual calls for record',exact:true}).click();
  const timeline=page.getByRole('region',{name:'Manual call history',exact:true});
  await expect(timeline).toContainText('2 Callyzer calls · 1 staff log');
  const events=timeline.getByRole('list',{name:'Manual call timeline'}).locator('li');await expect(events).toHaveCount(3);
  await expect(events.nth(0)).toContainText('Incoming call');await expect(events.nth(0)).toContainText('WhatsApp · video');await expect(events.nth(0)).toContainText('Duration unknown');
  await expect(events.nth(1)).toContainText('Staff log');await expect(events.nth(1)).toContainText('Owner confirmed the callback time.');
  await expect(events.nth(2)).toContainText('Callyzer');await expect(events.nth(2)).toContainText('Duration: 42s');
  await expect(timeline.getByRole('button',{name:/Correct/})).toHaveCount(0);
  const dimensions=await page.getByRole('dialog').boundingBox();expect(dimensions!.width).toBeLessThanOrEqual(width);
  expect(await bodyOverflowsX(page)).toBe(false);await shot(page,`manual-callyzer-${width}-${theme}`);
 });
}

test('import-only history is reachable from assignments, raw data, calls and manual batches',async({adminPage:page})=>{
 await seed();
 for(const [path,label]of[
  ['/dashboard/assignments?q=Raghav','Call history for record'],
  ['/dashboard/raw?q=Raghav','Manual calls for record'],
  ['/dashboard/calls?q=Raghav','Manual history for call'],
  ['/dashboard/batches/manual/legacy','Call history for record'],
 ]){
  await page.goto(path);await page.getByRole('button',{name:label,exact:true}).first().click();
  await expect(page.getByRole('region',{name:'Manual call history',exact:true})).toContainText('2 Callyzer calls · 0 staff logs');
  await page.getByRole('button',{name:'Close details',exact:true}).click();
 }
});

test('My Work exposes only the assigned employee’s own imported calls and never offers provider corrections',async({employeePage:page})=>{
 await seed();await page.goto('/dashboard/my');
 const row=page.locator('[data-entity="record"] tbody tr').filter({hasText:'Raghav Sharma'});
 await row.getByRole('button',{name:'Call history for record',exact:true}).click();
 const timeline=page.getByRole('region',{name:'Manual call history',exact:true});
 await expect(timeline).toContainText('1 Callyzer call · 0 staff logs');await expect(timeline).toContainText('Priya Eval');await expect(timeline).not.toContainText('Raj Eval');
 await page.getByRole('button',{name:'Close details',exact:true}).click();
 await row.getByRole('button',{name:'Log manual call',exact:true}).click();
 await expect(page.getByRole('dialog').getByText('Loading recent call history…')).toHaveCount(0);
 await expect(page.getByRole('dialog').getByRole('combobox',{name:'Event',exact:true})).toHaveCount(0);
});
