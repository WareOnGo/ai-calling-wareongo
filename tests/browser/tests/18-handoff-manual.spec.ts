import { test,logConnected,expect } from './fixtures';
const raw='a0000000-0000-4000-8000-000000000001';
const work=(page:any)=>page.locator('[data-entity="record"] tbody tr').filter({hasText:'Raghav Sharma'});
const patch=async(page:any,action:()=>Promise<void>,status=200)=>{
  const [res]=await Promise.all([page.waitForResponse((r:any)=>r.url().includes('/api/assignments/')&&r.request().method()==='PATCH'),action()]);expect(res.status()).toBe(status);
};

test('Available requires a warehouse ID and an immediate done click saves the typed ID',async({employeePage:page,shot})=>{
  await page.goto('/dashboard/my');const row=work(page);
  await logConnected(page,row);
  await patch(page,()=>row.getByLabel('Result of the call').selectOption('Available'));
  await patch(page,()=>row.getByRole('button',{name:'Mark done'}).click(),422);
  await expect(row).toContainText('requires a positive integer Warehouse ID');
  await expect(row.getByLabel('Warehouse ID')).toBeFocused();
  await expect(row.getByRole('button',{name:'Mark done'})).toHaveAttribute('aria-pressed','false');
  await row.getByLabel('Warehouse ID').fill('1009');
  await row.getByRole('button',{name:'Mark done'}).click();
  await expect(row.getByRole('button',{name:'Done',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(row.locator('.save-status')).toContainText('Saved');
  await page.reload();await expect(work(page).getByLabel('Warehouse ID')).toHaveValue('1009');
  await expect(work(page)).toHaveClass(/row-done/);await shot(page,'handoff-c-completed');
});

test('Unclear needs a closure reason and substantive notes',async({employeePage:page})=>{
  await page.goto('/dashboard/my');const row=work(page);
  await logConnected(page,row);
  await patch(page,()=>row.getByLabel('Result of the call').selectOption('Unclear'));
  await patch(page,()=>row.getByRole('button',{name:'Mark done'}).click(),422);
  await expect(row).toContainText('closure reason');
  await row.getByLabel('Your notes').fill('Conflicting property descriptions escalated to admin');
  await patch(page,()=>row.getByLabel('Your notes').blur());
  await patch(page,()=>row.getByLabel('Closure reason').selectOption('escalated'));
  await patch(page,()=>row.getByRole('button',{name:'Mark done'}).click());
  await page.reload();await expect(work(page)).toHaveClass(/row-done/);
});

test('retryable attempts remain open, appear in due work and retain manual history',async({employeePage:page,adminPage})=>{
  await page.goto('/dashboard/my');const row=work(page);
  await patch(page,()=>row.getByLabel('Result of the call').selectOption('Unavailable'));
  await row.getByRole('button',{name:'Log manual call'}).click();
  const dialog=page.getByRole('dialog');await dialog.getByLabel('What happened?').selectOption('busy');
  await dialog.getByLabel('Reported duration').fill('8');await dialog.getByRole('button',{name:'Record attempt'}).click();
  await expect(dialog).toHaveCount(0);await expect(work(page)).toContainText('Busy');
  await patch(page,()=>work(page).getByRole('button',{name:'Mark done'}).click(),422);
  await expect(work(page)).toContainText('Follow-up is still required');
  // Discard the failed completion draft before navigating to its queue.
  await page.locator('.sheet-save-status').getByRole('button',{name:/Discard/}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Discard changes',exact:true}).click();
  await page.goto('/dashboard/my?follow_up=due');await expect(work(page)).toBeVisible();
  await adminPage.goto('/dashboard/raw?q=Raghav');await adminPage.getByRole('button',{name:'Manual calls for record'}).click();
  await expect(adminPage.getByRole('tab',{name:'Manual activity',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(adminPage.getByRole('tabpanel',{name:'Manual activity',exact:true})).toContainText('Reported duration: 8s');
  const response=await adminPage.request.get(`/api/details/record/${raw}`);const data=await response.json();
  expect(data.manual.total).toBe(1);expect(data.manual.rows[0].assignee).toBe('priya@eval.test');
});

test('corrections preserve the first event and new connection permits completion',async({employeePage:page})=>{
  await page.goto('/dashboard/my');await work(page).getByRole('button',{name:'Log manual call'}).click();
  let dialog=page.getByRole('dialog');await dialog.getByLabel('What happened?').selectOption('no_answer');
  await dialog.getByRole('button',{name:'Record attempt'}).click();await expect(dialog).toHaveCount(0);
  await expect(work(page)).toContainText('No answer / RNR');
  await work(page).getByRole('button',{name:'Log manual call'}).click();dialog=page.getByRole('dialog');
  await expect(dialog.getByRole('combobox',{name:'Event',exact:true})).toBeVisible();
  const option=await dialog.getByRole('combobox',{name:'Event',exact:true}).locator('option').nth(1).getAttribute('value');
  await dialog.getByRole('combobox',{name:'Event',exact:true}).selectOption(option!);await dialog.getByLabel('What happened?').selectOption('connected');
  await dialog.getByRole('combobox',{name:'Manual result',exact:true}).selectOption('Unavailable');
  await dialog.getByLabel('Why is this correction needed?').fill('Selected no answer by mistake; owner confirmed no space');
  await dialog.getByRole('button',{name:'Save correction'}).click();await expect(dialog).toHaveCount(0);
  await expect(work(page)).toContainText('Connected');
  await patch(page,()=>work(page).getByRole('button',{name:'Mark done'}).click());
  const data=await (await page.request.get(`/api/details/record/${raw}`)).json();
  expect(data.manual.total).toBe(2);expect(data.manual.rows.filter((r:any)=>r.superseded)).toHaveLength(1);
});

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
