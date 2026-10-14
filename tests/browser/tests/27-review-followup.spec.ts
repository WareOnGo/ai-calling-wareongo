import {test,expect,bodyOverflowsX} from './fixtures';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {CONTAINER} from '../lib/env.mjs';
const raw='a0000000-0000-4000-8000-000000000001',call='c0000000-0000-4000-8000-000000000001';
const sql=(s:string)=>execFileSync('podman',['exec','-i',CONTAINER,'psql','-U','postgres','-q','-v','ON_ERROR_STOP=1'],{input:s});
const work=(page:any,name='Raghav')=>page.locator('[data-entity="record"] tbody tr').filter({hasText:name});
const saved=async(row:any)=>expect(row.locator('.save-status')).toHaveText('Saved');
const detailShot=(locator:any,name:string)=>locator.screenshot({path:join(process.cwd(),'shots',`${name}.png`),animations:'disabled'});

test('legacy Done rows accept note and result edits without an invented call or replaced warehouse reference',async({employeePage:page,shot})=>{
 sql("alter table bolna_assignments disable trigger bolna_assignment_quality_guard; update bolna_assignments set wh_id='123' where id=2; alter table bolna_assignments enable trigger bolna_assignment_quality_guard;");
 await page.goto('/dashboard/my');const row=work(page,'Meera');
 await expect(row.getByRole('button',{name:'Done',exact:true})).toHaveAttribute('aria-pressed','true');
 await row.getByLabel('Your notes').fill('Legacy onboarding reference checked with the operations team');await row.getByLabel('Your notes').blur();await saved(row);
 await row.getByLabel('Result of the call').selectOption('Unavailable');await saved(row);
 await page.reload();await expect(work(page,'Meera').getByLabel('Warehouse ID')).toHaveValue('123');
 await expect(work(page,'Meera').getByLabel('Your notes')).toHaveValue('Legacy onboarding reference checked with the operations team');
 await expect(work(page,'Meera').getByLabel('Result of the call')).toHaveValue('Unavailable');
 await expect(work(page,'Meera').getByRole('button',{name:'Log manual call'})).toBeDisabled();
 await shot(page,'review2-legacy-done');
});

test('a caller deliberately closes repeated no-answer work as Exhausted with a reason',async({employeePage:page,adminPage,shot})=>{
 await page.goto('/dashboard/my');let row=work(page);
 await row.getByRole('button',{name:'Log manual call'}).click();const dialog=page.getByRole('dialog');
 await dialog.getByLabel('What happened?').selectOption('no_answer');await dialog.getByLabel('Attempt notes',{exact:true}).fill('No response on the latest follow-up');
 await shot(page,'review2-manual-attempt');await detailShot(dialog,'changelog-manual-dialog');await dialog.getByRole('button',{name:'Record attempt'}).click();await expect(dialog).toHaveCount(0);
 await expect(row).toContainText('No answer / RNR');
 await row.getByLabel('Your notes').fill('Repeated attempts across several days received no response; follow-ups exhausted');await row.getByLabel('Your notes').blur();await saved(row);
 await row.getByLabel('Closure reason').selectOption('exhausted');await saved(row);
 await row.getByRole('button',{name:'Mark done'}).click();await saved(row);await page.reload();row=work(page);
 await expect(row.getByRole('button',{name:'Done',exact:true})).toHaveAttribute('aria-pressed','true');await expect(row.getByLabel('Closure reason')).toHaveValue('exhausted');await expect(row.getByLabel('Result of the call').locator('option:checked')).toHaveText('No manual result');
 await shot(page,'review2-exhausted-work');
 await adminPage.goto('/dashboard/assignments?state=done');const assigned=adminPage.locator('tbody tr').filter({hasText:'Raghav'});await expect(assigned).toContainText('Exhausted');await expect(assigned).toContainText('No answer / RNR');await shot(adminPage,'review2-exhausted-admin');
});

test('Keep existing result preserves a dropdown edit after an earlier call result',async({employeePage:page})=>{
 await page.goto('/dashboard/my');const row=work(page);
 let refreshes=0;await page.route('**/dashboard/my?*',async route=>{if(route.request().headers()['rsc']==='1'){refreshes++;await new Promise(resolve=>setTimeout(resolve,400));}await route.continue();});
 await row.getByRole('button',{name:'Log manual call'}).click();let dialog=page.getByRole('dialog');
 await dialog.getByRole('combobox',{name:'Manual result',exact:true}).selectOption('Unavailable');await dialog.getByRole('button',{name:'Record attempt'}).click();await expect(dialog).toHaveCount(0);
 await row.getByLabel('Result of the call').selectOption('Available');await saved(row);
 await row.getByRole('button',{name:'Log manual call'}).click();dialog=page.getByRole('dialog');await expect(dialog.getByRole('combobox',{name:'Manual result',exact:true})).toHaveValue('');
 await dialog.getByRole('button',{name:'Record attempt'}).click();await expect(dialog).toHaveCount(0);await page.reload();await expect(work(page).getByLabel('Result of the call')).toHaveValue('Available');expect(refreshes).toBeGreaterThan(0);
});

test('UTC provider timestamps show IST times and readable intervals on desktop and mobile',async({adminPage:page,shot})=>{
 for(const [id,time] of [['local-first','2026-10-10 23:59:30'],['local-second','2026-10-11 00:01:00']]){
  const body={id:call,status:'no-answer',initiated_at:time,updated_at:time,created_at:time,retry_count:null,telephony_data:{provider:'twilio',provider_call_id:id,call_type:'outbound',to_number:'+919811100001',duration:'0',retried:null}};
  sql(`select bolna_record_ai_evidence('${JSON.stringify(body)}'::jsonb,'retained')`);
 }
 await page.goto('/dashboard/raw?q=Raghav');await page.getByRole('button',{name:'Show AI attempts'}).click();const history=page.locator('.ai-timeline');
 await history.locator('.attempt-card').first().getByText('Call info', {exact:true}).click();await expect(history.locator('.attempt-info-content').first()).toContainText('1 minute 30 seconds');await expect(history).toContainText('5:31 am IST');await expect(history.locator('.attempt-card').first()).toContainText('local-second');
 await shot(page,'review2-provider-intervals');await page.setViewportSize({width:1000,height:1000});await detailShot(history,'changelog-provider-history');await page.setViewportSize({width:390,height:844});expect(await bodyOverflowsX(page)).toBe(false);await history.getByText(/1 minute 30 seconds/).scrollIntoViewIfNeeded();await expect(history.getByText(/1 minute 30 seconds/)).toBeInViewport();await shot(page,'review2-provider-intervals-mobile');
});

test('Queue CSV excludes human-owned contacts and checks ownership again at download',async({adminPage:page,shot})=>{
 await page.goto('/dashboard/raw');await page.locator('.selall').check();await page.getByRole('button',{name:/Queue for calling/}).click();const dialog=page.getByRole('dialog');
 await dialog.getByText('Selection details',{exact:true}).click();await expect(dialog.getByLabel('Calling ownership preview')).toContainText('2 contacts held');await expect(dialog.getByRole('button',{name:'Download CSV (2)'})).toBeEnabled();await shot(page,'review2-queue-ownership');await detailShot(dialog,'changelog-queue-dialog');
 const [download]=await Promise.all([page.waitForEvent('download'),dialog.getByRole('button',{name:'Download CSV (2)'}).click()]);const csv=readFileSync((await download.path())!,'utf8');
 expect(csv).toContain('9811100002');expect(csv).toContain('9811100005');expect(csv).not.toContain('9811100001');expect(csv).not.toContain('9811100003');
 sql("insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state) values('record','a0000000-0000-4000-8000-000000000002','priya@eval.test','admin@eval.test','open'),('record','a0000000-0000-4000-8000-000000000005','raj@eval.test','admin@eval.test','open')");
 let downloaded=false;page.on('download',()=>downloaded=true);await dialog.getByRole('button',{name:'Download CSV (2)'}).click();await expect(dialog.getByRole('alert')).toContainText('No eligible contacts remain');await expect(dialog.getByRole('button',{name:/Download CSV/})).toHaveCount(0);expect(downloaded).toBe(false);
});

test('legacy call-row onboarding is visible and retained in CSV',async({adminPage:page,shot})=>{
 sql("update bolna_call_logs set wh_id='WH-789',added_to_db=true where id='c0000000-0000-4000-8000-000000000002'");
 await page.goto('/dashboard/calls?q=Meera');await expect(page.locator('table.sheet tbody').first()).toContainText('WH-789');await expect(page.locator('table.sheet tbody').first()).toContainText('Legacy');
 const csv=await (await page.request.get('/api/calls/export?q=Meera')).text();expect(csv).toContain('Legacy call WH ID');expect(csv).toContain('WH-789');await shot(page,'review2-legacy-call-reference');
});

test('assignments show readable disposition and due date and Team opens on five measures',async({adminPage:page,shot})=>{
 sql("update bolna_assignments set disposition='awaiting_confirmation',next_due_at='2026-10-12T03:00:00Z' where id=1");
 await page.goto('/dashboard/assignments');const row=page.locator('table.sheet tbody tr').filter({has:page.getByRole('button',{name:'Details for record'})}).filter({hasText:'Raghav'});await expect(row).toContainText('Will check and get back');await expect(row).toContainText('Due');await shot(page,'review2-assignment-followup');
 await page.goto('/dashboard/raw?q=Raghav');await expect(page.locator('table.sheet tbody').first()).toContainText('Will check and get back');await expect(page.locator('table.sheet tbody').first()).not.toContainText('awaiting_confirmation');
 await page.goto('/dashboard/team');await expect(page.getByLabel('Team metrics table').locator('thead th')).toHaveCount(6);await expect(page.getByRole('link',{name:'Review completion quality'})).toBeVisible();await shot(page,'review2-team-five-metrics');await page.setViewportSize({width:900,height:1000});await detailShot(page.getByLabel('Team metrics table'),'changelog-team-table');
});
