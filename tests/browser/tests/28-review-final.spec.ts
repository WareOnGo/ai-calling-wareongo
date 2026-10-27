import {test,expect} from './fixtures';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {CONTAINER} from '../lib/env.mjs';
const sql=(s:string)=>execFileSync('podman',['exec','-i',CONTAINER,'psql','-U','postgres','-q','-v','ON_ERROR_STOP=1'],{input:s});
const work=(page:any,name='Meera')=>page.locator('[data-entity="record"] tbody tr').filter({hasText:name});
const saved=async(row:any)=>expect(row.locator('.save-status')).toHaveText('Saved');

test('Done result edits require a WH ID and Unclear explanation, with field focus and recovery',async({employeePage:page,shot})=>{
 sql("update bolna_assignments set outcome='Unavailable',wh_id=null,remarks=null where id=2");
 await page.goto('/dashboard/my');let row=work(page);
 await row.getByLabel('Result of the call').selectOption('Available');await expect(row).toContainText('positive integer Warehouse ID');await expect(row.getByLabel('Warehouse ID')).toBeFocused();
 await row.getByLabel('Warehouse ID').fill('123');await row.getByLabel('Warehouse ID').blur();await row.getByRole('button',{name:'Retry',exact:true}).click();await saved(row);
 await row.getByLabel('Warehouse ID').fill('');await row.getByLabel('Warehouse ID').blur();await expect(row).toContainText('positive integer Warehouse ID');
 await row.getByLabel('Warehouse ID').fill('123');await row.getByLabel('Warehouse ID').blur();await saved(row);
 await row.getByLabel('Result of the call').selectOption('Unclear');await expect(row).toContainText('substantive explanation');await expect(row.getByLabel('Your notes')).toBeFocused();
 await row.getByLabel('Your notes').fill('The two owners disagree about the remaining available area');await row.getByLabel('Closure reason').selectOption('escalated');await row.getByRole('button',{name:'Retry',exact:true}).click();await saved(row);
 await row.getByLabel('Your notes').fill('');await row.getByLabel('Your notes').blur();await expect(row).toContainText('substantive explanation');await shot(page,'review3-done-validation');
 await row.getByLabel('Your notes').fill('The two owners disagree about the remaining available area');await row.getByLabel('Your notes').blur();await saved(row);
 await page.reload();row=work(page);await expect(row.getByRole('button',{name:'Done',exact:true})).toHaveAttribute('aria-pressed','true');await expect(row.getByLabel('Warehouse ID')).toHaveValue('123');await expect(row.getByLabel('Closure reason')).toHaveValue('escalated');
});
test('an invalid legacy Done reference must be repaired before saving new notes without logging a call',async({employeePage:page})=>{
 sql("alter table bolna_assignments disable trigger bolna_assignment_quality_guard;update bolna_assignments set wh_id='WH-123' where id=2;alter table bolna_assignments enable trigger bolna_assignment_quality_guard;");
 await page.goto('/dashboard/my');const row=work(page);
 await row.getByLabel('Your notes').fill('Owner details reviewed against the warehouse record');await row.getByLabel('Your notes').blur();await expect(row).toContainText('positive integer Warehouse ID');
 await row.getByLabel('Warehouse ID').fill('123');await row.getByLabel('Warehouse ID').blur();await row.getByRole('button',{name:'Retry',exact:true}).click();await saved(row);
 await expect(row.getByRole('button',{name:'Log manual call'})).toBeDisabled();await page.reload();await expect(work(page).getByLabel('Your notes')).toHaveValue('Owner details reviewed against the warehouse record');
});
test('Exhausted after one RNR still requires a warehouse ID for Available',async({employeePage:page})=>{
 await page.goto('/dashboard/my');const row=work(page,'Raghav');await row.getByRole('button',{name:'Log manual call'}).click();const dialog=page.getByRole('dialog');
 await dialog.getByLabel('What happened?').selectOption('no_answer');await dialog.getByRole('combobox',{name:'Manual result',exact:true}).selectOption('Available');await dialog.getByRole('button',{name:'Record attempt'}).click();await expect(dialog).toHaveCount(0);
 await row.getByLabel('Your notes').fill('Further follow-ups exhausted after the recorded unanswered call');await row.getByLabel('Your notes').blur();await saved(row);
 await row.getByLabel('Closure reason').selectOption('exhausted');await saved(row);await row.getByRole('button',{name:'Mark done'}).click();await expect(row).toContainText('positive integer Warehouse ID');
 await row.getByLabel('Warehouse ID').fill('123');await row.getByLabel('Warehouse ID').blur();await row.getByRole('button',{name:'Retry',exact:true}).click();await saved(row);await page.reload();await expect(work(page,'Raghav').getByRole('button',{name:'Done',exact:true})).toHaveAttribute('aria-pressed','true');
});
test('Keep existing result while correcting the supplying attempt retains Available',async({employeePage:page})=>{
 await page.goto('/dashboard/my');const row=work(page,'Raghav');await row.getByRole('button',{name:'Log manual call'}).click();let dialog=page.getByRole('dialog');
 await dialog.getByRole('combobox',{name:'Manual result',exact:true}).selectOption('Available');await dialog.getByRole('button',{name:'Record attempt'}).click();await expect(dialog).toHaveCount(0);
 await row.getByRole('button',{name:'Log manual call'}).click();dialog=page.getByRole('dialog');await expect(dialog.getByRole('combobox',{name:'Event',exact:true})).toBeVisible();await dialog.getByRole('combobox',{name:'Event',exact:true}).selectOption({index:1});
 await dialog.getByRole('combobox',{name:'Manual result',exact:true}).selectOption('');await dialog.getByLabel('Reported duration (seconds, optional)').fill('42');await dialog.getByLabel('Why is this correction needed?').fill('Correct the duration using my call log');await dialog.getByRole('button',{name:'Save correction'}).click();await expect(dialog).toHaveCount(0);
 await page.reload();await expect(work(page,'Raghav').getByLabel('Result of the call')).toHaveValue('Available');
});
test('correcting the latest Keep-existing call updates an inherited result and permits completion',async({employeePage:page})=>{
 sql("update bolna_assignments set assigned_at='2026-08-01T00:00:00Z' where id=1");
 await page.goto('/dashboard/my');const row=work(page,'Raghav');
 for(const [at,outcome] of [['2026-08-02T06:30','Available'],['2026-08-02T07:30','']]){
  await row.getByRole('button',{name:'Log manual call'}).click();const dialog=page.getByRole('dialog');
  await dialog.getByLabel('Attempt time (IST)').fill(at);await dialog.getByRole('combobox',{name:'Manual result',exact:true}).selectOption(outcome);
  await dialog.getByRole('button',{name:'Record attempt'}).click();await expect(dialog).toHaveCount(0);
 }
 await row.getByRole('button',{name:'Log manual call'}).click();const dialog=page.getByRole('dialog');
 await dialog.getByRole('combobox',{name:'Event',exact:true}).selectOption({index:1});
 await dialog.getByRole('combobox',{name:'Manual result',exact:true}).selectOption('Unavailable');
 await dialog.getByLabel('Why is this correction needed?').fill('The latest call confirmed the warehouse is no longer available');
 await dialog.getByRole('button',{name:'Save correction'}).click();await expect(dialog).toHaveCount(0);
 await expect(row.getByLabel('Result of the call')).toHaveValue('Unavailable');await row.getByRole('button',{name:'Mark done'}).click();await saved(row);
 await page.reload();await expect(work(page,'Raghav').getByRole('button',{name:'Done',exact:true})).toHaveAttribute('aria-pressed','true');
});
test('correcting a mistaken Available attempt removes its Team credit and exported evidence',async({employeePage:page,adminPage:admin})=>{
 // Isolate this discovery from the seed's current-day legacy Available row.
 sql("update bolna_assignments set assigned_at='2026-08-01T00:00:00Z' where id=1");
 await page.goto('/dashboard/my');const row=work(page,'Raghav');
 await row.getByRole('button',{name:'Log manual call'}).click();let dialog=page.getByRole('dialog');
 await dialog.getByLabel('Attempt time (IST)').fill('2026-08-02T06:30');
 await dialog.getByRole('combobox',{name:'Manual result',exact:true}).selectOption('Available');
 await dialog.getByRole('button',{name:'Record attempt'}).click();await expect(dialog).toHaveCount(0);
 await admin.goto('/dashboard/team?date_from=2026-08-02&date_to=2026-08-02');await expect(admin.getByRole('link',{name:'First Available targets for priya@eval.test: 1',exact:true})).toBeVisible();
 await row.getByRole('button',{name:'Log manual call'}).click();dialog=page.getByRole('dialog');
 await dialog.getByRole('combobox',{name:'Event',exact:true}).selectOption({index:1});
 await dialog.getByRole('combobox',{name:'Manual result',exact:true}).selectOption('Unavailable');
 await dialog.getByLabel('Why is this correction needed?').fill('The original recording confirms no warehouse is available');
 await dialog.getByRole('button',{name:'Save correction'}).click();await expect(dialog).toHaveCount(0);
 await admin.reload();const credit=admin.getByRole('link',{name:'First Available targets for priya@eval.test: 0',exact:true});await expect(credit).toBeVisible();await credit.click();
 await expect(admin.getByLabel('Metric evidence table')).toContainText('No evidence rows');
 const csv=await admin.request.get(await admin.getByRole('link',{name:'Export these rows'}).getAttribute('href')||'');
 expect(csv.status()).toBe(200);expect(csv.headers()['x-export-row-count']).toBe('0');
});
test('call-disconnected is final in AI batch cards and matching exports',async({adminPage:page})=>{
 const id=randomUUID();sql(`insert into call_batches(id,state,bolna_batch_id) values('${id}','completed','browser-final');insert into call_batch_items(batch_id,record_id,name,contact_number) values('${id}','a0000000-0000-4000-8000-000000000003','Suresh Kumar','9811100003');update bolna_call_logs set batch_id='browser-final' where id='c0000000-0000-4000-8000-000000000003';`);
 await page.goto(`/dashboard/batches/ai/${id}`);const card=page.locator('.batch-metrics a').filter({hasText:'No final result'});await expect(card.locator('strong')).toHaveText('0');await card.click();await expect(page.getByText('No batch members match these filters.')).toBeVisible();
 const csv=await page.request.get(`/api/batches/${id}/export?kind=ai&metric=pending`);expect(csv.status()).toBe(200);expect(csv.headers()['x-export-row-count']).toBe('0');
});
test('Completed history finds sibling listings and calls for the selected caller',async({adminPage:page})=>{
 sql("alter table bolna_assignments disable trigger bolna_assignment_quality_guard;update bolna_assignments set state='done',outcome='Unavailable' where id=4;alter table bolna_assignments enable trigger bolna_assignment_quality_guard;");
 await page.goto('/dashboard/raw?assignment_state=done&assignee=raj%40eval.test');await expect(page.locator('table.sheet tbody').first()).toContainText('Suresh Kumar');await expect(page.locator('table.sheet tbody').first()).toContainText('Anil Broker');await expect(page.locator('table.sheet tbody').first()).not.toContainText('Meera Nair');
 await page.goto('/dashboard/calls?assignment_state=done&assignee=raj%40eval.test');await expect(page.locator('table.sheet tbody').first()).toContainText('Suresh Kumar');
});
test('follow-up chips and manual batch allocation values are readable',async({adminPage:page})=>{
 sql("update bolna_assignments set disposition='busy',next_due_at=now()-interval '1 day' where id=1");
 await page.goto('/dashboard/assignments?follow_up=due');await expect(page.locator('.applied-filters')).toContainText('Follow-up due');
 const id=randomUUID();sql(`insert into bolna_assignment_batches(id,intent_key,created_by,entity_type,distribution,assignees,selection,request_hash) values('${id}',gen_random_uuid(),'admin@eval.test','record','single',ARRAY['priya@eval.test'],'{}','fixture');insert into bolna_assignment_batch_items(batch_id,entity_id,disposition,phones) values('${id}','a0000000-0000-4000-8000-000000000001','missing_phone','{}'),('${id}','a0000000-0000-4000-8000-000000000002','duplicate','{}');`);
 await page.goto(`/dashboard/batches/manual/${id}`);await expect(page.locator('table.sheet tbody')).toContainText('No usable phone');await expect(page.locator('table.sheet tbody')).toContainText('Duplicate contact');await expect(page.locator('table.sheet tbody')).not.toContainText('missing_phone');
 await page.goto('/dashboard/team?metric=mismatch');await expect(page.locator('.dashboard-content [role=alert]')).toBeVisible();expect((await page.request.get('/api/team/export?metric=mismatch')).status()).toBe(400);
});
