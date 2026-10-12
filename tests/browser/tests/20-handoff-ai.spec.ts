import {test,expect} from './fixtures';
import {execFileSync} from 'node:child_process';
import {CONTAINER} from '../lib/env.mjs';
const record='a0000000-0000-4000-8000-000000000001',call='c0000000-0000-4000-8000-000000000001';
const sql=(value:string)=>execFileSync('podman',['exec','-i',CONTAINER,'psql','-U','postgres','-q','-v','ON_ERROR_STOP=1'],{input:value});
const capture=(body:object)=>sql(`select bolna_record_ai_evidence('${JSON.stringify(body).replaceAll("'","''")}'::jsonb,'retained')`);
test('actual provider attempts display times, intervals and separate confirmed conversations',async({adminPage:page,shot})=>{
 const base={id:call,status:'no-answer',created_at:'2026-10-10T00:00:00Z',initiated_at:'2026-10-10T03:00:00Z',updated_at:'2026-10-10T03:00:30Z',retry_count:0,batch_id:'fixture-batch',telephony_data:{provider:'twilio',provider_call_id:'first',call_type:'outbound',to_number:'+919811100001',duration:0}};
 capture(base);capture({...base,status:'completed',retry_count:1,initiated_at:'2026-10-10T04:00:00Z',updated_at:'2026-10-10T04:01:00Z',conversation_duration:30,transcript:'user: Warehouse available',telephony_data:{...base.telephony_data,provider_call_id:'second',duration:30}});capture(base);
 await page.goto('/dashboard/raw?q=Raghav');await expect(page.locator('table.sheet tbody').first()).toContainText('2 outbound');await page.getByRole('button',{name:'Show AI attempts'}).click();
 const drawer=page.locator('.ai-timeline');await expect(drawer).toContainText('2 known attempts');await expect(drawer).toContainText('1 confirmed conversations');await expect(drawer).toContainText('1 hour since the previous dated attempt');await expect(drawer).toContainText('IST');await expect(drawer).toContainText('Dial started:');
 const panel=page.locator('.ai-history-panel');expect((await panel.boundingBox())!.width).toBeGreaterThan(500);await shot(page,'review-drawer-ai-desktop');
 await page.setViewportSize({width:390,height:844});
 const bounds=await panel.evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,gridLeft:0,gridRight:innerWidth,width:r.width};});
 expect(bounds.width).toBeGreaterThan(300);expect(bounds.left).toBeGreaterThanOrEqual(bounds.gridLeft);expect(bounds.right).toBeLessThanOrEqual(bounds.gridRight+1);
 await drawer.getByText(/1 hour since the previous dated attempt/).scrollIntoViewIfNeeded();await expect(drawer.getByText(/1 hour since the previous dated attempt/)).toBeInViewport();await shot(page,'review-drawer-ai-mobile');await page.setViewportSize({width:1600,height:1000});
 await drawer.getByLabel('AI history batch').fill('missing');await drawer.getByRole('button',{name:'Filter AI history'}).click();await expect(drawer).toContainText('0 known attempts');await shot(page,'handoff-e-ai-timeline');await page.getByRole('button',{name:'Close AI history',exact:true}).click();await expect(page.locator('.ai-history-row')).toHaveCount(0);await expect(page.getByRole('button',{name:'Show AI attempts'})).toBeFocused();
 await page.getByRole('button',{name:'Show AI attempts'}).click();await expect(drawer).toContainText('2 known attempts');await page.keyboard.press('Escape');await page.getByRole('link',{name:'Call Analytics',exact:true}).click();await expect(page).toHaveURL(/dashboard\/calls/);await expect(page.locator('.ai-history-row')).toHaveCount(0);
});
test('legacy records show unknown counts and load history lazily; employee cannot expand execution scope',async({employeePage:page})=>{
 await page.goto('/dashboard/my');await expect(page.locator('[data-entity="record"] tbody').first()).toContainText('Attempt count unknown');
 const other=await page.request.get('/api/details/call/c0000000-0000-4000-8000-000000000003/ai');expect(other.status()).toBe(404);
 const own=await (await page.request.get(`/api/details/call/${call}/ai?scope=contact`)).json();expect(own.scope).toBe('execution');expect(own.total).toBe(0);expect(own.unknownExecutions).toBe(1);
 await page.locator('[data-entity="record"] tbody tr').filter({hasText:'Raghav'}).getByRole('button',{name:'Details for record'}).click();await expect(page.getByRole('button',{name:'Load AI attempt history'})).toBeVisible();
 await page.getByRole('button',{name:'Load AI attempt history'}).click();await expect(page.getByRole('dialog')).toContainText('no identifiable provider attempt');
});
test('balance blocks stay available explicitly, while no-answer is not a dead number',async({adminPage:page})=>{
 await page.goto('/dashboard/calls');await expect(page.locator('table.sheet tbody').first()).not.toContainText('dead number');
 sql("update bolna_call_logs set status='balance-low' where id='c0000000-0000-4000-8000-000000000004'");
 await page.reload();await expect(page.locator('table.sheet tbody').first().locator('tr')).toHaveCount(4);
 const csv=await (await page.request.get('/api/calls/export')).text();expect(csv).not.toContain('balance-low');
 await page.goto('/dashboard/calls?status=balance-low');await expect(page.locator('table.sheet tbody').first().locator('tr')).toHaveCount(1);await page.getByRole('button',{name:'Details for call'}).click();await expect(page.getByRole('dialog')).toContainText('balance-low');
 await page.goto('/dashboard/calls?include_blocked=1');await expect(page.locator('table.sheet tbody').first().locator('tr')).toHaveCount(5);
});
