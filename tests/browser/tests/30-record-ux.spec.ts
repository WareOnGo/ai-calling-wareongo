import { test, expect, bodyOverflowsX } from './fixtures';

test('zero AI attempts keep their count while contact call history remains available', async ({ adminPage: page }) => {
  for (const path of ['raw', 'calls', 'assignments']) {
    await page.goto('/dashboard/' + path);
    await expect(page.getByRole('button', {name:'Show AI attempts'})).toHaveCount(0);
    await expect(page.locator('tbody .details-trigger').first()).toBeVisible();
    await expect(page.locator('tbody .record-history').first()).toContainText('0');
    const history = page.getByRole('button', {name:/^(Manual calls|Manual history|Call history) for/}).first();
    await history.click();
    await expect(page.getByRole('dialog').getByRole('tab', {name:'Manual activity', exact:true})).toHaveAttribute('aria-selected','true');
    await expect(page.getByRole('dialog')).toContainText('No recorded or imported calls for this contact');
    await page.keyboard.press('Escape');
  }
});

test('primary records and their actions fit a laptop without horizontal panning', async ({ adminPage: page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  const readingOrder = {
    calls: ['Contact', 'AI result', 'AI attempts', 'Assigned To', 'Manual result', 'Manual notes', 'Added', 'WH ID'],
    raw: ['Contact', 'City', 'Sqft', 'Source', 'AI attempts', 'Assigned To', 'Manual calls'],
    assignments: ['Contact', 'Assignee', 'Status', 'AI result', 'AI attempts', 'Manual result', 'Notes', 'Actions'],
  };
  for (const view of ['calls', 'raw', 'assignments'] as const) {
    await page.goto('/dashboard/' + view);
    await expect(page.locator('.colheads th[data-column]:visible').filter({hasNot:page.locator('input')})).toHaveText(readingOrder[view]);
    const geometry = await page.locator('.gridwrap').first().evaluate(element => ({ width: element.clientWidth, contents: element.scrollWidth }));
    expect(geometry.contents, view).toBeLessThanOrEqual(geometry.width + 1);
    await expect(page.locator('.rownum:visible, .rowgutter:visible, .col-resizer, .grp-toggle')).toHaveCount(0);
    await expect(page.locator('tbody .details-trigger').first()).toBeVisible();
    if (view === 'calls') {
      // Saved manual values belong under their report headings, without inputs
      // or disabled controls suggesting that the report is another editing grid.
      for (const [heading, value] of [['Manual notes','No notes yet'],['Added','No'],['WH ID','—']]) {
        const index = await page.locator(`th[data-column="${heading}"]`).evaluate((cell:HTMLTableCellElement) => cell.cellIndex);
        const cell=page.locator('tbody tr').first().locator('td').nth(index);
        await expect(cell).toHaveText(value);
        await expect(cell.locator('input,textarea,select')).toHaveCount(0);
      }
    }
  }
});

for (const width of [320, 390]) for (const theme of ['light', 'dark']) {
  test(`preserved task sheets keep every field reachable at ${width}px in ${theme}`, async ({ employeePage: page, shot }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(theme => localStorage.setItem('theme', theme), theme);
    await page.goto('/dashboard/my');
    const row = page.locator('[data-entity="record"] tbody tr').filter({ hasText: 'Raghav' });
    const horizontal = await page.locator('.worklist .gridwrap').evaluateAll(elements => elements.some(element => element.scrollWidth > element.clientWidth + 1));
    expect(horizontal).toBe(true);
    expect(await bodyOverflowsX(page)).toBe(false);
    const controls = row.locator('input, select, textarea, button');
    for (const control of await controls.all()) {
      await control.scrollIntoViewIfNeeded();
      const bounds = await control.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      // Browser scroll positions round fractional table widths to whole pixels.
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
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
