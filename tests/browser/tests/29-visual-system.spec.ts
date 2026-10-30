import { test, expect, bodyOverflowsX } from './fixtures';

import { unreadableText } from '../lib/visual-audit';

for (const width of [1366, 1024, 390]) for (const theme of ['light', 'dark']) {
  test(`readable controls and contained layouts at ${width}px in ${theme}`, async ({ adminPage, employeePage, shot }) => {
    for (const page of [adminPage, employeePage]) {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(theme => localStorage.setItem('theme', theme), theme);
    }
    for (const path of ['raw', 'calls', 'assignments', 'batches', 'team', 'my']) {
      const page = path === 'my' ? employeePage : adminPage;
      await page.goto('/dashboard/' + path);
      await page.evaluate(() => document.fonts.ready);
      expect.soft(await bodyOverflowsX(page), path + ' page overflow').toBe(false);
      // My Work deliberately retains main's existing palette and completed-row
      // opacity. The new contrast contract applies to its updated header only.
      expect.soft(await unreadableText(page, path === 'my' ? '.app-header' : 'body'), path + ' readable text').toEqual([]);
      if (path === 'my') {
        const clipped = await page.locator('.task-sheet .btn-done, .task-sheet .notes-field, .task-sheet .field-select').evaluateAll(elements => elements.flatMap(element => {
          const box = element.getBoundingClientRect(), cell = element.closest('td')!.getBoundingClientRect();
          return box.right > cell.right + 1 || box.left < cell.left - 1 ? [element.className] : [];
        }));
        expect.soft(clipped, 'work controls fit the existing column widths').toEqual([]);
      }
      await shot(page, `visual-${path}-${width}-${theme}`);
    }
  });
}

test('saved themes and the local font survive navigation and reload', async ({ adminPage: page, shot }) => {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Toggle dark mode' }).click();
  await page.getByRole('navigation', { name: 'Dashboard' }).getByRole('link', { name: 'Raw Dataset' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const font = await page.evaluate(async () => {
    await document.fonts.ready;
    const family = getComputedStyle(document.body).fontFamily.split(',')[0].trim().replaceAll('"', '');
    return { loaded: [...document.fonts].some(font => font.family.replaceAll('"', '') === family && font.status === 'loaded'),
      requests: performance.getEntriesByType('resource').map(entry => entry.name).filter(name => /\.woff2(?:\?|$)/.test(name)).map(name => new URL(name).origin), origin: location.origin };
  });
  expect(font.loaded).toBe(true);
  expect(font.requests.length).toBeGreaterThan(0);
  expect(font.requests.every(origin => origin === font.origin)).toBe(true);
  await page.goto('/dashboard');
  await shot(page, 'visual-hub-dark');
});

test('keyboard focus and dialog actions remain readable', async ({ adminPage: page, employeePage, shot }) => {
  await page.goto('/dashboard/raw');
  await page.getByRole('button', { name: 'Toggle dark mode' }).click();
  const search = page.getByRole('textbox', { name: 'Search records' });
  await search.focus();
  const ring = await search.evaluate(element => {
    const style = getComputedStyle(element); return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });
  expect(ring.style).toBe('solid'); expect(ring.width).toBeGreaterThanOrEqual(2);
  await page.locator('input.selall').check();
  await page.getByRole('button', { name: /Queue for calling/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: /Send to Bolna/ })).toBeEnabled();
  expect(await unreadableText(page)).toEqual([]);
  await shot(page, 'visual-dispatch-dialog-dark');
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await employeePage.goto('/dashboard/my');
  await employeePage.getByRole('button', { name: 'Toggle dark mode' }).click();
  await employeePage.getByRole('button', { name: 'Details for record' }).first().click();
  await expect(employeePage.getByRole('dialog').getByRole('button', { name: 'Close details' })).toBeVisible();
  await shot(employeePage, 'preserved-employee-dialog-dark');
});

test('sign-in stays readable in both saved themes on a small screen', async ({ page, shot }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of ['light', 'dark']) {
    await page.goto('/');
    await page.evaluate(theme => { localStorage.setItem('theme', theme); document.documentElement.setAttribute('data-theme', theme); }, theme);
    await page.reload();
    await expect(page.getByRole('link', { name: 'Sign in with Google' })).toBeVisible();
    expect(await bodyOverflowsX(page)).toBe(false);
    expect(await unreadableText(page)).toEqual([]);
    await shot(page, 'visual-sign-in-' + theme);
  }
});
