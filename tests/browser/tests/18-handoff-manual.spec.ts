import { test,logConnected,expect } from './fixtures';
const raw='a0000000-0000-4000-8000-000000000001';
const work=(page:any)=>page.locator('[data-entity="record"] tbody tr').filter({hasText:'Raghav Sharma'});
const patch=async(page:any,action:()=>Promise<void>,status=200)=>{
  const [res]=await Promise.all([page.waitForResponse((r:any)=>r.url().includes('/api/assignments/')&&r.request().method()==='PATCH'),action()]);expect(res.status()).toBe(status);
};

test('Done assignments expose reopen and Calls separates AI from manual results',async({adminPage:page})=>{
  await page.goto('/dashboard/assignments?state=done');const row=page.locator('table.sheet tbody tr').filter({hasText:'Meera Nair'});
  await expect(page.locator('th[data-column="AI result"]')).toBeVisible();
  await expect(page.locator('th[data-column="Manual result"]')).toBeVisible();
  await row.getByRole('button',{name:'Details for record'}).click();
  await page.getByRole('tab',{name:'Manual activity',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Verification history');
  await page.getByRole('button',{name:'Close details',exact:true}).click();
  await row.getByRole('button',{name:'Reopen',exact:true}).click();await expect(page.locator('table.sheet tbody')).toContainText('No assignments match');
  await page.goto('/dashboard/calls');
  await expect(page.locator('th[data-column="AI result"]')).toBeVisible();
  await expect(page.locator('th[data-column="Manual result"]')).toBeVisible();
  await expect(page.locator('th[data-column="Legacy Called By"]')).toBeHidden();
  const review=page.getByRole('link',{name:'Needs AI review: 1',exact:true});await expect(review).toBeVisible();
  await page.locator('.report-guide > summary').click();
  await expect(page.locator('.report-guide')).toContainText('low-confidence inference');
  await review.click();await expect(page).toHaveURL(/needs_review=1/);
  await expect(page.locator('table.sheet tbody tr')).toHaveCount(1);await expect(page.locator('table.sheet tbody')).toContainText('Suresh Kumar');
});
