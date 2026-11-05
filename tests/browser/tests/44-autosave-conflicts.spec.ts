import { test, expect, bodyOverflowsX } from './fixtures';
import type { Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { CONTAINER } from '../lib/env.mjs';

const url = '/api/my-work/assignments/1';
const work = (page: Page) => page.locator('[data-entity="record"] tbody tr').filter({hasText:'Raghav Sharma'});
const sql = (statement: string) => execFileSync('podman',['exec','-i',CONTAINER,'psql','-U','postgres','-v','ON_ERROR_STOP=1','-q','-c',statement]);
const latest = async (page: Page) => (await page.request.get(url)).json();
async function elsewhere(page: Page, patch: object, revision = 0, target = url) {
  expect((await page.request.patch(target,{data:{revision,...patch}})).status()).toBe(200);
}
async function notes(page: Page, value: string, status = 409) {
  await work(page).getByLabel('Your notes').fill(value);
  const response = page.waitForResponse(r => r.url().endsWith(url) && r.request().method()==='PATCH');
  await work(page).getByLabel('Your notes').blur();
  expect((await response).status()).toBe(status);
}
async function review(page: Page) {
  await work(page).getByRole('button',{name:'Review changes',exact:true}).click();
  const dialog = page.getByRole('dialog',{name:'Review unsaved changes'});
  await expect(dialog.getByRole('button',{name:'Save my changes',exact:true})).toBeVisible();
  return dialog;
}

test('warehouse sync conflicts recover automatically without a review decision', async ({employeePage:page}) => {
  await page.goto('/dashboard/my');
  // Same version change made by the warehouse sync, with no second user edit.
  sql("update bolna_assignments set wh_id='3271',revision=revision+1 where id=1");
  await notes(page,'waiting for pic');
  await expect(work(page).locator('.save-status')).toHaveText('Saved');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.sheet-save-status')).toHaveText('All changes saved');
  expect(await latest(page)).toMatchObject({revision:2,remarks:'waiting for pic',wh_id:'3271'});
  await expect(work(page).getByLabel('Warehouse ID')).toHaveValue('3271');
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(page.locator('.sheet-save-status')).toHaveText('All changes saved');
  await notes(page,'Next edit',200);
  expect(await latest(page)).toMatchObject({revision:3,remarks:'Next edit',wh_id:'3271'});
});

test('same-field conflict can keep latest, clear recovered storage and continue editing', async ({employeePage:page}) => {
  await page.goto('/dashboard/my');
  await elsewhere(page,{remarks:'Saved by another tab'});
  await notes(page,'My unsaved note');
  const dialog=await review(page);
  await expect(dialog).toContainText('Raghav Sharma');
  await expect(dialog).toContainText('9811100001');
  await expect(dialog).toContainText('Saved by another tab');
  await expect(dialog).toContainText('My unsaved note');
  await dialog.getByRole('button',{name:'Discard row edits',exact:true}).click();
  await expect(work(page).getByLabel('Your notes')).toHaveValue('Saved by another tab');
  expect(await latest(page)).toMatchObject({revision:1,remarks:'Saved by another tab'});
  expect(await page.evaluate(()=>sessionStorage.getItem('dashboard-views:priya@eval.test:draft:assignment-1'))).toBeNull();
  await notes(page,'Reviewed correction',200);
  expect(await latest(page)).toMatchObject({revision:2,remarks:'Reviewed correction'});
});

for (const field of ['added_to_db','state'] as const) test(`safe recovery preserves ${field} intent without a review decision`, async ({employeePage:page}) => {
  await page.goto('/dashboard/my');
  await elsewhere(page,{wh_id:'3271'});
  if (field==='added_to_db') await work(page).locator('.checkfield input').check();
  else await work(page).getByRole('button',{name:'Mark done',exact:true}).click();
  await expect(work(page).locator('.save-status')).toHaveText('Saved');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await latest(page)).toMatchObject({revision:2,wh_id:'3271',[field]:field==='added_to_db'?true:'done'});
});

test('a second edit during review conflicts again and never overwrites unseen data', async ({employeePage:page}) => {
  await page.goto('/dashboard/my');
  await elsewhere(page,{remarks:'First external edit'});
  await notes(page,'My draft');
  let dialog=await review(page);
  await elsewhere(page,{remarks:'Second external edit'},1);
  await dialog.getByRole('button',{name:'Save my changes',exact:true}).click();
  await expect(work(page).getByRole('button',{name:'Review changes',exact:true})).toBeVisible();
  expect(await latest(page)).toMatchObject({revision:2,remarks:'Second external edit'});
  dialog=await review(page);
  await expect(dialog).toContainText('Second external edit');
  await expect(dialog).toContainText('My draft');
  await dialog.getByRole('button',{name:'Save my changes',exact:true}).click();
  await expect(work(page).locator('.save-status')).toHaveText('Saved');
  expect(await latest(page)).toMatchObject({revision:3,remarks:'My draft'});
});

test('lost success response is recovered without an extra write or duplicate intent', async ({employeePage:page}) => {
  await page.goto('/dashboard/my');
  let lose=true;
  await page.route(`**${url}`,async route=>{
    if (lose && route.request().method()==='PATCH') { lose=false; await route.fetch(); await route.abort('failed'); }
    else await route.continue();
  });
  await work(page).getByLabel('Your notes').fill('Already saved');
  await work(page).getByLabel('Your notes').blur();
  await expect(work(page).getByRole('button',{name:'Retry',exact:true})).toBeVisible();
  expect(await latest(page)).toMatchObject({revision:1,remarks:'Already saved'});
  await work(page).getByRole('button',{name:'Retry',exact:true}).click();
  await expect(work(page).locator('.save-status')).toHaveText('Saved');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await latest(page)).toMatchObject({revision:1,remarks:'Already saved'});
});

for (const status of [500,401]) test(`failed review load (${status}) preserves draft and retries safely`, async ({employeePage:page}) => {
  await page.goto('/dashboard/my');
  await elsewhere(page,{remarks:'Latest'});
  await notes(page,'Keep this draft');
  let fail=true;
  await page.route(`**${url}`,route=>fail && route.request().method()==='GET' ? route.fulfill({status,json:{error:'Unavailable'}}) : route.continue());
  await work(page).getByRole('button',{name:'Review changes',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog.getByRole('alert')).toContainText(status===401?'sign-in expired':"Couldn't load");
  await expect(dialog.getByRole('button',{name:'Save my changes',exact:true})).toHaveCount(0);
  await expect(work(page).getByLabel('Your notes')).toHaveValue('Keep this draft');
  fail=false;
  await dialog.getByRole('button',{name:'Retry loading',exact:true}).click();
  await dialog.getByRole('button',{name:'Save my changes',exact:true}).click();
  await expect(work(page).locator('.save-status')).toHaveText('Saved');
});

for (const change of ['dropped','reassigned','deleted']) test(`${change} assignment retains a copyable draft but cannot save`, async ({employeePage:page,adminPage}) => {
  await page.goto('/dashboard/my');
  if (change==='reassigned') {
    expect((await adminPage.request.post('/api/assignments',{data:{entity_type:'record',ids:['a0000000-0000-4000-8000-000000000001'],assignee:'raj@eval.test',reassign:true}})).status()).toBe(200);
    sql("update bolna_assignments set remarks='Private new owner note',revision=revision+1 where assignee='raj@eval.test'");
  } else if (change==='deleted') {
    // Simulate a fixture/data reset while the employee still has the old page.
    sql('set client_min_messages=warning; truncate bolna_assignments cascade');
  } else expect((await adminPage.request.delete('/api/assignments/1')).status()).toBe(200);
  await notes(page,'Copy before discarding');
  await work(page).getByRole('button',{name:'Review changes',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog).toContainText('no longer available');
  await expect(dialog).toContainText('Copy before discarding');
  await expect(dialog).not.toContainText('Private new owner note');
  await expect(dialog.getByRole('button',{name:'Save my changes',exact:true})).toHaveCount(0);
  await dialog.getByRole('button',{name:'Discard row edits',exact:true}).click();
  await expect(work(page)).toHaveCount(0);
  await expect(page.locator('.sheet-save-status')).toHaveText(/All changes saved|Edits save automatically/);
});

test('dismissing review and reloading preserves the draft and its conflict protection', async ({employeePage:page}) => {
  await page.goto('/dashboard/my');
  await elsewhere(page,{remarks:'External edit'});
  await notes(page,'Draft survives reload');
  await review(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(work(page).getByRole('button',{name:'Review changes',exact:true})).toBeFocused();
  page.on('dialog',dialog=>dialog.accept());
  await page.reload();
  await expect(work(page).getByLabel('Your notes')).toHaveValue('Draft survives reload');
  expect(await latest(page)).toMatchObject({revision:1,remarks:'External edit'});
  await page.locator('.sheet-save-status').getByRole('button',{name:'Save changes',exact:true}).click();
  const dialog=await review(page);
  await dialog.getByRole('button',{name:'Save my changes',exact:true}).click();
  await expect(work(page).locator('.save-status')).toHaveText('Saved');
});

test('old drafts without a version can be explicitly reviewed and saved', async ({employeePage:page}) => {
  await page.addInitScript(()=>sessionStorage.setItem('dashboard-views:priya@eval.test:draft:assignment-1',JSON.stringify({remarks:'Legacy draft'})));
  await page.goto('/dashboard/my');
  await expect(work(page).getByLabel('Your notes')).toHaveValue('Legacy draft');
  await page.locator('.sheet-save-status').getByRole('button',{name:'Save changes',exact:true}).click();
  const dialog=await review(page);
  await dialog.getByRole('button',{name:'Save my changes',exact:true}).click();
  await expect(work(page).locator('.save-status')).toHaveText('Saved');
  expect(await latest(page)).toMatchObject({revision:1,remarks:'Legacy draft'});
});

test('global review opens one row at a time and preserves other rows drafts', async ({employeePage:page}) => {
  await page.goto('/dashboard/my');
  await elsewhere(page,{remarks:'Latest record'});
  await elsewhere(page,{remarks:'Latest call'},0,'/api/my-work/assignments/5');
  await notes(page,'Record draft');
  const call=page.locator('[data-entity="call"] tbody tr').first();
  await call.getByLabel('Your notes').fill('Call draft'); await call.getByLabel('Your notes').blur();
  await expect(page.locator('.sheet-save-status')).toContainText("2 rows haven't saved");
  await page.locator('.sheet-save-status').getByRole('button',{name:'Review changes',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.getByRole('dialog').getByRole('button',{name:'Save my changes',exact:true}).click();
  await expect(work(page).locator('.save-status')).toHaveText('Saved');
  await expect(call.getByLabel('Your notes')).toHaveValue('Call draft');
  expect(await (await page.request.get('/api/my-work/assignments/5')).json()).toMatchObject({revision:1,remarks:'Latest call'});
  await page.locator('.sheet-save-status').getByRole('button',{name:'Review changes',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.getByRole('dialog').getByRole('button',{name:'Discard row edits',exact:true}).click();
  await expect(page.locator('.sheet-save-status')).toHaveText('All changes saved');
  await expect(call.getByLabel('Your notes')).toHaveValue('Latest call');
});

test('a network failure after review retains the new version and can be retried', async ({employeePage:page}) => {
  await page.goto('/dashboard/my');
  await elsewhere(page,{remarks:'External edit'});
  await notes(page,'My draft');
  const dialog=await review(page);
  let fail=true;
  await page.route(`**${url}`,route=>fail && route.request().method()==='PATCH' ? route.fulfill({status:500,json:{error:'Temporary failure'}}) : route.continue());
  await dialog.getByRole('button',{name:'Save my changes',exact:true}).click();
  await expect(work(page).getByRole('button',{name:'Retry',exact:true})).toBeVisible();
  await expect(work(page).getByLabel('Your notes')).toHaveValue('My draft');
  fail=false;
  await work(page).getByRole('button',{name:'Retry',exact:true}).click();
  await expect(work(page).locator('.save-status')).toHaveText('Saved');
  expect(await latest(page)).toMatchObject({revision:2,remarks:'My draft'});
});

test('unavailable work stays read-only after discard while another row has an unsaved draft', async ({employeePage:page,adminPage,shot}) => {
  await page.goto('/dashboard/my');
  const other=page.locator('[data-entity="call"] tbody tr').first();
  let fail=true;
  await page.route('**/api/my-work/assignments/5',route=>fail && route.request().method()==='PATCH' ? route.fulfill({status:500,json:{error:'Temporary failure'}}) : route.continue());
  await other.getByLabel('Your notes').fill('Keep this other draft'); await other.getByLabel('Your notes').blur();
  await expect(other.locator('.save-status')).toContainText('Retry');
  expect((await adminPage.request.delete('/api/assignments/1')).status()).toBe(200);
  await notes(page,'Copy this unavailable draft');
  await expect(work(page).getByLabel('Your notes')).not.toBeEditable();
  await expect(work(page).getByRole('button',{name:'Mark done',exact:true})).toBeDisabled();
  await work(page).getByRole('button',{name:'Review changes',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Raghav Sharma');
  await page.getByRole('dialog').getByRole('button',{name:'Discard row edits',exact:true}).click();
  await expect(work(page)).toContainText('This assignment is no longer available.');
  await expect(work(page).getByLabel('Your notes')).not.toBeEditable();
  await expect(work(page).getByLabel('Warehouse ID')).not.toBeEditable();
  await expect(work(page).getByLabel('Result of the call')).toBeDisabled();
  await expect(work(page).locator('.checkfield input')).toBeDisabled();
  await expect(work(page).getByRole('button',{name:'Mark done',exact:true})).toBeDisabled();
  await expect(other.getByLabel('Your notes')).toHaveValue('Keep this other draft');
  await expect(page.locator('.notification-region')).not.toContainText('Finish saving');
  await shot(page,'autosave-unavailable-with-other-draft');
  fail=false; await other.getByRole('button',{name:'Retry',exact:true}).click();
  await expect(page.locator('.sheet-save-status')).toHaveText('All changes saved');
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(work(page)).toHaveCount(0);
});

test('mixed-field review identifies the contact and makes the row-wide discard explicit', async ({employeePage:page,shot}) => {
  await page.goto('/dashboard/my');
  await elsewhere(page,{remarks:'Wait until Monday'});
  await notes(page,'Call today');
  await expect(work(page).getByRole('button',{name:'Review changes',exact:true})).toBeVisible();
  await work(page).getByLabel('Warehouse ID').fill('3271'); await work(page).getByLabel('Warehouse ID').blur();
  const dialog=page.getByRole('dialog');
  await expect(dialog.getByRole('button',{name:'Save my changes',exact:true})).toBeVisible();
  await expect(dialog).toContainText('Raghav Sharma');
  await expect(dialog).toContainText('9811100001');
  await expect(dialog).toContainText('Call today');
  await expect(dialog).toContainText('3271');
  await expect(dialog).toContainText('Discards all unsaved edits in this row.');
  await shot(page,'autosave-mixed-field-review');
  await dialog.getByRole('button',{name:'Discard row edits',exact:true}).click();
  await expect(work(page).getByLabel('Warehouse ID')).toHaveValue('');
  await expect(work(page).getByLabel('Your notes')).toHaveValue('Wait until Monday');
  expect(await latest(page)).toMatchObject({revision:1,remarks:'Wait until Monday',wh_id:null});
});

test('changed task status requires review even when the notes themselves did not change', async ({employeePage:page}) => {
  await page.goto('/dashboard/my');
  await elsewhere(page,{state:'done'});
  await notes(page,'Notes from an old open task');
  const dialog=await review(page);
  expect(await latest(page)).toMatchObject({revision:1,remarks:null,state:'done'});
  await dialog.getByRole('button',{name:'Save my changes',exact:true}).click();
  await expect(work(page).locator('.save-status')).toHaveText('Saved');
  await expect(work(page).getByRole('button',{name:'Done',exact:true})).toBeVisible();
  expect(await latest(page)).toMatchObject({revision:2,remarks:'Notes from an old open task',state:'done'});
});

test('a conflicting edit made during the recovery read is kept for review', async ({employeePage:page}) => {
  await page.goto('/dashboard/my');
  await elsewhere(page,{wh_id:'3271'});
  let loading=false, patches=0, release!: () => void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route(`**${url}`,async route=>{
    if(route.request().method()==='PATCH') patches++;
    if(route.request().method()==='GET' && !loading) { loading=true; await gate; }
    await route.continue();
  });
  await notes(page,'First note');
  try {
    await expect.poll(()=>loading).toBe(true);
    await work(page).getByLabel('Warehouse ID').fill('5000'); await work(page).getByLabel('Warehouse ID').blur();
  } finally { release(); }
  const dialog=await review(page);
  expect(patches).toBe(1);
  expect(await latest(page)).toMatchObject({revision:1,remarks:null,wh_id:'3271'});
  await expect(dialog).toContainText('5000');
  await expect(dialog).toContainText('3271');
  await dialog.getByRole('button',{name:'Save my changes',exact:true}).click();
  await expect(work(page).locator('.save-status')).toHaveText('Saved');
  expect(await latest(page)).toMatchObject({revision:2,remarks:'First note',wh_id:'5000'});
});

for (const newer of ['Newer note','']) test(`editing during the automatic retry preserves ${newer ? 'new text' : 'an undo to the original value'} and stops further writes`, async ({employeePage:page}) => {
  await page.goto('/dashboard/my');
  await elsewhere(page,{wh_id:'3271'});
  let patches=0, release!: () => void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route(`**${url}`,async route=>{
    if(route.request().method()==='PATCH' && ++patches===2) await gate;
    await route.continue();
  });
  await notes(page,'First note');
  try {
    await expect.poll(()=>patches).toBe(2);
    await work(page).getByLabel('Your notes').fill(newer); await work(page).getByLabel('Your notes').blur();
  } finally { release(); }
  const dialog=await review(page);
  expect(patches).toBe(2);
  expect(await latest(page)).toMatchObject({revision:2,remarks:'First note',wh_id:'3271'});
  await expect(dialog).toContainText(newer || 'Empty');
  await dialog.getByRole('button',{name:'Save my changes',exact:true}).click();
  await expect(work(page).locator('.save-status')).toHaveText('Saved');
  expect(await latest(page)).toMatchObject({revision:3,remarks:newer || null,wh_id:'3271'});
});

test('automatic recovery retries only once when another writer wins the race', async ({employeePage:page}) => {
  await page.goto('/dashboard/my');
  await elsewhere(page,{wh_id:'3271'});
  let patches=0, reads=0;
  await page.route(`**${url}`,async route=>{
    if(route.request().method()==='GET') reads++;
    if(route.request().method()==='PATCH' && ++patches===2) await elsewhere(page,{remarks:'A newer external edit'},1);
    await route.continue();
  });
  await notes(page,'My note');
  await expect(work(page).getByRole('button',{name:'Review changes',exact:true})).toBeVisible();
  expect(patches).toBe(2); expect(reads).toBe(1);
  expect(await latest(page)).toMatchObject({revision:2,remarks:'A newer external edit'});
  const dialog=await review(page);
  await expect(dialog).toContainText('A newer external edit');
});

test('a recovered draft that is already saved clears without leaving a stale version behind', async ({employeePage:page}) => {
  await elsewhere(page,{remarks:'Already saved'});
  await page.addInitScript(()=>sessionStorage.setItem('dashboard-views:priya@eval.test:draft:assignment-1',JSON.stringify({values:{remarks:'Already saved'},revision:0})));
  await page.goto('/dashboard/my');
  await expect(work(page).getByLabel('Your notes')).toHaveValue('Already saved');
  await expect(page.locator('.sheet-save-status')).toHaveText('All changes saved');
  await notes(page,'Next edit',200);
  expect(await latest(page)).toMatchObject({revision:2,remarks:'Next edit'});
});

for (const width of [1600,390,320]) for (const theme of ['light','dark']) test(`conflict review fits ${width}px in ${theme}, with long notes and keyboard controls`, async ({employeePage:page,shot}) => {
  const height=width===320?568:900;
  await page.setViewportSize({width,height});
  await page.addInitScript(value=>localStorage.setItem('theme',value),theme);
  await page.goto('/dashboard/my');
  await elsewhere(page,{remarks:'Latest saved note\n'+'Long text '.repeat(45)});
  await notes(page,'My draft\n'+'तस्वीर का इंतज़ार 📷 '.repeat(35));
  const dialog=await review(page);
  const bounds=(await dialog.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x+bounds.width).toBeLessThanOrEqual(width+1);
  expect(bounds.y+bounds.height).toBeLessThanOrEqual(height+1);
  expect(await bodyOverflowsX(page)).toBe(false);
  await dialog.getByRole('button',{name:'Save my changes',exact:true}).focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button',{name:'Close',exact:true})).toBeFocused();
  await shot(page,`autosave-conflict-${width}-${theme}`);
  await dialog.getByRole('button',{name:'Keep draft',exact:true}).click();
  await expect(work(page).getByLabel('Your notes')).toHaveValue(/My draft/);
});
