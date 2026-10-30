// Deferred with the unshipped employee overhaul; see README.md.
import {test,expect,bodyOverflowsX} from "../tests/fixtures";
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
  await expect(timeline).toContainText('2 Callyzer calls · 1 manual entry');
  const events=timeline.getByRole('list',{name:'Manual call timeline'}).locator('li');await expect(events).toHaveCount(3);
  await expect(events.nth(0)).toContainText('Incoming call');await expect(events.nth(0)).toContainText('WhatsApp · video');await expect(events.nth(0)).toContainText('Duration unknown');
  await expect(events.nth(1)).toContainText('Manual entry');await expect(events.nth(1)).toContainText('Owner confirmed the callback time.');
  await expect(events.nth(2)).toContainText('Callyzer');await expect(events.nth(2)).toContainText('Duration: 42s');
  await expect(timeline.getByRole('button',{name:/Correct/})).toHaveCount(0);
  const dimensions=await page.getByRole('dialog').boundingBox();expect(dimensions!.width).toBeLessThanOrEqual(width);
  expect(await bodyOverflowsX(page)).toBe(false);await shot(page,`manual-callyzer-${width}-${theme}`);
 });
}

test('My Work exposes only the assigned employee’s own imported calls and never offers provider corrections',async({employeePage:page})=>{
 await seed();await page.goto('/dashboard/my');
 const row=page.locator('[data-entity="record"] tbody tr').filter({hasText:'Raghav Sharma'});
 await row.getByRole('button',{name:'Call history for record',exact:true}).click();
 const timeline=page.getByRole('region',{name:'Manual call history',exact:true});
 await expect(timeline).toContainText('1 Callyzer call. Newest first.');await expect(timeline).toContainText('1 entry');await expect(timeline).not.toContainText('1 entries');await expect(timeline).toContainText('Priya Eval');await expect(timeline).not.toContainText('Raj Eval');
 await page.getByRole('button',{name:'Close details',exact:true}).click();
 await row.getByRole('button',{name:'Log manual call',exact:true}).click();
 await expect(page.getByRole('dialog').getByText('Loading recent call history…')).toHaveCount(0);
 await expect(page.getByRole('dialog').getByRole('combobox',{name:'Event',exact:true})).toHaveCount(0);
});

for(const withManualEntry of [false,true])test(`assignment cards agree with imported history${withManualEntry?' and manual entries':''}`,async({adminPage:page})=>{
 let historyRequests=0;page.on('request',request=>{if(request.url().includes('/api/details/'))historyRequests++;});
 await page.goto('/dashboard/assignments?q=Raghav');
 const card=page.locator('.manual-result-card').filter({has:page.getByRole('button',{name:'Call history for record',exact:true})}).first();
 await expect(card).toContainText('No call records yet');
 await seed(withManualEntry);await page.reload();
 const total=withManualEntry?3:2;
 await expect(card).toContainText(`${total} call records`);
 await expect(card).not.toContainText(/No staff log|No call logged|No call records yet/);
 expect(historyRequests).toBe(0);
 await card.getByRole('button',{name:'Call history for record',exact:true}).click();
 const timeline=page.getByRole('region',{name:'Manual call history',exact:true});
 await expect(timeline.getByRole('heading',{name:/Call history/})).toContainText(`${total} entries`);
 await expect(timeline.getByRole('listitem')).toHaveCount(total);
 await expect(timeline).not.toContainText(/0 staff logs|0 manual entries/);
});
