import { test, expect, bodyOverflowsX } from './fixtures';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { CONTAINER } from '../lib/env.mjs';

test('handoff preview shows manual follow-up states, completed outcomes and exact AI execution status',async({adminPage:page,shot})=>{
  execFileSync('podman',['exec','-i',CONTAINER,'psql','-U','postgres','-q','-v','ON_ERROR_STOP=1'],{input:
    "update bolna_assignments set disposition='callback',outcome='Available',next_due_at='2026-10-12T03:00:00Z' where id=1; update bolna_call_logs set status='busy' where id='c0000000-0000-4000-8000-000000000005';"});
  await page.goto('/dashboard/raw');await page.getByRole('button',{name:'Assign',exact:true}).click();
  let modal=page.getByRole('dialog');await expect(modal).toContainText('AI connection status:');
  await modal.getByText('Inspect selected records and planned actions').click();
  const current=modal.locator('.allocation-record').filter({hasText:'9811100001'});
  await expect(current).toContainText('priya@eval.test · open');await expect(current).toContainText('Call back later');
  await expect(current).toContainText('Due');await expect(current).toContainText('busy · No AI result');
  await expect(current).toContainText('Latest contact context');
  const completed=modal.locator('.allocation-record').filter({hasText:'9811100002'});await expect(completed).toContainText('priya@eval.test · 1 done');await expect(completed).toContainText('Available');
  await page.setViewportSize({width:390,height:844});expect(await bodyOverflowsX(page)).toBe(false);await shot(page,'handoff-reaudit-preview-status');
  await modal.getByRole('button',{name:'Cancel',exact:true}).click();await page.goto('/dashboard/calls?availability=Available');await page.getByRole('button',{name:'Assign',exact:true}).click();
  modal=page.getByRole('dialog');await expect(modal).toContainText('AI connection status: completed: 1');await modal.getByText('Inspect selected records and planned actions').click();
  await expect(modal.locator('.allocation-record').first()).toContainText('completed · Available');await expect(modal).toContainText('Selected execution');
});

test('preview reconciles missing phones, active owners, AI history and round-robin allocation',async({adminPage:page,shot})=>{
  await page.goto('/dashboard/raw');
  await page.getByRole('button',{name:'Assign',exact:true}).click();
  const modal=page.getByRole('dialog');
  await modal.locator('select').selectOption('priya@eval.test');
  await expect(modal.getByRole('region',{name:'Assignment preview'})).toContainText('2 eligible of 6 rows');
  await expect(modal).toContainText('1 missing valid phone');
  await expect(modal.locator('select')).toContainText('done today');
  await modal.getByRole('radio', {name:'Split across callers',exact:true}).check();
  await modal.getByLabel(/Raj Eval/).check();
  await expect(modal.locator('.caller-choice').filter({hasText:'priya@eval.test'}).locator('.caller-share')).toHaveText('1 call');
  await expect(modal.locator('.caller-choice').filter({hasText:'raj@eval.test'}).locator('.caller-share')).toHaveText('1 call');
  await modal.getByText('Inspect selected records and planned actions').click();
  await expect(modal.locator('.allocation-record')).toHaveCount(6);
  await shot(page,'handoff-b-preview');
  await modal.getByRole('button',{name:'Split 2 calls across 2 callers',exact:true}).click();
  await expect(modal.locator('.assign-done')).toContainText('Assigned 2');
  const link=modal.getByRole('link',{name:'View this assignment batch'});
  const target=await link.getAttribute('href');expect(target).toMatch(/^\/dashboard\/batches\/manual\/[0-9a-f-]+$/);
  await page.goto(target!);
  await expect(page.locator('table.sheet tbody tr')).toHaveCount(6);
  await page.locator('.batch-metrics').getByRole('link',{name:'2 Still open',exact:true}).click();
  await expect(page).toHaveURL(/metric=open/);
  await expect(page.locator('table.sheet tbody tr')).toHaveCount(2);
});

test('filtered preview and commit agree, then retry returns the original batch',async({adminPage:page})=>{
  const request={entity_type:'record',assignee:'priya@eval.test',filters:{assignee:'none'},intentKey:randomUUID()};
  const previewResponse=await page.request.post('/api/assignments/preview',{data:request});
  expect(previewResponse.status()).toBe(200);const preview=await previewResponse.json();
  expect(preview.requested).toBe(2);expect(preview.eligible).toBe(1);
  const body={...request,previewHash:preview.previewHash};
  const response=await page.request.post('/api/assignments',{data:body});
  expect(response.status()).toBe(200);const first=await response.json();
  expect(first.assigned).toBe(preview.eligible);expect(first.skippedNoPhone).toBe(1);
  const replay=await page.request.post('/api/assignments',{data:body});
  expect(replay.status()).toBe(200);expect((await replay.json()).batchId).toBe(first.batchId);
});

test('a changed owner rejects the stale preview and the dialog can recover',async({adminPage:page})=>{
  await page.goto('/dashboard/raw?q=Latha');await page.getByRole('button',{name:'Assign',exact:true}).click();
  const modal=page.getByRole('dialog');await modal.locator('select').selectOption('priya@eval.test');
  await expect(modal).toContainText('1 eligible of 1 rows');
  const other=await page.request.post('/api/assignments',{data:{entity_type:'record',assignee:'raj@eval.test',filters:{q:'Latha'}}});
  expect(other.status()).toBe(200);
  await modal.getByRole('button',{name:'Assign 1',exact:true}).click();
  await expect(modal.getByRole('alert')).toContainText('Selection or ownership changed');
  await modal.getByRole('button',{name:'Refresh preview'}).click();
  await expect(modal).toContainText('0 eligible of 1 rows');
  await expect(modal).toContainText('Currently owned by raj@eval.test');
});

test('preview remains admin-only and Calls uses the same allocation contract',async({adminPage,employeePage})=>{
  const body={entity_type:'call',assignee:'priya@eval.test',filters:{assignee:'none'}};
  expect((await employeePage.request.post('/api/assignments/preview',{data:body})).status()).toBe(403);
  const response=await adminPage.request.post('/api/assignments/preview',{data:body});
  expect(response.status()).toBe(200);const preview=await response.json();expect(preview.eligible).toBe(1);
  const committed=await adminPage.request.post('/api/assignments',{data:{...body,intentKey:randomUUID(),previewHash:preview.previewHash}});
  expect(committed.status()).toBe(200);expect((await committed.json()).assigned).toBe(1);
});
