import {test,expect,bodyOverflowsX} from './fixtures';
import {execFileSync} from 'node:child_process';
import {CONTAINER} from '../lib/env.mjs';
import {randomUUID} from 'node:crypto';
const sql=(s:string)=>execFileSync('podman',['exec','-i',CONTAINER,'psql','-U','postgres','-q','-v','ON_ERROR_STOP=1'],{input:s});
const seedAttempts=()=>sql(`insert into bolna_manual_attempts(id,assignment_id,actor,assignee,occurred_at,disposition,duration_seconds,request_hash) values
 (gen_random_uuid(),1,'priya@eval.test','priya@eval.test','2026-08-02T01:00:00Z','connected',30,'fixture'),
 (gen_random_uuid(),1,'priya@eval.test','priya@eval.test','2026-08-02T02:00:00Z','no_answer',null,'fixture');`);

test('manual log metrics retain their dates and stay separate from automatic calls',async({adminPage:page,shot})=>{
 seedAttempts();
 await page.goto('/dashboard/team');
 await page.getByRole('button',{name:'Toggle filters'}).click();
 await page.getByRole('tab',{name:'Dates',exact:true}).click();
 await page.getByLabel('Report from').fill('2026-08-02');await page.getByLabel('Report to').fill('2026-08-02');
 await page.getByRole('dialog',{name:'Filters',exact:true}).getByRole('button',{name:'Apply',exact:true}).click();
 await expect(page).toHaveURL(/date_from=2026-08-02/);
 const overview=page.getByLabel('Team metrics table').locator('tbody tr').filter({hasText:'priya@eval.test'});
 await expect(overview.getByRole('cell').first()).toHaveText('—');
 await expect(page.getByLabel('Manual call logs table')).toBeHidden();
 await page.locator('.team-manual-logs > summary').click();
 const row=page.getByLabel('Manual call logs table').locator('tbody tr').filter({hasText:'priya@eval.test'});
 await expect(row).toContainText('50%');await expect(row).toContainText('30.0s');
 await expect(page.getByText('Historical call counts are unknown',{exact:false})).toBeVisible();
 await expect(page.locator('a[href*="metric="]')).toHaveCount(0);
 const csv=await page.request.get('/api/team/export?date_from=2026-08-02&date_to=2026-08-02&caller=priya%40eval.test&metric=attempts');
 expect(csv.status()).toBe(200);expect(csv.headers()['x-export-row-count']).toBe('2');
 await page.setViewportSize({width:390,height:844});expect(await bodyOverflowsX(page)).toBe(false);await shot(page,'handoff-h-team-mobile');
});

test('recorded outcomes stay visible for callers without Callyzer',async({adminPage:page})=>{
 sql("update bolna_assignments set assigned_at='2026-08-01T00:00:00Z' where id=1");
 const saved=await page.request.post('/api/assignments/1/attempts',{data:{id:randomUUID(),revision:0,occurred_at:'2026-08-02T01:00:00Z',disposition:'connected',outcome:'Available',duration_seconds:40}});expect(saved.status(),await saved.text()).toBe(200);
 await page.goto('/dashboard/team?date_from=2026-08-02&date_to=2026-08-02');
 const row=page.getByLabel('Team metrics table').locator('tbody tr').filter({hasText:'priya@eval.test'});
 await expect(row.getByRole('cell').nth(3)).toHaveText('1');await expect(row.getByRole('cell').nth(4)).toHaveText('0');
 await expect(row).toContainText('Manual only');await expect(row.getByRole('cell').first()).toHaveText('—');
 await expect(page.getByLabel('Team metrics table').locator('thead th')).toHaveCount(6);
 await page.locator('.team-manual-logs > summary').click();await expect(page.getByLabel('Manual call logs table')).toContainText('40.0s');
});

test('old evidence URLs show the overview without audit tables or export controls',async({adminPage:page})=>{
 seedAttempts();
 await page.goto('/dashboard/team?date_from=2026-08-02&date_to=2026-08-02&metric=attempts&caller=priya%40eval.test');
 await expect(page.getByLabel('Team metrics table')).toBeVisible();
 await expect(page.getByLabel('Metric evidence table')).toHaveCount(0);
 await expect(page.getByRole('link',{name:'Export these rows'})).toHaveCount(0);
 await expect(page.getByPlaceholder('Search target or evidence…')).toHaveCount(0);
 await page.getByRole('navigation',{name:'Quick report dates'}).getByRole('link',{name:'Today',exact:true}).click();
 await expect(page).not.toHaveURL(/metric=/);
 await page.goto('/dashboard/team?date_from=2026-08-03&date_to=2026-08-02');await expect(page.locator('.dashboard-content [role=alert]')).toContainText('Start date cannot follow end date');
 expect((await page.request.get('/api/team/export?date_from=2026-02-30')).status()).toBe(400);
});

test('team reporting and CSV remain admin-only',async({employeePage:page})=>{
 expect((await page.request.get('/api/team/export')).status()).toBe(403);
 await page.goto('/dashboard/team');await expect(page).toHaveURL(/\/dashboard\/my/);
});
