// Deferred with the unshipped employee overhaul; see README.md.
import { test, expect, bodyOverflowsX } from "../tests/fixtures";

for (const width of [320, 390]) for (const theme of ['light', 'dark']) {
  test(`calling cards keep every field reachable at ${width}px in ${theme}`, async ({ employeePage: page, shot }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(theme => localStorage.setItem('theme', theme), theme);
    await page.goto('/dashboard/my');
    const row = page.locator('[data-entity="record"] tbody tr').filter({ hasText: 'Raghav' });
    const horizontal = await page.locator('.worklist .gridwrap').evaluateAll(elements => elements.some(element => element.scrollWidth > element.clientWidth + 1));
    expect(horizontal).toBe(false);
    expect(await bodyOverflowsX(page)).toBe(false);
    const controls = row.locator('input, select, textarea, button');
    for (const control of await controls.all()) {
      await control.scrollIntoViewIfNeeded();
      const bounds = await control.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    }
    await row.getByLabel('Your notes').fill('Mobile notes remain attached to this calling task');
    await row.getByLabel('Your notes').blur();
    await expect(row.locator('.save-status')).toHaveText('Saved');
    await row.getByLabel('Result of the call').scrollIntoViewIfNeeded();
    await shot(page, `calling-card-fields-${width}-${theme}`);
    await page.reload();
    await expect(row.getByLabel('Your notes')).toHaveValue('Mobile notes remain attached to this calling task');
  });
}

test('notes immediately after a recorded call save using the refreshed revision', async ({ employeePage: page }) => {
  await page.goto('/dashboard/my');
  const row = page.locator('[data-entity="record"] tbody tr').filter({ hasText: 'Raghav' });
  const revisions: number[] = [];
  page.on('request', request => {
    if (request.method() === 'PATCH' && /\/api\/assignments\/\d+$/.test(request.url())) revisions.push(request.postDataJSON().revision);
  });
  await row.getByRole('button', { name: 'Log manual call' }).click();
  const dialog = page.getByRole('dialog');
  const response = page.waitForResponse(response => /\/api\/assignments\/\d+\/attempts$/.test(response.url()) && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Record attempt' }).click();
  expect((await response).ok()).toBe(true);
  await expect(dialog).toHaveCount(0);
  await row.getByLabel('Your notes').fill('Follow-up notes entered immediately after logging the call');
  await row.getByLabel('Your notes').blur();
  await expect(row.locator('.save-status')).toHaveText('Saved');
  expect(revisions).toHaveLength(1);
  await page.reload();
  await expect(row.getByLabel('Your notes')).toHaveValue('Follow-up notes entered immediately after logging the call');
});
