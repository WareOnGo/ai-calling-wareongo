import { test, expect, bodyOverflowsX } from './fixtures';

test('zero attempts keep their count and omit empty history actions', async ({ adminPage: page }) => {
  for (const path of ['raw', 'calls']) {
    await page.goto('/dashboard/' + path);
    await expect(page.getByRole('button', {name:'Show AI attempts'})).toHaveCount(0);
    await expect(page.getByRole('button', {name:/^Manual (calls|history) for/})).toHaveCount(0);
    await expect(page.locator('tbody .details-trigger').first()).toBeVisible();
    await expect(page.locator('tbody .record-history').first()).toContainText('0');
  }
});

test('primary records and their actions fit a laptop without horizontal panning', async ({ adminPage: page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  const readingOrder = {
    calls: ['Owner', 'Number', 'AI result', 'AI attempts', 'Assigned To', 'Manual result', 'Manual notes', 'Added', 'WH ID'],
    raw: ['Owner', 'Phone', 'City', 'Sqft', 'Source', 'AI attempts', 'Assigned To', 'Manual calls'],
    assignments: ['Who', 'Phone', 'Assignee', 'Status', 'AI result', 'Manual result', 'Notes', 'Actions'],
  };
  for (const view of ['calls', 'raw', 'assignments'] as const) {
    await page.goto('/dashboard/' + view);
    await expect(page.locator('.colheads th[data-column]:visible').filter({hasNot:page.locator('input')})).toHaveText(readingOrder[view]);
    const geometry = await page.locator('.gridwrap').first().evaluate(element => ({ width: element.clientWidth, contents: element.scrollWidth }));
    expect(geometry.contents, view).toBeLessThanOrEqual(geometry.width + 1);
    await expect(page.locator('.rownum:visible, .rowgutter:visible, .col-resizer, .grp-toggle')).toHaveCount(0);
    await expect(page.locator('tbody .details-trigger').first()).toBeVisible();
    if (view === 'calls') {
      // Moving the admin ownership column must keep every editable field under
      // its label, including the three cells returned by EditableCells.
      for (const [heading, label] of [['Manual notes','Manual follow-up notes'],['Added','Team marked warehouse added to database'],['WH ID','Team warehouse ID']]) {
        const index = await page.locator(`th[data-column="${heading}"]`).evaluate((cell:HTMLTableCellElement) => cell.cellIndex);
        await expect(page.locator('tbody tr').first().locator('td').nth(index).getByLabel(label)).toBeVisible();
      }
    }
  }
});

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
