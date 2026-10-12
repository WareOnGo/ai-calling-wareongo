import {test,expect,bodyOverflowsX} from './fixtures';
import {execFileSync} from 'node:child_process';
import {CONTAINER} from '../lib/env.mjs';
import {unreadableText} from '../lib/visual-audit';
const batch='d0000000-0000-4000-8000-000000000001';
const sql=(input:string)=>execFileSync('podman',['exec','-i',CONTAINER,'psql','-U','postgres','-q','-v','ON_ERROR_STOP=1'],{input,stdio:['pipe','ignore','pipe']});
function seedBatch(){sql(`insert into call_batches(id,state,bolna_batch_id,agent_language,created_by,scheduled_at,updated_at) values('${batch}','scheduled','tidy-provider','hindi','admin@eval.test',now()-interval '1 day',now()-interval '5 minutes');
 insert into call_batch_items(batch_id,record_id,name,contact_number,area) values('${batch}','a0000000-0000-4000-8000-000000000001','Raghav Sharma','+919811100001','Rajkot');
 update bolna_call_logs set batch_id='tidy-provider' where id='c0000000-0000-4000-8000-000000000001';`);}
for(const width of [1366,390])for(const theme of ['light','dark']){
 test(`centered pagination and grouped toolbar at ${width}px in ${theme}`,async({adminPage:page,shot})=>{
  await page.setViewportSize({width,height:width===390?844:768});await page.addInitScript(theme=>localStorage.setItem('theme',theme),theme);
  sql("insert into raw_records(source,source_record_id,owner_name) select case when i%2=0 then 'alpha' else 'beta' end,'footer-'||i,'Footer contact '||i from generate_series(1,130) i");
  await page.goto('/dashboard/raw?source=alpha&source=beta');
  const footer=page.locator('.records-pagination'),nav=footer.getByRole('navigation');
  const bounds=await nav.boundingBox();expect(Math.abs(bounds!.x+bounds!.width/2-width/2)).toBeLessThanOrEqual(2);
  await expect(nav.getByRole('button',{name:'Previous',exact:true})).toBeDisabled();
  await nav.getByRole('link',{name:'Next',exact:true}).click();await expect(page).toHaveURL(/page=2/);
  expect(new URL(page.url()).searchParams.getAll('source')).toEqual(['alpha','beta']);
  await expect(nav.getByLabel('Go to page',{exact:true})).toHaveValue('2');
  await nav.getByLabel('Go to page',{exact:true}).fill('999');await nav.getByRole('button',{name:'Go',exact:true}).click();
  await expect(nav.getByRole('alert')).toContainText('whole page number');
  await nav.getByLabel('Go to page',{exact:true}).fill('3');await nav.getByLabel('Go to page',{exact:true}).press('Enter');
  await expect(page).toHaveURL(/page=3/);await expect(nav.getByRole('button',{name:'Next',exact:true})).toBeDisabled();
  await nav.getByRole('link',{name:'Previous',exact:true}).click();await expect(page).toHaveURL(/page=2/);
  expect(await bodyOverflowsX(page)).toBe(false);expect(await unreadableText(page)).toEqual([]);
  await page.locator('.account-menu > summary').click();await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeVisible();
  const account=await page.locator('.account-panel').boundingBox();expect(account!.x).toBeGreaterThanOrEqual(0);expect(account!.x+account!.width).toBeLessThanOrEqual(width);
  await page.keyboard.press('Escape');await expect(page.locator('.account-menu > summary')).toBeFocused();
  await shot(page,`footer-header-${width}-${theme}`);
 });
 test(`batch cards and grouped contact details at ${width}px in ${theme}`,async({adminPage:page,shot})=>{
  seedBatch();await page.setViewportSize({width,height:width===390?844:768});await page.addInitScript(theme=>localStorage.setItem('theme',theme),theme);
  await page.goto('/dashboard/batches');const card=page.locator('.batch-card').first();
  await expect(card).toContainText('1 of 1 contacts have results');await expect(card.locator('.batch-status')).toHaveText('Awaiting confirmation');
  await expect(card.getByRole('progressbar')).toHaveAttribute('value','1');
  expect(await unreadableText(page)).toEqual([]);expect(await bodyOverflowsX(page)).toBe(false);await shot(page,`batch-cards-tidy-${width}-${theme}`);
  await card.getByRole('link',{name:/^AI batch/}).click();await expect(page.locator('.batch-metric-group')).toHaveCount(3);
  await expect(page.locator('.batch-grid')).toContainText('Raghav Sharma');await expect(page.locator('.batch-grid')).toContainText('Rajkot');
  await page.getByText('Batch information',{exact:true}).click();await expect(page.getByText('tidy-provider',{exact:true})).toBeVisible();
  await page.getByText('Batch information',{exact:true}).click();
  expect(await unreadableText(page)).toEqual([]);expect(await bodyOverflowsX(page)).toBe(false);await shot(page,`batch-detail-tidy-${width}-${theme}`);
  await page.locator('.batch-grid').scrollIntoViewIfNeeded();await shot(page,`batch-members-tidy-${width}-${theme}`);
 });
}
test('live completion refreshes the status and removes resolution controls',async({adminPage:page})=>{
 seedBatch();let checked=0;
 await page.route('**/api/batches/sync',async route=>{expect(route.request().postDataJSON().ids).toEqual([batch]);checked++;sql(`update call_batches set state='completed',completed_at=now() where id='${batch}'`);await route.fulfill({json:{checked:1,completed:1,failed:0}});});
 await page.goto('/dashboard/batches/ai/'+batch);
 await expect(page.locator('.batch-status')).toHaveText('Completed',{timeout:10000});expect(checked).toBe(1);
 await expect(page.getByRole('button',{name:'Resolve batch',exact:true})).toHaveCount(0);
});
test('live updates preserve unsaved batch filter changes',async({adminPage:page})=>{
 seedBatch();let checked=0;await page.route('**/api/batches/sync',route=>{checked++;return route.fulfill({json:{checked:0,completed:0,failed:0}});});
 await page.clock.install();await page.goto('/dashboard/batches');
 await page.getByRole('combobox',{name:'Created by',exact:true}).selectOption('admin@eval.test');await page.getByText('More filters',{exact:true}).click();
 await page.clock.fastForward(35000);expect(checked).toBe(0);await expect(page.getByRole('combobox',{name:'Created by',exact:true})).toHaveValue('admin@eval.test');
});
