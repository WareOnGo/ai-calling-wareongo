import {test,expect} from './fixtures';

// Next 15's bundled renderer intermittently suspended forever even after a
// complete RSC response arrived. Exercise several delayed transitions in one
// document, including returning to an earlier filter, on the production build.
test('filtered results finish repeated delayed transitions without reloading',async({adminPage:page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/dashboard/raw');
 await page.evaluate(()=>{(window as any).__navigationDocument='retained';});
 let release=()=>{};let gate=Promise.resolve();
 await page.route('**/dashboard/raw?**',async route=>{await gate;await route.continue();});
 for(const name of ['Meera','Anil','Meera','Raghav','Anil','Meera']){
  gate=new Promise<void>(resolve=>{release=resolve;});
  await page.getByRole('textbox',{name:'Search records'}).fill(name);
  await page.getByRole('button',{name:'Apply',exact:true}).click();
  try{await expect(page.locator('.navigation-progress')).toBeVisible();}
  finally{release();}
  await expect(page.locator('.dashboard-content')).toHaveAttribute('aria-busy','false');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('table.sheet:visible tbody')).toContainText(name);
  expect(await page.evaluate(()=>(window as any).__navigationDocument)).toBe('retained');
 }
 expect(errors).toEqual([]);
});
