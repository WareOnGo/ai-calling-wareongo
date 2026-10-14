import {test,expect,bodyOverflowsX} from './fixtures';
import {unreadableText} from '../lib/visual-audit';
import {execFileSync} from 'node:child_process';
import {CONTAINER} from '../lib/env.mjs';
const record='a0000000-0000-4000-8000-000000000001',call='c0000000-0000-4000-8000-000000000001';
const sql=(value:string)=>execFileSync('podman',['exec','-i',CONTAINER,'psql','-U','postgres','-q','-v','ON_ERROR_STOP=1'],{input:value});
const capture=(body:object)=>sql(`select bolna_record_ai_evidence('${JSON.stringify(body).replaceAll("'","''")}'::jsonb,'retained')`);
test('actual provider attempts display times, intervals and separate confirmed conversations',async({adminPage:page,shot})=>{
 const base={id:call,status:'no-answer',created_at:'2026-10-10T00:00:00Z',initiated_at:'2026-10-10T03:00:00Z',updated_at:'2026-10-10T03:00:30Z',retry_count:0,batch_id:'fixture-batch',telephony_data:{provider:'twilio',provider_call_id:'first',call_type:'outbound',to_number:'+919811100001',duration:0}};
 capture(base);capture({...base,status:'completed',retry_count:1,initiated_at:'2026-10-10T04:00:00Z',updated_at:'2026-10-10T04:01:00Z',conversation_duration:30,transcript:'user: Warehouse available',telephony_data:{...base.telephony_data,provider_call_id:'second',duration:30}});capture(base);
 await page.goto('/dashboard/raw?q=Raghav');await expect(page.locator('table.sheet tbody').first()).toContainText('2 outbound');await page.getByRole('button',{name:'Show AI attempts'}).click();
 const drawer=page.locator('.ai-timeline');await expect(drawer.locator('.history-count')).toHaveText('2');await expect(drawer.locator('.attempt-card')).toHaveCount(2);await drawer.locator('.attempt-card').first().getByText('Call info',{exact:true}).click();await expect(drawer.locator('.attempt-info-content').first()).toContainText('Confirmed');await expect(drawer.locator('.attempt-info-content').first()).toContainText('1 hour');await expect(drawer).toContainText('IST');await expect(drawer.locator('.attempt-meta').first()).toContainText('Outbound');
 const panel=page.locator('.record-details-dialog .detail-body');expect((await panel.boundingBox())!.width).toBeGreaterThan(500);await shot(page,'review-drawer-ai-desktop');
 await page.setViewportSize({width:390,height:844});
 const bounds=await panel.evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,gridLeft:0,gridRight:innerWidth,width:r.width};});
 expect(bounds.width).toBeGreaterThan(300);expect(bounds.left).toBeGreaterThanOrEqual(bounds.gridLeft);expect(bounds.right).toBeLessThanOrEqual(bounds.gridRight+1);
 await drawer.getByText(/1 hour/).scrollIntoViewIfNeeded();await expect(drawer.getByText(/1 hour/)).toBeInViewport();await shot(page,'review-drawer-ai-mobile');await page.setViewportSize({width:1600,height:1000});
 await drawer.getByRole('button',{name:'History options',exact:true}).click();await drawer.getByLabel('AI history batch').fill('missing');await drawer.getByRole('button',{name:'Filter AI history'}).click();await expect(drawer.locator('.history-count')).toHaveText('0');await shot(page,'handoff-e-ai-timeline');await page.getByRole('button',{name:'Close details',exact:true}).click();await expect(page.locator('.record-details-dialog')).toHaveCount(0);await expect(page.getByRole('button',{name:'Show AI attempts'})).toBeFocused();
 await page.getByRole('button',{name:'Show AI attempts'}).click();await expect(drawer.locator('.history-count')).toHaveText('2');await page.keyboard.press('Escape');await page.getByRole('link',{name:'AI Calls',exact:true}).click();await expect(page).toHaveURL(/dashboard\/calls/);await expect(page.locator('.record-details-dialog')).toHaveCount(0);
});
test('legacy records show unknown counts and load history lazily; employee cannot expand execution scope',async({employeePage:page})=>{
 await page.goto('/dashboard/my');await expect(page.locator('[data-entity="record"] tbody').first()).toContainText('Attempt count unknown');
 const other=await page.request.get('/api/details/call/c0000000-0000-4000-8000-000000000003/ai');expect(other.status()).toBe(404);
 const own=await (await page.request.get(`/api/details/call/${call}/ai?scope=contact`)).json();expect(own.scope).toBe('execution');expect(own.total).toBe(0);expect(own.unknownExecutions).toBe(1);
 await page.locator('[data-entity="record"] tbody tr').filter({hasText:'Raghav'}).getByRole('button',{name:'Details for record'}).click();
 await page.getByRole('tab',{name:'AI activity',exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog).toContainText('No recorded AI calls for this number.');await dialog.getByRole('button',{name:'View saved record details',exact:true}).click();await expect(dialog.locator('.ai-saved-summary')).toBeVisible();await dialog.getByText('How calls are counted',{exact:true}).click();await expect(dialog).toContainText('no identifiable provider attempt');
});
test('balance blocks stay available explicitly, while no-answer is not a dead number',async({adminPage:page})=>{
 await page.goto('/dashboard/calls');await expect(page.locator('table.sheet tbody').first()).not.toContainText('dead number');
 sql("update bolna_call_logs set status='balance-low' where id='c0000000-0000-4000-8000-000000000004'");
 await page.reload();await expect(page.locator('table.sheet tbody').first().locator('tr')).toHaveCount(4);
 const csv=await (await page.request.get('/api/calls/export')).text();expect(csv).not.toContain('balance-low');
 await page.goto('/dashboard/calls?status=balance-low');await expect(page.locator('table.sheet tbody').first().locator('tr')).toHaveCount(1);await page.getByRole('button',{name:'Details for call'}).click();await expect(page.getByRole('dialog')).toContainText('balance-low');
 await page.goto('/dashboard/calls?include_blocked=1');await expect(page.locator('table.sheet tbody').first().locator('tr')).toHaveCount(5);
});

for(const width of [1366,390])for(const theme of ['light','dark']){
 test(`AI attempt summaries and manual results share readable colors at ${width}px in ${theme}`,async({adminPage:page,employeePage,shot})=>{
  await page.setViewportSize({width,height:width===390?844:768});await page.addInitScript(value=>localStorage.setItem('theme',value),theme);
  for(const [suffix,phone,direction] of [['1','9811100001','outbound'],['2','9811100002','inbound'],['3','9811100003','outbound']]){
   capture({id:`c0000000-0000-4000-8000-00000000000${suffix}`,status:'completed',telephony_data:{provider_call_id:'color-'+suffix,call_type:direction,to_number:direction==='outbound'?'+91'+phone:'+918000000000',from_number:direction==='inbound'?'+91'+phone:'+918000000000'}});
  }
  sql("update bolna_assignments set outcome='Unavailable' where id=1; update bolna_assignments set outcome='Unclear' where id=4");
  await page.goto('/dashboard/raw');
  for(const [name,result,manual] of [['Raghav Sharma','Available','Unavailable'],['Meera Nair','Unavailable','Available'],['Suresh Kumar','Unclear','Unclear']]){
   const row=page.locator('table.sheet tbody tr').filter({hasText:name});
   const summary=row.getByRole('button',{name:'Show AI attempts',exact:true});
   await expect(summary.locator('.ai-attempt-result')).toHaveText(result);
   await expect(summary).toHaveClass(new RegExp('ai-attempt-'+result.toLowerCase()));
   await expect(row.locator('.record-history .pill-'+manual.toLowerCase())).toHaveText(manual);
  }
  const empty=page.locator('table.sheet tbody tr').filter({hasText:'Latha Menon'});
  await expect(empty.getByRole('button',{name:'Show AI attempts'})).toHaveCount(0);
  await expect(empty.locator('.record-history .muted').first()).toHaveText('0 outbound · 0 inbound');
  const summary=page.locator('.ai-attempt-summary').first();await summary.scrollIntoViewIfNeeded();
  expect(await unreadableText(page)).toEqual([]);expect(await bodyOverflowsX(page)).toBe(false);
  await shot(page,`ai-attempt-colors-${width}-${theme}`);
  await summary.click();await expect(page.locator('.record-details-dialog')).toBeVisible();
  await page.keyboard.press('Escape');await expect(summary).toBeFocused();
  if(width===390){await page.locator('.record-history .pill').first().scrollIntoViewIfNeeded();expect(await unreadableText(page)).toEqual([]);await shot(page,`manual-result-colors-${width}-${theme}`);}
  const palette=await page.locator('.record-history .pill-available').first().evaluate(el=>({color:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor}));
  await page.goto('/dashboard/calls');
  const history=page.getByRole('button',{name:'Show AI attempts',exact:true}).first();await history.scrollIntoViewIfNeeded();
  const bounds=await history.evaluate(button=>{const cell=button.closest('td')!;return {right:button.getBoundingClientRect().right,cellRight:cell.getBoundingClientRect().right,text:button.scrollWidth,width:button.clientWidth};});
  expect(bounds.right).toBeLessThanOrEqual(bounds.cellRight);expect(bounds.text).toBeLessThanOrEqual(bounds.width);
  await employeePage.setViewportSize({width,height:width===390?844:768});await employeePage.addInitScript(value=>localStorage.setItem('theme',value),theme);
  await employeePage.goto('/dashboard/my?view=done');
  const result=employeePage.getByLabel('Result of the call').first();await expect(result).toHaveAttribute('data-result','Available');
  expect(await result.evaluate(el=>({color:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor}))).toEqual(palette);
  expect(await unreadableText(employeePage)).toEqual([]);
 });
}
