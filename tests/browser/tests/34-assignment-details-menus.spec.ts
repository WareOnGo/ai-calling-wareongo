import { test, expect, bodyOverflowsX } from './fixtures';
import { unreadableText } from '../lib/visual-audit';
import { execFileSync } from 'node:child_process';
import { CONTAINER } from '../lib/env.mjs';
import type { Page } from '@playwright/test';

async function dialogFits(page: Page) {
  expect(await bodyOverflowsX(page)).toBe(false);
  const geometry = await page.locator('dialog[open]').evaluate(element => ({
    width: element.clientWidth, content: element.scrollWidth,
    footer: element.querySelector('.modal-foot')!.getBoundingClientRect().bottom, height: innerHeight,
  }));
  expect(geometry.content).toBeLessThanOrEqual(geometry.width + 1);
  expect(geometry.footer).toBeLessThanOrEqual(geometry.height);
  expect(await unreadableText(page)).toEqual([]);
}

for (const width of [1366, 390]) for (const theme of ['light', 'dark']) {
  test(`multiple callers are discoverable and show their split at ${width}px in ${theme}`, async ({ adminPage: page, shot }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 768 });
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    const requests: object[] = [];
    page.on('request', request => { if (request.url().endsWith('/api/assignments/preview')) requests.push(request.postDataJSON()); });
    await page.goto('/dashboard/raw');
    await page.getByRole('button', { name: 'Assign', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: 'Assign to', exact: true }).selectOption('priya@eval.test');
    await dialog.getByRole('radio', { name: 'Split across callers', exact: true }).check();
    await expect(dialog.getByRole('group', { name: /Choose callers/ })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Split calls', exact: true })).toBeDisabled();
    await expect(dialog.getByText('Choose at least 2 callers to split the calls.', { exact: true })).toBeVisible();
    await dialog.getByRole('checkbox', { name: 'Raj Eval (raj@eval.test)', exact: true }).check();
    await expect(dialog.getByRole('button', { name: 'Split 2 calls across 2 callers', exact: true })).toBeEnabled();
    for (const email of ['priya@eval.test', 'raj@eval.test']) await expect(dialog.locator('.caller-choice').filter({ hasText: email }).locator('.caller-share')).toHaveText('1 call');
    await dialogFits(page);
    await shot(page, `assignment-split-${width}-${theme}`);
    await dialog.getByRole('checkbox', { name: 'Priya Eval (priya@eval.test)', exact: true }).uncheck();
    await expect(dialog.getByRole('button', { name: 'Split calls', exact: true })).toBeDisabled();
    await dialog.getByRole('checkbox', { name: 'Raj Eval (raj@eval.test)', exact: true }).uncheck();
    await expect(dialog.getByRole('group', { name: /Choose callers/ })).toContainText('0 selected');
    await expect(dialog.getByRole('region', { name: 'Assignment preview' })).toHaveCount(0);
    await dialog.getByRole('radio', { name: 'One caller', exact: true }).check();
    await expect(dialog.getByRole('combobox', { name: 'Assign to', exact: true })).toHaveValue('priya@eval.test');
    await expect(dialog.getByRole('button', { name: 'Assign 2', exact: true })).toBeEnabled();
    expect(requests.at(-1)).toMatchObject({ assignee: 'priya@eval.test' });
    expect(requests.at(-1)).not.toHaveProperty('assignees');
  });

  test(`details separate property and activity at ${width}px in ${theme}`, async ({ adminPage: page, shot }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 768 });
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    let aiRequests = 0;
    page.on('request', request => { if (/\/api\/details\/record\/[^/]+\/ai\?/.test(request.url())) aiRequests++; });
    await page.route('**/api/details/record/*?manual_page=*', async route => {
      const response = await route.fetch();
      const data = await response.json();
      const pageNumber = Number(new URL(route.request().url()).searchParams.get('manual_page'));
      data.row.rent = '150000000.0';
      data.row.last_transcript = 'assistant: Is the warehouse available?\nuser: Yes, it is available.';
      data.manual = { rows: [{ id: `synthetic-${pageNumber}`, occurred_at: '2026-10-12T10:00:00Z', disposition: 'connected', assignee: 'priya@eval.test', actor: 'priya@eval.test', outcome: 'Available', notes: `Recorded attempt ${pageNumber}`, duration_seconds: 30 }], total: 2, page: pageNumber, pages: 2 };
      await route.fulfill({ response, json: data });
    });
    await page.goto('/dashboard/raw?q=Raghav');
    const trigger = page.getByRole('button', { name: 'Details for record', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog');
    const overview = dialog.getByRole('tabpanel', { name: 'Overview', exact: true });
    await expect(overview.getByRole('region', { name: 'Property', exact: true })).toContainText('₹15,00,00,000');
    await expect(overview.getByRole('region', { name: 'Latest AI call', exact: true })).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Call number', exact: true })).toHaveAttribute('href', /^tel:/);
    expect(aiRequests).toBe(0);
    await dialogFits(page);
    await shot(page, `details-overview-${width}-${theme}`);
    await overview.locator('.detail-listings > summary').first().click();
    await expect(overview.locator('.detail-listing').first()).toBeVisible();
    await dialog.getByRole('tab', { name: 'Overview', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(dialog.getByRole('tab', { name: 'AI activity', exact: true })).toBeFocused();
    const ai = dialog.getByRole('tabpanel', { name: 'AI activity', exact: true });
    await expect(ai.locator('.history-summary')).toBeVisible();
    expect(aiRequests).toBe(1);
    await ai.getByText('Transcript', { exact: true }).click();
    await expect(ai.locator('.transcript')).toBeVisible();
    await expect(ai.locator('.transcript')).toContainText('Yes, it is available.');
    await dialogFits(page);
    await shot(page, `details-ai-${width}-${theme}`);
    await dialog.getByRole('tab', { name: 'Manual activity', exact: true }).click();
    const manual = dialog.getByRole('tabpanel', { name: 'Manual activity', exact: true });
    await expect(manual).toContainText('Recorded attempt 1');
    await manual.getByRole('button', { name: 'Next attempts', exact: true }).click();
    await expect(manual).toContainText('Recorded attempt 2');
    await expect(manual.getByRole('button', { name: 'Next attempts', exact: true })).toBeDisabled();
    await expect(manual.getByRole('heading', { name: /Verification history/ })).toBeVisible();
    await dialogFits(page);
    await shot(page, `details-manual-${width}-${theme}`);
    await dialog.getByRole('tab', { name: 'AI activity', exact: true }).click();
    await expect(ai.locator('.transcript')).toBeVisible();
    expect(aiRequests).toBe(1);
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  });

  test(`toolbar menus stay visible and clickable at ${width}px in ${theme}`, async ({ adminPage, employeePage, shot }) => {
    for (const page of [adminPage, employeePage]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 768 });
      await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    }
    for (const path of ['raw', 'calls', 'assignments', 'my']) {
      const page = path === 'my' ? employeePage : adminPage;
      await page.goto('/dashboard/' + path);
      for (const selector of ['.views-menu', ...(path === 'my' ? [] : ['.column-menu:not(.views-menu)'])]) {
        const menu = page.locator(selector);
        await menu.locator('summary').click();
        const panel = menu.locator('.column-options');
        await expect(panel).toBeVisible();
        // A panel can have correct bounds and still be clipped by an ancestor.
        // Hit testing both corners catches clipping or a covering grid layer.
        await expect.poll(() => panel.evaluate(element => {
          const box = element.getBoundingClientRect();
          return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight
            && [[box.left + 4, box.top + 4], [box.right - 4, box.bottom - 4]].every(([x, y]) => element.contains(document.elementFromPoint(x, y)));
        }), path + ' ' + selector).toBe(true);
        expect(await bodyOverflowsX(page)).toBe(false);
        if (selector === '.views-menu' && path === 'assignments') await shot(page, `views-menu-${width}-${theme}`);
        await page.keyboard.press('Escape');
        await expect(panel).toBeHidden();
      }
    }
  });
}

test('caller search preserves selections and includes zero allocations in a small batch', async ({ adminPage: page }) => {
  execFileSync('podman', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1'], { input: "insert into bolna_app_users(email,name,role,active) select 'caller'||i||'@eval.test','Caller '||i,'employee',true from generate_series(1,8) i;", stdio: ['pipe', 'ignore', 'pipe'] });
  await page.goto('/dashboard/raw');
  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Assign to', exact: true }).selectOption('priya@eval.test');
  await dialog.getByRole('radio', { name: 'Split across callers', exact: true }).check();
  const search = dialog.getByRole('searchbox', { name: 'Find a caller', exact: true });
  await search.fill('caller7@');
  await dialog.getByRole('checkbox', { name: 'Caller 7 (caller7@eval.test)', exact: true }).check();
  await search.fill('Caller 8');
  await dialog.getByRole('checkbox', { name: 'Caller 8 (caller8@eval.test)', exact: true }).check();
  await expect(dialog.getByRole('button', { name: 'Split 2 calls across 3 callers', exact: true })).toBeEnabled();
  await search.clear();
  await expect(dialog.getByRole('checkbox', { name: 'Priya Eval (priya@eval.test)', exact: true })).toBeChecked();
  await expect(dialog.locator('.caller-share')).toHaveText(['1 call', '1 call', '0 calls']);
  await search.fill('No matching caller');
  await expect(dialog.getByText('No callers match your search.', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('group', { name: /Choose callers/ })).toContainText('3 selected');
  await expect(dialog.getByRole('button', { name: 'Split 2 calls across 3 callers', exact: true })).toBeEnabled();
});
