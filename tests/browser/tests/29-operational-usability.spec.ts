import {test,expect,bodyOverflowsX} from './fixtures';
import {join} from 'node:path';
import type {Page,Locator} from '@playwright/test';
const work=(page:Page)=>page.locator('[data-entity="record"] tbody tr').filter({hasText:'Raghav'});
const saved=(row:Locator)=>expect(row.locator('.save-status')).toHaveText('Saved');
const screenshot=(locator:Locator,name:string)=>locator.screenshot({path:join(process.cwd(),'shots',`${name}.png`),animations:'disabled'});

for(const [disposition,conversation,retry,required] of [
 ['connected',true,false,false],['no_answer',false,true,false],['busy',false,true,false],
 ['switched_off',false,true,false],['callback',true,true,true],['awaiting_confirmation',true,true,true],['invalid_number',false,false,false],
] as const){
 test(`call form shows only relevant fields for ${disposition}`,async({employeePage:page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/dashboard/my');await work(page).getByRole('button',{name:'Log manual call'}).click();
  const dialog=page.getByRole('dialog');await dialog.getByLabel('What happened?').selectOption(disposition);
  await expect(dialog.getByRole('combobox',{name:'Manual result',exact:true})).toHaveCount(conversation?1:0);
  await expect(dialog.getByLabel('Reported duration')).toHaveCount(conversation?1:0);
  await expect(dialog.getByLabel('Next follow-up')).toHaveCount(retry?1:0);
  if(retry){expect(await dialog.getByLabel('Next follow-up').evaluate((el:HTMLInputElement)=>el.required)).toBe(required);await expect(dialog).toContainText('This task stays open');await expect(dialog.getByRole('button',{name:'Record call — keep open'})).toBeVisible();}
  await expect(dialog.getByLabel('Also mark this task done')).toHaveCount(retry?0:1);
  await expect(dialog.getByLabel('Event',{exact:true})).toHaveCount(0);expect(await bodyOverflowsX(page)).toBe(false);
  const bounds=await dialog.evaluate(el=>({head:el.querySelector('.modal-head')!.getBoundingClientRect().top,bottom:el.querySelector('.modal-foot')!.getBoundingClientRect().bottom,height:innerHeight}));
  expect(bounds.head).toBeGreaterThanOrEqual(0);expect(bounds.bottom).toBeLessThanOrEqual(bounds.height);
 });
}

test('RNR then Available and WH ID opens a clear path to log the conversation and finish',async({employeePage:page})=>{
 await page.goto('/dashboard/my');const row=work(page);
 await row.getByRole('button',{name:'Log manual call'}).click();let dialog=page.getByRole('dialog');
 await dialog.getByLabel('What happened?').selectOption('no_answer');await screenshot(dialog,'operations-rnr');await dialog.getByRole('button',{name:'Record call — keep open'}).click();await expect(dialog).toHaveCount(0);
 await row.getByLabel('Result of the call').selectOption('Available');await saved(row);
 await row.getByLabel('Warehouse ID').fill('12345');
 // A slow blur save must settle before the completion dialog uses its revision.
 await page.route('**/api/assignments/1',async route=>{if(route.request().method()==='PATCH')await new Promise(resolve=>setTimeout(resolve,200));await route.continue();});
 await row.getByRole('button',{name:'Mark done'}).click();dialog=page.getByRole('dialog');
 await expect(dialog).toContainText('Last logged call: No answer / RNR');await expect(dialog).toContainText('The saved result is Available');
 await expect(dialog.getByLabel('What happened?')).toHaveValue('');await expect(dialog.getByRole('button',{name:'Record attempt'})).toBeDisabled();
 await screenshot(dialog,'operations-completion-guide');
 await dialog.getByLabel('What happened?').selectOption('connected');await expect(dialog.getByLabel('Warehouse ID')).toHaveValue('12345');
 await expect(dialog.getByLabel('Also mark this task done')).toBeChecked();await dialog.getByLabel('Reported duration').fill('45');await dialog.getByLabel('Warehouse has been added to the database').check();
 const formStart=(await dialog.getByLabel('What happened?').locator('..').boundingBox())!;const box=(await dialog.boundingBox())!;await page.screenshot({path:join(process.cwd(),'shots','operations-complete.png'),clip:{x:box.x,y:formStart.y-4,width:box.width,height:box.y+box.height-formStart.y+4},animations:'disabled'});await dialog.getByRole('button',{name:'Record call and mark done',exact:true}).click();await expect(dialog).toHaveCount(0);
 await page.reload();await expect(work(page).getByRole('button',{name:'Done',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(work(page).getByRole('checkbox',{name:'Added',exact:true})).toBeChecked();
 const events=await (await page.request.get('/api/assignments/1/attempts')).json();expect(events.rows).toHaveLength(2);expect(events.rows[0].disposition).toBe('connected');
});

test('choosing RNR clears hidden conversation values and keeps the previous result',async({employeePage:page})=>{
 await page.goto('/dashboard/my');const row=work(page);await row.getByLabel('Result of the call').selectOption('Available');await saved(row);
 await row.getByRole('button',{name:'Log manual call'}).click();const dialog=page.getByRole('dialog');
 await dialog.getByRole('combobox',{name:'Manual result',exact:true}).selectOption('Unavailable');await dialog.getByLabel('Reported duration').fill('40');await dialog.getByLabel('Also mark this task done').check();
 await dialog.getByLabel('What happened?').selectOption('no_answer');await expect(dialog).toContainText('saved Available result will stay unchanged');
 const sent=page.waitForRequest(r=>r.url().endsWith('/api/assignments/1/attempts')&&r.method()==='POST');
 await dialog.getByRole('button',{name:'Record call — keep open'}).click();const payload=(await sent).postDataJSON();expect(payload.outcome).toBeUndefined();expect(payload.completion).toBeUndefined();expect(payload.duration_seconds).toBeNull();
 await expect(dialog).toHaveCount(0);await page.reload();await expect(work(page).getByLabel('Result of the call')).toHaveValue('Available');await expect(work(page).getByRole('button',{name:'Mark done'})).toHaveAttribute('aria-pressed','false');
});

test('corrections have a separate clear action and preserve attempt counts',async({employeePage:page})=>{
 await page.goto('/dashboard/my');const row=work(page);await row.getByRole('button',{name:'Log manual call'}).click();let dialog=page.getByRole('dialog');
 await dialog.getByLabel('What happened?').selectOption('no_answer');await dialog.getByRole('button',{name:'Record call — keep open'}).click();await expect(dialog).toHaveCount(0);
 await row.getByRole('button',{name:'Mark done'}).click();dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Correct an earlier call'}).click();
 await expect(dialog).toHaveAccessibleName('Correct a logged call');await expect(dialog).toContainText('will not count as another attempt');
 await dialog.getByLabel('Call to correct').selectOption({index:1});await dialog.getByLabel('What happened?').selectOption('connected');await dialog.getByRole('combobox',{name:'Manual result',exact:true}).selectOption('Unavailable');
 await dialog.getByLabel('Why is this correction needed?').fill('The owner answered; no answer was selected by mistake');await screenshot(dialog,'operations-correction');
 await dialog.getByRole('button',{name:'Save correction',exact:true}).click();await expect(dialog).toHaveCount(0);
 await row.getByRole('button',{name:'Mark done'}).click();await saved(row);await page.reload();await expect(work(page).getByRole('button',{name:'Done',exact:true})).toHaveAttribute('aria-pressed','true');
 const events=await (await page.request.get('/api/assignments/1/attempts')).json();expect(events.rows).toHaveLength(1);expect(events.rows[0].corrects_id).toBeTruthy();
});

test('Available completion asks for WH ID and retains inputs after a rejected save',async({employeePage:page})=>{
 await page.goto('/dashboard/my');await work(page).getByRole('button',{name:'Log manual call'}).click();const dialog=page.getByRole('dialog');
 await dialog.getByRole('combobox',{name:'Manual result',exact:true}).selectOption('Available');await dialog.getByLabel('Also mark this task done').check();
 await expect(dialog.getByLabel('Warehouse ID')).toBeVisible();await dialog.getByRole('button',{name:'Record call and mark done',exact:true}).click();await expect(dialog.getByLabel('Warehouse ID')).toBeFocused();
 expect((await (await page.request.get('/api/assignments/1/attempts')).json()).rows).toHaveLength(0);
 await dialog.getByLabel('Warehouse ID').fill('123');await dialog.getByLabel('Call notes (optional)').fill('Owner confirmed the warehouse is available');
 let fail=true;await page.route('**/api/assignments/1/attempts',route=>{if(route.request().method()==='POST'&&fail){fail=false;return route.fulfill({status:422,json:{error:'Check the warehouse reference',field:'wh_id'}});}return route.continue();});
 await dialog.getByRole('button',{name:'Record call and mark done',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('Check the warehouse reference');await expect(dialog.getByLabel('Warehouse ID')).toBeFocused();await expect(dialog.getByLabel('Call notes (optional)')).toHaveValue('Owner confirmed the warehouse is available');
 await dialog.getByRole('button',{name:'Record call and mark done',exact:true}).click();await expect(dialog).toHaveCount(0);await page.reload();await expect(work(page).getByRole('button',{name:'Done',exact:true})).toHaveAttribute('aria-pressed','true');
});

test('Unclear and invalid-number completions ask for appropriate explanations',async({employeePage:page})=>{
 await page.goto('/dashboard/my');await work(page).getByRole('button',{name:'Log manual call'}).click();const dialog=page.getByRole('dialog');
 await dialog.getByRole('combobox',{name:'Manual result',exact:true}).selectOption('Unclear');await dialog.getByLabel('Also mark this task done').check();
 await expect(dialog.getByLabel('Why can this Unclear task be closed?')).toBeVisible();await expect(dialog.getByLabel('Completion explanation')).toBeVisible();
 await dialog.getByLabel('What happened?').selectOption('invalid_number');await expect(dialog.getByRole('combobox',{name:'Manual result',exact:true})).toHaveCount(0);await expect(dialog.getByLabel('Why can this Unclear task be closed?')).toHaveCount(0);
 await dialog.getByLabel('How did you verify the invalid number?').fill('The operator confirms this number has not been allocated');await dialog.getByRole('button',{name:'Record call and mark done',exact:true}).click();await expect(dialog).toHaveCount(0);await page.reload();await expect(work(page).getByRole('button',{name:'Done',exact:true})).toHaveAttribute('aria-pressed','true');
});

test('closing an edited call asks before discarding and keeps the draft on request',async({employeePage:page})=>{
 await page.goto('/dashboard/my');await work(page).getByRole('button',{name:'Log manual call'}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('Call notes (optional)').fill('Please retain these unsaved notes');
 await page.keyboard.press('Escape');await expect(dialog).toContainText('Your call has not been saved');await dialog.getByRole('button',{name:'Keep editing'}).click();await expect(dialog.getByLabel('Call notes (optional)')).toHaveValue('Please retain these unsaved notes');
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await dialog.getByRole('button',{name:'Discard call',exact:true}).click();await expect(dialog).toHaveCount(0);
 expect((await (await page.request.get('/api/assignments/1/attempts')).json()).rows).toHaveLength(0);
});

test('assignment preview uses readable actions for duplicate and missing-phone records',async({adminPage:page})=>{
 await page.goto('/dashboard/raw');await page.getByRole('button',{name:'Assign',exact:true}).click();const dialog=page.getByRole('dialog');
 await expect(dialog.getByRole('region',{name:'Assignment preview'})).toContainText('Already owned');await expect(dialog.getByRole('region',{name:'Assignment preview'})).toContainText('No usable phone');
 await expect(dialog).not.toContainText('missing_phone');await expect(dialog).not.toContainText('Completed episodes');
 await page.setViewportSize({width:1200,height:1300});const box=(await dialog.boundingBox())!,end=(await dialog.getByRole('region',{name:'Assignment preview'}).locator('p').nth(1).boundingBox())!;await page.screenshot({path:join(process.cwd(),'shots','operations-assignment.png'),clip:{x:box.x,y:box.y,width:box.width,height:end.y+end.height-box.y+8},animations:'disabled'});
});

test('ownership filters describe completed exclusions in the control and applied chips',async({adminPage:page})=>{
 for(const path of ['raw','calls']){
  await page.goto(`/dashboard/${path}?assignment_state=unassigned`);await expect(page.locator('.applied-filters')).toContainText('Unassigned — excludes completed');
  await page.getByRole('button',{name:'Toggle filters',exact:true}).click();await expect(page.getByLabel('Ownership').locator('option:checked')).toHaveText('Unassigned — excludes completed');
  await page.goto(`/dashboard/${path}?assignment_state=done`);await expect(page.locator('.applied-filters')).toContainText('Completed history');
 }
});

test('a saved call locks its old row until the new revision arrives, then immediate edits save',async({employeePage:page})=>{
 await page.goto('/dashboard/my');const row=work(page);let release!:()=>void,started!:()=>void;
 const gate=new Promise<void>(resolve=>release=resolve),arrived=new Promise<void>(resolve=>started=resolve);
 await page.route('**/dashboard/my?*',async route=>{
  if(route.request().headers()['rsc']==='1'&&!new URL(route.request().url()).searchParams.has('view')){started();await gate;}
  await route.continue();
 });
 await row.getByRole('button',{name:'Log manual call'}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('What happened?').selectOption('no_answer');await dialog.getByRole('button',{name:'Record call — keep open'}).click();await expect(dialog).toHaveCount(0);
 try{await arrived;await expect(row.getByLabel('Result of the call')).toBeDisabled();await expect(row).toContainText('Call saved. Waiting for the updated task');}finally{release();}
 await expect(row.getByLabel('Result of the call')).toBeEnabled();await row.getByLabel('Result of the call').selectOption('Available');await saved(row);
 await page.reload();await expect(work(page).getByLabel('Result of the call')).toHaveValue('Available');
});
