import { test, expect, bodyOverflowsX } from './fixtures';
import { unreadableText } from '../lib/visual-audit';

for (const width of [1366, 390]) for (const theme of ['light', 'dark']) {
  test(`separate team pages, member search and navigation at ${width}px in ${theme}`, async ({ adminPage: page, shot }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 768 });
    await page.addInitScript(theme => localStorage.setItem('theme', theme), theme);
    await page.goto('/dashboard/team');
    await expect(page.locator('.page-title')).toHaveText('Team performance');
    await expect(page.getByRole('navigation', { name: 'Team pages' }).getByRole('link', { name: 'Performance', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByLabel('Team metrics table')).toBeVisible();
    await expect(page.getByRole('switch')).toHaveCount(0);
    expect(await bodyOverflowsX(page)).toBe(false);
    expect(await unreadableText(page)).toEqual([]);
    await shot(page, `team-performance-${width}-${theme}`);
    await page.getByRole('link', { name: 'Access control', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/team\/access$/);
    await expect(page.locator('.page-title')).toHaveText('Access control');
    await expect(page.locator('.topnav a[aria-current=page]')).toHaveText('Team');
    await expect(page.getByLabel('Team metrics table')).toHaveCount(0);
    await expect(page.getByLabel('Report from')).toHaveCount(0);
    await expect(page.locator('.person')).toHaveCount(4);
    await expect(page.getByRole('switch', { name: 'Access for admin@eval.test', exact: true })).toBeDisabled();
    await page.getByRole('searchbox', { name: 'Search team members' }).fill('priya');
    await expect(page.locator('.person')).toHaveCount(1);
    await expect(page.locator('.person')).toContainText('priya@eval.test');
    await page.getByRole('searchbox', { name: 'Search team members' }).fill('no-such-person');
    await expect(page.locator('.team-no-matches')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await expect(page.locator('.person')).toHaveCount(4);
    expect(await bodyOverflowsX(page)).toBe(false);
    expect(await unreadableText(page)).toEqual([]);
    await shot(page, `team-access-${width}-${theme}`);
    await page.getByRole('button', { name: 'Add someone', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Google account' })).toBeFocused();
    expect(await bodyOverflowsX(page)).toBe(false);
    await shot(page, `team-access-add-${width}-${theme}`);
  });
}

test('access control is independently guarded for employees', async ({ employeePage: page }) => {
  await page.goto('/dashboard/team/access');
  await expect(page).toHaveURL(/\/dashboard\/my/);
  await expect(page.getByRole('switch', { name: /Access for/ })).toHaveCount(0);
  const result = await page.request.post('/api/users', { data: { email: 'priya@eval.test', role: 'admin' } });
  expect(result.status()).toBe(403);
});
