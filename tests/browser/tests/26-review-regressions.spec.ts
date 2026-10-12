import {test,expect} from './fixtures';
import {execFileSync} from 'node:child_process';
import {CONTAINER} from '../lib/env.mjs';
const sql=(s:string)=>execFileSync('podman',['exec','-i',CONTAINER,'psql','-U','postgres','-q','-v','ON_ERROR_STOP=1'],{input:s});
test('old Result and RNR notes cannot close a task without a logged call',async({employeePage:page})=>{
 await page.goto('/dashboard/my');const row=page.locator('[data-entity="record"] tbody tr').filter({hasText:'Raghav'});
 await row.getByLabel('Result of the call').selectOption('Unavailable');await expect(row.locator('.save-status')).toHaveText('Saved');
 await row.getByLabel('Your notes').fill('RNR; call back later');await row.getByLabel('Your notes').blur();await expect(row.locator('.save-status')).toHaveText('Saved');
 await row.getByRole('button',{name:'Mark done'}).click();await expect(page.getByRole('dialog')).toContainText('No manual call has been logged yet');await expect(page.getByRole('dialog').getByLabel('What happened?')).toHaveValue('');await expect(row.getByRole('button',{name:'Mark done'})).toHaveAttribute('aria-pressed','false');
});
test('Calls onboarding writes the assignment and reconciles with the Onboarded filter',async({adminPage:page})=>{
 await page.goto('/dashboard/calls');const row=page.locator('tbody tr').filter({has:page.getByLabel('Manual follow-up notes').and(page.locator(':enabled'))});
 await row.getByLabel('Team warehouse ID').fill('123456');await row.getByLabel('Team warehouse ID').blur();await expect(page.locator('.sheet-save-status')).toHaveText('All changes saved');
 await row.getByLabel('Team marked warehouse added to database').check();await expect(page.locator('.sheet-save-status')).toHaveText('All changes saved');
 await page.goto('/dashboard/calls?onboarded=yes');await expect(page.locator('tbody tr')).toHaveCount(1);await expect(page.getByLabel('Team warehouse ID')).toHaveValue('123456');
 const csv=await page.request.get('/api/calls/export?onboarded=yes');expect(csv.status()).toBe(200);expect(await csv.text()).toContain('123456');
 expect((await page.request.patch('/api/calls/c0000000-0000-4000-8000-000000000001',{data:{called_by:'bypass',revision:0}})).status()).toBe(409);
});
test('saved column preferences migrate Called By to hidden, labelled and read-only',async({adminPage:page})=>{
 await page.addInitScript(()=>{localStorage.setItem('sheet-hidden:/dashboard/calls','[]');localStorage.removeItem('sheet-legacy-columns-v1');});
 await page.goto('/dashboard/calls');await expect(page.locator('th[data-column="Legacy Called By"]')).toBeHidden();
 await page.locator('.column-menu:not(.views-menu) summary').click();await page.getByRole('checkbox',{name:'Legacy Called By',exact:true}).check();
 await expect(page.locator('th[data-column="Legacy Called By"]')).toBeVisible();await expect(page.getByLabel('Team called by')).toHaveCount(0);
});
test('Bolna preview shows alternate-number human ownership before any send',async({adminPage:page})=>{
 sql("insert into raw_phones(master_id,phone_id,is_primary) select 'a0000000-0000-4000-8000-000000000005',phone_id,false from raw_phone_numbers where phone_last10='9811100001'");
 await page.goto('/dashboard/raw');await page.locator('tbody tr').filter({hasText:'Latha Menon'}).locator('.rowsel').check();await page.getByRole('button',{name:/Queue for calling/}).click();
 const dialog=page.getByRole('dialog');await expect(dialog.getByLabel('Calling ownership preview')).toContainText('1 contacts held');await expect(dialog.getByLabel('Calling ownership preview')).toContainText('Priya Eval');await expect(dialog.getByRole('button',{name:/Send to Bolna/})).toBeDisabled();
});
test('Bangalore matches Bengaluru and the five-metric Team view discloses unknown history',async({adminPage:page})=>{
 await page.goto('/dashboard/raw?city=Bangalore');await expect(page.locator('tbody tr')).toHaveCount(1);await expect(page.locator('tbody')).toContainText('Anil Broker');
 await page.goto('/dashboard/team');await expect(page.getByLabel('Team metrics table').locator('th')).toHaveCount(6);await expect(page.getByText('Historical call counts are unknown',{exact:false})).toBeVisible();await expect(page.getByLabel('Metric evidence table')).toHaveCount(0);
});
