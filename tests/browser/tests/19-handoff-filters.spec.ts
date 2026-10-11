import {test,expect,bodyOverflowsX} from './fixtures';
import {execFileSync} from 'node:child_process';
import {CONTAINER} from '../lib/env.mjs';
const sql=(text:string)=>execFileSync('podman',['exec','-i',CONTAINER,'psql','-U','postgres','-v','ON_ERROR_STOP=1','-q'],{input:text});
const choices=async(page:any,label:string,values:string[])=>{
 const menu=page.locator('details.filter-multi').filter({has:page.locator('summary').filter({hasText:new RegExp(`^${label}( \\(|$)`)})});
 await menu.locator('summary').click();for(const value of values)await menu.getByRole('checkbox',{name:value,exact:true}).check();await menu.locator('summary').click();
};
test('repeated Last Result filters, chips, saved view, exports, queue and preview keep both values',async({adminPage:page})=>{
 await page.goto('/dashboard/raw');await page.getByRole('button',{name:'Toggle filters',exact:true}).click();
 await choices(page,'Last result',['Unavailable','Unclear']);await page.getByRole('button',{name:'Apply',exact:true}).click();
 await expect(page).toHaveURL(/last_result=/);expect(new URL(page.url()).searchParams.getAll('last_result')).toEqual(['Unavailable','Unclear']);
 await expect(page.locator('table.sheet tbody').first().locator('tr')).toHaveCount(5);
 await page.locator('details.views-menu summary').click();await page.getByRole('button',{name:'Save current filters…'}).click();await page.getByLabel('View name').fill('Two results');await page.getByRole('button',{name:'Save view',exact:true}).click();
 await page.getByRole('button',{name:'Remove Last result filter: Unavailable',exact:true}).click();await expect(page).toHaveURL(/last_result=Unclear/);await expect(page.locator('.dashboard-content')).toHaveAttribute('aria-busy','false');
 await page.locator('details.views-menu summary').click();await page.getByRole('button',{name:'Two results',exact:true}).click();await expect(page.locator('table.sheet tbody').first().locator('tr')).toHaveCount(5);
 expect(new URL(page.url()).searchParams.getAll('last_result')).toHaveLength(2);
 const csv=await page.request.get('/api/raw/export?last_result=Unavailable&last_result=Unclear');expect(csv.status()).toBe(200);expect((await csv.text()).trim().split('\n')).toHaveLength(6);
 const queue=await (await page.request.get('/api/raw/queue?last_result=Unavailable&last_result=Unclear')).json();expect(queue.total).toBe(5);
 const preview=await page.request.post('/api/assignments/preview',{data:{entity_type:'record',assignee:'priya@eval.test',filters:{last_result:['Unavailable','Unclear']}}});expect(preview.status()).toBe(200);expect((await preview.json()).requested).toBe(5);
 await page.getByRole('button',{name:'Export CSV',exact:true}).click();const request=page.waitForRequest(r=>r.url().includes('/api/raw/export')&&r.method()==='POST');await page.getByRole('button',{name:'Download CSV'}).click();expect((await request).postDataJSON().filters.last_result).toEqual(['Unavailable','Unclear']);
});
test('source city stays visible; grouped columns can be shown, hidden, persisted and reset',async({adminPage:page,shot})=>{
 await page.goto('/dashboard/calls');await expect(page.locator('th[data-column="Source city"]')).toBeVisible();
 await expect(page.locator('th[data-column="Notes"]')).toBeHidden();await page.locator('details.column-menu:not(.views-menu) summary').click();
 const options=page.locator('details.column-menu:not(.views-menu)');await expect(options.getByRole('checkbox',{name:'Notes',exact:true})).not.toBeChecked();
 await options.getByRole('checkbox',{name:'Notes',exact:true}).check();await expect(page.locator('th[data-column="Notes"]')).toBeVisible();
 await options.getByRole('checkbox',{name:'Transcript',exact:true}).uncheck();await expect(page.locator('th[data-column="Transcript"]')).toBeHidden();
 await page.reload();await expect(page.locator('th[data-column="Notes"]')).toBeVisible();await expect(page.locator('th[data-column="Transcript"]')).toBeHidden();
 await page.locator('details.column-menu:not(.views-menu) summary').click();await page.getByRole('button',{name:'Reset columns'}).click();await expect(page.locator('th[data-column="Notes"]')).toBeHidden();
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Toggle filters',exact:true}).click();await choices(page,'Contact',['Owner','Probable broker']);expect(await bodyOverflowsX(page)).toBe(false);await shot(page,'handoff-d-filters-mobile');
});
test('page jump rejects invalid bounds and preserves repeated filters across reload and next',async({adminPage:page})=>{
 sql("insert into raw_records(source,source_record_id,owner_name) select case when i%2=0 then 'alpha' else 'beta' end,'page-'||i,'Page test '||i from generate_series(1,130) i");
 await page.goto('/dashboard/raw?source=alpha&source=beta');
 for(const invalid of ['0','-1','1.5','99999','abc']){await page.getByLabel('Go to page',{exact:true}).fill(invalid);await page.getByRole('button',{name:'Go',exact:true}).click();await expect(page.locator('.page-jump [role=alert]')).toContainText('whole page number');}
 await page.getByLabel('Go to page',{exact:true}).fill('2');await page.getByRole('button',{name:'Go',exact:true}).click();await expect(page).toHaveURL(/page=2/);expect(new URL(page.url()).searchParams.getAll('source')).toEqual(['alpha','beta']);await expect(page.getByLabel('Go to page',{exact:true})).toHaveValue('2');
 await page.getByRole('link',{name:'Next',exact:true}).click();await expect(page).toHaveURL(/page=3/);expect(new URL(page.url()).searchParams.getAll('source')).toHaveLength(2);
 await page.reload();await expect(page.getByLabel('Go to page',{exact:true})).toHaveValue('3');
});
test('Calls property filters and assignment multiple categories render correct rows',async({adminPage:page})=>{
 await page.goto('/dashboard/calls?city=Rajkot&area_basis=built_up&min_area=12000&max_area=12000&rent_mentioned=yes');await expect(page.locator('table.sheet tbody').first().locator('tr')).toHaveCount(1);await expect(page.locator('table.sheet tbody').first()).toContainText('Raghav Sharma');
 await page.goto('/dashboard/assignments?assignee=priya%40eval.test&assignee=raj%40eval.test&state=open&state=done');await expect(page.locator('table.sheet tbody').first().locator('tr')).toHaveCount(4);
 await page.getByLabel('Search assignments').fill('Meera');await page.getByRole('button',{name:'Apply',exact:true}).click();await expect(page).toHaveURL(/q=Meera/);expect(new URL(page.url()).searchParams.getAll('assignee')).toHaveLength(2);expect(new URL(page.url()).searchParams.getAll('state')).toHaveLength(2);
});
