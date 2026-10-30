import { test, expect } from './fixtures';

const work = (page: any) => page.locator('[data-entity="record"] tbody tr').filter({ hasText: 'Raghav Sharma' });
async function save(page: any, action: () => Promise<unknown>) {
  const response = page.waitForResponse((r: any) => r.url().includes('/api/my-work/assignments/') && r.request().method() === 'PATCH');
  await action();
  expect((await response).status()).toBe(200);
  await expect(page.locator('.sheet-save-status')).toHaveText('All changes saved');
}

test('employee completion keeps the existing workflow without manual-call or closure forms', async ({ employeePage: page }) => {
  await page.goto('/dashboard/my');
  const row = work(page);
  await expect(page.getByRole('button', { name: 'Log manual call' })).toHaveCount(0);
  await expect(page.getByLabel('Closure reason')).toHaveCount(0);
  await expect(row.getByLabel('Result of the call').locator('option').first()).toHaveText('Not called yet');
  await save(page, () => row.getByLabel('Result of the call').selectOption('Unclear'));
  await save(page, () => row.getByRole('button', { name: 'Mark done', exact: true }).click());
  await expect(row).toHaveClass(/row-done/);
  await page.reload();
  await expect(work(page).getByRole('button', { name: 'Done', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(work(page).getByLabel('Warehouse ID')).toHaveValue('');
});

test('free-text warehouse references and completed-task corrections still save', async ({ employeePage: page }) => {
  await page.goto('/dashboard/my');
  const row = work(page);
  await save(page, async () => { await row.getByLabel('Warehouse ID').fill('WH-123'); await row.getByLabel('Warehouse ID').blur(); });
  await save(page, () => row.getByLabel('Result of the call').selectOption('Available'));
  await save(page, () => row.getByRole('button', { name: 'Mark done', exact: true }).click());
  await save(page, async () => { await row.getByLabel('Your notes').fill('Employee correction after completion'); await row.getByLabel('Your notes').blur(); });
  await page.reload();
  await expect(work(page).getByLabel('Warehouse ID')).toHaveValue('WH-123');
  await expect(work(page).getByLabel('Your notes')).toHaveValue('Employee correction after completion');
});

test('employee details retain the original drawer while admin details use the new activity tabs', async ({ employeePage: page, adminPage }) => {
  await page.goto('/dashboard/my');
  await work(page).getByRole('button', { name: 'Details for record', exact: true }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('heading', { name: 'AI notes', exact: true })).toBeVisible();
  await expect(drawer.getByRole('heading', { name: 'Transcript', exact: true })).toBeVisible();
  await expect(drawer.getByRole('tab')).toHaveCount(0);
  await drawer.getByRole('button', { name: 'Close details', exact: true }).click();
  await expect(work(page).getByRole('button', { name: 'Details for record', exact: true })).toBeFocused();
  await adminPage.goto('/dashboard/raw?q=Raghav');
  await adminPage.getByRole('button', { name: 'Details for record', exact: true }).click();
  await expect(adminPage.getByRole('tab', { name: 'Manual activity', exact: true })).toBeVisible();
  await expect(adminPage.getByRole('link', { name: 'Open lead record', exact: true })).toBeVisible();
  await adminPage.getByRole('link', { name: 'Open lead record', exact: true }).click();
  await expect(adminPage).toHaveURL(/\/dashboard\/raw\/a0000000-0000-4000-8000-000000000001$/);
  await expect(adminPage.getByRole('heading', { name: 'Raghav Sharma', exact: true })).toBeVisible();
  await expect(adminPage.getByText('CRM imported on', { exact: true })).toBeVisible();
});

for (const width of [1600, 390]) for (const theme of ['light', 'dark']) {
  test(`preserved employee typography and controls at ${width}px in ${theme}`, async ({ employeePage: page, shot }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    await page.goto('/dashboard/my');
    const content = page.locator('#employee-work');
    await expect(content).toHaveCSS('font-family', 'Roboto, Arial, "Helvetica Neue", sans-serif');
    await expect(content).toHaveCSS('font-size', '13px');
    await expect(content).toHaveCSS('line-height', 'normal');
    await expect(page.locator('.work-filters').getByLabel('Work type', { exact: true })).toBeVisible();
    await expect(page.locator('.work-filters').getByLabel('Filter by result')).toBeVisible();
    await expect(page.locator('th.mine-first').first()).toHaveText('Result');
    await expect(work(page).getByRole('button', { name: 'Log manual call' })).toHaveCount(0);
    await expect(page.locator('.app-header .brand-name')).toHaveText('CallOnGo');
    await shot(page, `preserved-employee-${width}-${theme}`);
    await page.goto('/dashboard');
    await expect(page.locator('#employee-work')).toHaveCount(0);
    await page.getByRole('navigation', { name: 'Dashboard' }).getByRole('link', { name: 'My Work', exact: true }).click();
    await expect(content).toHaveCSS('font-size', '13px');
  });
}
