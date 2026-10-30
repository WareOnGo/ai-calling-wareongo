import { test, expect, bodyOverflowsX } from './fixtures';
import { Client } from 'pg';
import { DB_URL } from '../lib/env.mjs';

for (const width of [1366, 390]) for (const theme of ['light', 'dark']) {
  test(`batch navigation keeps the correct loading screen at ${width}px in ${theme}`, async ({ adminPage: page, shot }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 768 });
    await page.addInitScript(theme => localStorage.setItem('theme', theme), theme);
    const db = new Client({ connectionString: DB_URL, ssl: false });
    await db.connect();
    const batch = 'd0000000-0000-4000-8000-000000000071';
    await db.query("insert into call_batches(id,state) values($1,'completed')", [batch]);
    await page.goto('/dashboard/raw');
    await page.evaluate(() => {
      const target = window as typeof window & { wrongLoading: string[]; stopLoadingAudit?: () => void };
      target.wrongLoading = [];
      let frame = 0;
      const check = () => {
        for (const element of document.querySelectorAll<HTMLElement>('[data-loading-view="home"], .hub')) {
          if (element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden') target.wrongLoading.push(element.className);
        }
        frame = requestAnimationFrame(check);
      };
      frame = requestAnimationFrame(check);
      target.stopLoadingAudit = () => cancelAnimationFrame(frame);
    });
    try {
      for (const [view, click] of [
        ['batches', () => page.locator('.topnav').getByRole('link', { name: 'Batches', exact: true }).click()],
        ['batch-detail', () => page.getByRole('link', { name: 'AI batch d0000000', exact: true }).click()],
      ] as const) {
        await db.query('begin');
        await db.query('lock table call_batches in access exclusive mode');
        try {
          await click();
          await expect(page.locator(`[data-loading-view="${view}"]:visible`)).toBeVisible();
          await expect(page.locator('[data-loading-view="home"]:visible')).toHaveCount(0);
          expect(await bodyOverflowsX(page)).toBe(false);
          await shot(page, `loading-${view}-${width}-${theme}`);
        } finally { await db.query('commit'); }
        await expect(page.locator('[data-loading-view]')).toHaveCount(0);
        await expect(page.locator('.topnav a[aria-current=page]')).toHaveText('Batches');
      }
      const wrong = await page.evaluate(() => {
        const target = window as typeof window & { wrongLoading: string[]; stopLoadingAudit?: () => void };
        target.stopLoadingAudit?.();
        return target.wrongLoading;
      });
      expect(wrong).toEqual([]);
    } finally { await db.end(); }
  });
}
