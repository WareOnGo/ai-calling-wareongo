import {test,expect} from './fixtures';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {CONTAINER} from '../lib/env.mjs';
const sql=(s:string)=>execFileSync('podman',['exec','-i',CONTAINER,'psql','-U','postgres','-q','-v','ON_ERROR_STOP=1'],{input:s});
const work=(page:any,name='Meera')=>page.locator('[data-entity="record"] tbody tr').filter({hasText:name});
const saved=async(row:any)=>expect(row.locator('.save-status')).toHaveText('Saved');
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
