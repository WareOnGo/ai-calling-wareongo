import {test,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {sessionCookie} from '../lib/session.mjs';
// Explicit opt-in: run after test:stage performance, without the ordinary seed fixture.
test('measures cold/warm pages and lazy details on the volume fixture',async({page,context})=>{
 test.skip(process.env.EVAL_PERFORMANCE!=='1','Requires the 50k/10k disposable volume fixture');
 test.setTimeout(180000);
 await context.addCookies([sessionCookie('admin@perf.test') as never]);
 await context.route('**/api/balance*',route=>route.fulfill({json:{balance:42,state:'fresh',unit:'provider units',refreshedAt:new Date().toISOString(),low:false}}));
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const measurements:Record<string,unknown>={};
 for(const path of ['/dashboard/raw','/dashboard/raw?page=400','/dashboard/calls','/dashboard/calls?page=200','/dashboard/assignments?page=50','/dashboard/team']){
  const runs=[];for(let i=0;i<3;i++){const start=Date.now();const response=await page.goto(path);await expect(page.locator('.dashboard-content')).toHaveAttribute('aria-busy','false');await expect(page.locator('[data-loading-view]')).toHaveCount(0);await expect(page.locator('.page-title:visible')).toBeVisible();if(/\/(raw|calls|assignments)/.test(path))await expect(page.locator('table.sheet.resizable')).toBeVisible();const html=await response!.body();runs.push({ms:Date.now()-start,documentBytes:html.length});expect(response!.status()).toBe(200);expect(html.toString()).not.toContain('canceling statement due to statement timeout');}
  measurements[path]=runs;
 }
 await expect(page.getByRole('heading',{name:'Team performance',exact:true})).toBeVisible();
 for(const kind of ['manual','ai']){
  await page.goto(`/dashboard/batches?kind=${kind}`);
  await expect(page.locator('.dashboard-content')).toHaveAttribute('aria-busy','false');
  const path=await page.locator('.batch-catalog:visible h2 a').first().getAttribute('href');expect(path).toBeTruthy();
  const runs=[];for(let i=0;i<3;i++){
   const start=Date.now();const response=await page.goto(path!);
   await expect(page.locator('.dashboard-content')).toHaveAttribute('aria-busy','false');
   await expect(page.locator('.batch-metrics:visible')).toContainText('250');
   await expect(page.locator('table.sheet:visible tbody tr')).toHaveCount(50);
   runs.push({ms:Date.now()-start,documentBytes:(await response!.body()).length});expect(response!.status()).toBe(200);
  }
  measurements[`${kind}_batch_250`]=runs;
 }
 await page.goto('/dashboard/calls');await expect(page.locator('.sheet-save-status')).toHaveText('All changes saved');await page.getByRole('button',{name:'Details for call',exact:true}).first().click({timeout:10000});await expect(page.getByRole('dialog')).toContainText('Warehouse discussion');
 measurements.resources=await page.evaluate(()=>performance.getEntriesByType('resource').map(r=>({name:r.name.split('/').slice(-2).join('/'),ms:Math.round(r.duration)})));
 await context.addCookies([sessionCookie('caller1@perf.test') as never]);await page.goto('/dashboard/my');await expect(page.locator('.page-title:visible')).toContainText('My Work');
 expect(errors).toEqual([]);writeFileSync(`/tmp/bolna-handoff-browser-performance${process.env.EVAL_PRODUCTION?'-production':''}.json`,JSON.stringify(measurements,null,2));console.log(JSON.stringify(measurements));
});

test('streamed production tables hydrate cleanly under slow document delivery',async({page,context})=>{
 test.skip(process.env.EVAL_PERFORMANCE!=='1'||process.env.EVAL_PRODUCTION!=='1','Requires production volume fixture');
 test.setTimeout(180000);
 await context.addCookies([sessionCookie('admin@perf.test') as never]);
 await context.route('**/api/balance*',route=>route.fulfill({json:{balance:42,state:'fresh',unit:'provider units',refreshedAt:new Date().toISOString(),low:false}}));
 const errors:string[]=[];page.on('pageerror',error=>errors.push(`${page.url()}: ${error.message}`));
 const network=await context.newCDPSession(page);await network.send('Network.enable');
 await network.send('Network.emulateNetworkConditions',{offline:false,latency:20,downloadThroughput:1_500_000/8,uploadThroughput:1_000_000});
 for(let repeat=0;repeat<2;repeat++)for(const path of ['/dashboard/raw','/dashboard/calls','/dashboard/calls?page=200','/dashboard/team']){
  await page.goto(path);await expect(page.locator('[data-loading-view]')).toHaveCount(0);
  if(path.includes('/team'))await expect(page.getByRole('heading',{name:'Team performance',exact:true})).toBeVisible();
  else await expect(page.locator('table.sheet.resizable')).toBeVisible();
 }
 await page.getByLabel('Report from').fill('2026-10-01');await page.getByRole('button',{name:'Apply dates'}).click();
 await expect(page).toHaveURL(/date_from=2026-10-01/);
 expect(errors).toEqual([]);
});
