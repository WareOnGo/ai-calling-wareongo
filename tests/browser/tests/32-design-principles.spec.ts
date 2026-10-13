import { test, expect } from './fixtures';

test('filter categories retain a draft across tabs and apply every field together', async ({ adminPage: page }) => {
  await page.goto('/dashboard/raw');
  const header = page.locator('.colheads').first();
  const original = await header.boundingBox();
  const trigger = page.getByRole('button', { name: 'Toggle filters', exact: true });
  await trigger.click();
  expect(await header.boundingBox()).toEqual(original);
  const dialog = page.getByRole('dialog', { name: 'Filters', exact: true });
  await page.getByRole('tab', { name: 'Property', exact: true }).click();
  await dialog.getByLabel('City', { exact: true }).fill('Rajkot');
  await page.getByRole('tab', { name: 'Call outcome', exact: true }).click();
  const result = dialog.locator('details').filter({ has: page.locator('.multi-control-label').filter({hasText:'Latest AI result'}) });
  await result.locator('summary').click();
  await result.getByRole('checkbox', { name: 'Available', exact: true }).check();
  await result.getByRole('checkbox', { name: 'Unclear', exact: true }).check();
  await result.locator('summary').click();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(trigger).toBeFocused();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page).toHaveURL(/city=Rajkot/);
  expect(new URL(page.url()).searchParams.getAll('last_result')).toEqual(['Available', 'Unclear']);
});

for (const theme of ['light', 'dark']) {
  test(`field boundaries and focus remain discernible in ${theme}`, async ({ adminPage: page }) => {
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    await page.goto('/dashboard/raw');
    await page.getByRole('button', { name: 'Toggle filters', exact: true }).click();
    await page.getByRole('tab', { name: 'Property', exact: true }).click();
    const field = page.getByRole('dialog').getByLabel('City', { exact: true });
    await field.focus();
    const contrast = await field.evaluate(element => {
      const style = getComputedStyle(element);
      const luminance = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
      const ratio = (a: string, b: string) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
      return { border: ratio(style.borderColor, style.backgroundColor), focus: ratio(style.outlineColor, style.backgroundColor), width: parseFloat(style.outlineWidth) };
    });
    expect(contrast.border).toBeGreaterThanOrEqual(3);
    expect(contrast.focus).toBeGreaterThanOrEqual(3);
    expect(contrast.width).toBeGreaterThanOrEqual(2);
    await field.blur();
  });
}
