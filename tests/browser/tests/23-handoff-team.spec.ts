import {test,expect,bodyOverflowsX} from './fixtures';
import {execFileSync} from 'node:child_process';
import {CONTAINER} from '../lib/env.mjs';
import {randomUUID} from 'node:crypto';
const sql=(s:string)=>execFileSync('podman',['exec','-i',CONTAINER,'psql','-U','postgres','-q','-v','ON_ERROR_STOP=1'],{input:s});
const seedAttempts=()=>sql(`insert into bolna_manual_attempts(id,assignment_id,actor,assignee,occurred_at,disposition,duration_seconds,request_hash) values
 (gen_random_uuid(),1,'priya@eval.test','priya@eval.test','2026-08-02T01:00:00Z','connected',30,'fixture'),
 (gen_random_uuid(),1,'priya@eval.test','priya@eval.test','2026-08-02T02:00:00Z','no_answer',null,'fixture');`);
test('team date range reconciles rates, duration coverage, drill-downs and CSV',async({adminPage:page,shot})=>{
 seedAttempts();await page.goto('/dashboard/team');await page.getByLabel('Report from').and(page.locator(':visible')).fill('2026-08-02');await page.getByLabel('Report to').and(page.locator(':visible')).fill('2026-08-02');await page.getByRole('button',{name:'Apply dates'}).click();
 await expect(page).toHaveURL(/date_from=2026-08-02/);
 const row=page.getByLabel('Team metrics table').and(page.locator(':visible')).locator('tbody tr').filter({hasText:'priya@eval.test'});await expect(row).toContainText('50%');await expect(row).toContainText('30.0s');
 await row.getByRole('link',{name:'Recorded attempts for priya@eval.test: 2',exact:true}).first().click();await expect(page).toHaveURL(/metric=attempts/);
 await expect(page.getByLabel('Metric evidence table').and(page.locator(':visible')).locator('tbody tr')).toHaveCount(2);await expect(page.getByLabel('Metric evidence table').and(page.locator(':visible'))).toContainText('no_answer');
 const csv=await page.request.get('/api/team/export?date_from=2026-08-02&date_to=2026-08-02&caller=priya%40eval.test&metric=attempts');expect(csv.status()).toBe(200);expect(csv.headers()['x-export-row-count']).toBe('2');expect(await csv.text()).toContain('no_answer');
 await page.getByText('Metric definitions and historical coverage',{exact:true}).click();await expect(page.getByText(/Zero recorded attempts does not prove/)).toBeVisible();
 await page.setViewportSize({width:390,height:844});expect(await bodyOverflowsX(page)).toBe(false);await shot(page,'handoff-h-team-mobile');
});
test('Available found precedes onboarding and uses the actual logged date with matching CSV evidence',async({adminPage:page})=>{
 sql("update bolna_assignments set assigned_at='2026-08-01T00:00:00Z' where id=1");
 const saved=await page.request.post('/api/assignments/1/attempts',{data:{id:randomUUID(),revision:0,occurred_at:'2026-08-02T01:00:00Z',disposition:'connected',outcome:'Available',duration_seconds:40}});expect(saved.status(),await saved.text()).toBe(200);
 await page.goto('/dashboard/team?date_from=2026-08-02&date_to=2026-08-02');
 const row=page.getByLabel('Team metrics table').and(page.locator(':visible')).locator('tbody tr').filter({hasText:'priya@eval.test'});
 await expect(row.getByRole('link',{name:'First Available targets for priya@eval.test: 1',exact:true})).toBeVisible();
 await expect(row.getByRole('link',{name:'Warehouse references onboarded for priya@eval.test: 0',exact:true})).toBeVisible();
 await expect(page.getByLabel('Team metrics table').locator('th')).toHaveCount(6);await expect(row).toContainText('40.0s');
 await row.getByRole('link',{name:'First Available targets for priya@eval.test: 1',exact:true}).click();
 await expect(page.getByLabel('Metric evidence table').and(page.locator(':visible')).locator('tbody tr')).toHaveCount(1);
 const csv=await page.request.get('/api/team/export?date_from=2026-08-02&date_to=2026-08-02&caller=priya%40eval.test&metric=available');expect(csv.status()).toBe(200);expect(csv.headers()['x-export-row-count']).toBe('1');expect(await csv.text()).toContain('Available found');
});
test('team presets, empty evidence, pagination and invalid ranges are explicit',async({adminPage:page})=>{
 sql("insert into bolna_manual_attempts(id,assignment_id,actor,assignee,occurred_at,disposition,request_hash) select gen_random_uuid(),1,'priya@eval.test','priya@eval.test','2026-08-02T01:00:00Z'::timestamptz+i*interval '1 second','connected','fixture' from generate_series(1,53) i");
 await page.goto('/dashboard/team?date_from=2026-08-02&date_to=2026-08-02&metric=attempts&caller=priya%40eval.test');await expect(page.getByLabel('Metric evidence table').and(page.locator(':visible')).locator('tbody tr')).toHaveCount(50);
 await page.getByLabel('Go to page',{exact:true}).fill('2');await page.getByRole('button',{name:'Go',exact:true}).click();await expect(page.getByLabel('Metric evidence table').and(page.locator(':visible')).locator('tbody tr')).toHaveCount(3);
 await page.getByRole('link',{name:'Today',exact:true}).click();await expect(page.getByLabel('Metric evidence table')).toHaveCount(0);await expect(page.getByText('Historical call counts are unknown',{exact:false})).toBeVisible();
 await page.goto('/dashboard/team?date_from=2026-08-03&date_to=2026-08-02');await expect(page.locator('.dashboard-content [role=alert]')).toContainText('Start date cannot follow end date');
 expect((await page.request.get('/api/team/export?date_from=2026-02-30')).status()).toBe(400);
});
test('team reporting and CSV remain admin-only',async({employeePage:page})=>{
 expect((await page.request.get('/api/team/export')).status()).toBe(403);expect((await page.request.get('/api/team/export')).status()).toBe(403);
 await page.goto('/dashboard/team');await expect(page).toHaveURL(/\/dashboard\/my/);
});
