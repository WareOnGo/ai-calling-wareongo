import { test, expect } from './fixtures';
import { execFileSync } from 'node:child_process';
import { CONTAINER } from '../lib/env.mjs';
const sql=(statement:string)=>execFileSync('podman',['exec','-i',CONTAINER,'psql','-U','postgres','-v','ON_ERROR_STOP=1','-q','-c',statement]);

test('Unassigned now excludes open and completed contacts across both channels',async({adminPage:page,shot})=>{
  await page.goto('/dashboard/raw?assignee=none');
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(page.locator('table.sheet tbody').first()).not.toContainText('Meera Nair');
  await expect(page.locator('table.sheet tbody').first()).not.toContainText('Anil Broker');
  await page.goto('/dashboard/calls?assignee=none');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('table.sheet tbody').first()).not.toContainText('Raghav Sharma');
  await expect(page.locator('table.sheet tbody').first()).not.toContainText('Suresh Kumar');
  await shot(page,'handoff-a-unassigned');
});

test('raw calling preview deduplicates selected source listings before dispatch',async({adminPage:page})=>{
  await page.goto('/dashboard/raw');
  for(const name of ['Suresh Kumar','Anil Broker']) await page.locator('tbody tr').filter({hasText:name}).locator('input.rowsel').check();
  await page.getByRole('button',{name:/Queue for calling/}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog).toContainText('2 records → 2 with numbers → 1 unique numbers');
  await expect(dialog).toContainText('1 duplicate number(s) removed');
});

test('manual assignment groups duplicate contacts and keeps related listings visible to the owner',async({adminPage:page,employeePage})=>{
  sql(`insert into raw_records(id,source,source_record_id,owner_name,city) values
    ('a0000000-0000-4000-8000-000000000007','fixture','extra1','Shared property one','Delhi'),
    ('a0000000-0000-4000-8000-000000000008','fixture','extra2','Shared property two','Delhi');
    insert into raw_phone_numbers(phone_last10,phone) values('9876500000','+919876500000');
    insert into raw_phones(master_id,phone_id,is_primary) select r.id,p.phone_id,true from raw_records r cross join raw_phone_numbers p where r.source='fixture' and p.phone_last10='9876500000';`);
  const res=await page.request.post('/api/assignments',{data:{entity_type:'record',assignee:'priya@eval.test',ids:['a0000000-0000-4000-8000-000000000007','a0000000-0000-4000-8000-000000000008']}});
  expect(res.status()).toBe(200); const result=await res.json();
  expect(result.assigned).toBe(1); expect(result.duplicateContacts).toBe(1);
  const details=await employeePage.request.get('/api/details/record/a0000000-0000-4000-8000-000000000007');
  expect(details.status()).toBe(200);
  expect((await details.json()).relatedListings.map((r:{owner_name:string})=>r.owner_name).sort()).toEqual(['Shared property one','Shared property two']);
  await employeePage.goto('/dashboard/my');
  const row=employeePage.locator('tbody tr').filter({hasText:'Shared property one'});
  await expect(row).toHaveCount(1);
  await row.getByRole('button',{name:'Details for record'}).click();
  await expect(employeePage.getByRole('dialog')).toContainText('Shared property two');
});

test('a named current-owner filter does not include completed assignments',async({adminPage:page})=>{
  await page.goto('/dashboard/raw?assignee=priya%40eval.test');
  await expect(page.locator('table.sheet tbody').first()).toContainText('Raghav Sharma');
  await expect(page.locator('table.sheet tbody').first()).not.toContainText('Meera Nair');
  await page.goto('/dashboard/raw?assignment_state=done&assignee=priya%40eval.test');
  await expect(page.locator('table.sheet tbody').first()).toContainText('Meera Nair');
  await expect(page.locator('table.sheet tbody').first()).not.toContainText('Raghav Sharma');
});
