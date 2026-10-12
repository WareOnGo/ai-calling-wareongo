import {test,expect,bodyOverflowsX} from './fixtures';
import {execFileSync} from 'node:child_process';
import {CONTAINER} from '../lib/env.mjs';
const sql=(text:string)=>execFileSync('podman',['exec','-i',CONTAINER,'psql','-U','postgres','-q','-v','ON_ERROR_STOP=1'],{input:text});
test('manual batch cards retain all targeted rows, drill down and export assigned work',async({adminPage:page,shot})=>{
 const ids=[2,3,5,6].map(i=>`a0000000-0000-4000-8000-00000000000${i}`);
 const res=await page.request.post('/api/assignments',{data:{entity_type:'record',ids,assignee:'priya@eval.test'}});expect(res.status()).toBe(200);const data=await res.json();expect(data.assigned).toBe(2);
 await page.goto('/dashboard/batches?kind=manual');await page.getByRole('link',{name:`Manual batch ${data.batchId.slice(0,8)}`}).click();
 await expect(page.locator('.batch-metrics').getByRole('link',{name:'4 Targeted records'})).toBeVisible();await expect(page.locator('table.sheet tbody tr')).toHaveCount(4);
 await page.locator('.batch-metrics').getByRole('link',{name:'2 Open',exact:true}).click();await expect(page).toHaveURL(/metric=open/);await expect(page.locator('table.sheet tbody tr')).toHaveCount(2);
 const exported=await page.request.get(`/api/batches/${data.batchId}/export?kind=manual&metric=open`);expect(exported.status()).toBe(200);expect(exported.headers()['x-export-row-count']).toBe('2');
 await page.setViewportSize({width:390,height:844});expect(await bodyOverflowsX(page)).toBe(false);await shot(page,'handoff-f-manual-batch');
 await page.goto('/dashboard/batches/manual/legacy');await expect(page.locator('.page-title')).toContainText('Legacy / no recorded batch');
});
test('AI batch browser goes beyond 20, retains provider failures and reconciliation controls',async({adminPage:page})=>{
 sql("insert into call_batches(id,created_by,state,bolna_batch_id,agent_language,agent_id,created_at) select ('d0000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'admin@eval.test',case when i=1 then 'uncertain' else 'scheduled' end,'provider-'||i,'hindi','b0000000-0000-4000-8000-00000000000a',now()-i*interval '1 hour' from generate_series(1,27) i; insert into call_batch_items(batch_id,record_id,name,contact_number) values ('d0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','Raghav','+919811100001'); update bolna_call_logs set batch_id='provider-1',status='balance-low' where id='c0000000-0000-4000-8000-000000000001'");
 await page.goto('/dashboard/batches');await expect(page.locator('.batch-catalog article')).toHaveCount(25);await page.getByLabel('Go to page',{exact:true}).fill('2');await page.getByRole('button',{name:'Go',exact:true}).click();await expect(page.locator('.batch-catalog article')).toHaveCount(2);
 await page.goto('/dashboard/batches/ai/d0000000-0000-4000-8000-000000000001');await expect(page.getByRole('button',{name:'Check Bolna status'})).toBeVisible();await expect(page.getByRole('button',{name:'Resolve batch',exact:true})).toBeVisible();
 await page.locator('.batch-metrics').getByRole('link',{name:'1 Balance blocked',exact:true}).click();await expect(page.locator('table.sheet tbody')).toContainText('balance-low');
 const csv=await page.request.get('/api/batches/d0000000-0000-4000-8000-000000000001/export?kind=ai&metric=blocked');expect(csv.headers()['x-export-row-count']).toBe('1');
});
test('balance distinguishes zero, stale data and unavailable without blocking dashboard use',async({adminPage:page})=>{
 let state='zero';await page.route('**/api/balance*',route=>route.fulfill({json:state==='zero'?{balance:0,state:'fresh',unit:'provider units',refreshedAt:'2026-10-10T00:00:00Z',low:true,message:null}:state==='stale'?{balance:25,state:'stale',unit:'provider units',refreshedAt:'2026-10-10T00:00:00Z',low:false,message:'Balance request timed out or failed.'}:{balance:null,state:'unavailable',unit:'provider units',refreshedAt:null,low:false,message:'Provider authentication failed.'}}));
 await page.goto('/dashboard/raw');const wallet=page.getByRole('complementary',{name:'Bolna balance'});await expect(wallet).toContainText('0 provider units');await expect(wallet).toContainText('Low balance');
 await wallet.getByRole('button',{name:'Balance details',exact:true}).click();
 state='stale';await wallet.getByRole('button',{name:'Refresh balance'}).click();await expect(wallet).toContainText('25 provider units');await expect(wallet).toContainText('Stale');
 state='unavailable';await wallet.getByRole('button',{name:'Refresh balance'}).click();await expect(wallet).toContainText('Unavailable');await expect(wallet).not.toContainText('0 provider units');await expect(page.locator('table.sheet tbody').first().locator('tr')).toHaveCount(6);
});
test('batch data, exports and balance stay admin-only',async({employeePage:page})=>{
 for(const url of ['/api/balance','/api/batches','/api/batches/export?kind=manual','/api/batches/legacy/export?kind=manual'])expect((await page.request.get(url)).status()).toBe(403);
 await page.goto('/dashboard/batches');await expect(page).toHaveURL(/\/dashboard\/my/);
});
