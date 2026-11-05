import { test, expect } from './fixtures';
import { execFileSync } from 'node:child_process';
import { CONTAINER } from '../lib/env.mjs';

// Seed: Raghav (priya) is one Inbound card with a listing and an AI follow-up on one phone.
const sql = (statement: string) => execFileSync('podman', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-c', statement]);
const column = (page: any, code: string) => page.locator(`.board-column[data-code="${code}"]`);
const raghav = (page: any) => page.locator('.board-columns .board-card').filter({ hasText: 'Raghav Sharma' });
const stages = (page: any) => execFileSync('podman', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-tA', '-c', 'select string_agg(stage, \',\' order by id) from bolna_assignments where id in (1,5)']).toString().trim();

test('dragging a card onto an open stage moves the whole card', async ({ employeePage: page }) => {
  await page.goto('/dashboard/board');
  await raghav(page).dragTo(column(page, '2C'));
  await expect(column(page, '2C').locator('.board-card')).toContainText('Raghav Sharma');
  await expect(column(page, '1').locator('.board-card')).toHaveCount(0);
  expect(stages(page)).toBe('awaiting_details,awaiting_details');
});

test('dropping on a stage that needs input opens the panel at that step without moving yet', async ({ employeePage: page }) => {
  // Wide enough for all seven columns: scrolling mid-drag would cancel a synthetic drag.
  await page.setViewportSize({ width: 2100, height: 1000 });
  await page.goto('/dashboard/board');
  await raghav(page).dragTo(column(page, '5'));
  const panel = page.getByRole('complementary');
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Raghav Sharma');
  await expect(panel.getByRole('group', { name: 'Why is this lead junk?' })).toBeVisible();
  await expect(panel.getByRole('combobox', { name: 'Stage' })).toHaveValue('junk');
  await expect(column(page, '1').locator('.board-card')).toContainText('Raghav Sharma');
  await panel.getByRole('radio', { name: 'No response after repeated tries' }).check();
  await panel.getByRole('button', { name: 'Move to Junk' }).click();
  await expect(column(page, '5').locator('.board-card')).toContainText('Raghav Sharma');
});

test('dropping a card back on its own column changes nothing', async ({ employeePage: page }) => {
  await page.goto('/dashboard/board');
  let moves = 0;
  page.on('request', request => { if (request.url().endsWith('/api/board/move')) moves++; });
  await raghav(page).dragTo(column(page, '1'));
  await expect(column(page, '1').locator('.board-card')).toContainText('Raghav Sharma');
  expect(moves).toBe(0);
  await expect(page.getByRole('complementary')).toHaveCount(0);
});

test('the column under a dragged card is highlighted until the drag ends', async ({ employeePage: page }) => {
  await page.goto('/dashboard/board');
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await raghav(page).dispatchEvent('dragstart', { dataTransfer: transfer });
  await column(page, '3').dispatchEvent('dragover', { dataTransfer: transfer });
  await expect(column(page, '3')).toHaveClass(/drop-target/);
  await expect(column(page, '1')).not.toHaveClass(/drop-target/);
  await raghav(page).dispatchEvent('dragend', { dataTransfer: transfer });
  await expect(column(page, '3')).not.toHaveClass(/drop-target/);
});

test('a drop that cannot be saved explains why and leaves the card in place', async ({ employeePage: page }) => {
  await page.goto('/dashboard/board');
  sql(`update bolna_assignments set remarks='changed elsewhere', revision=revision+1 where id=1`);
  await raghav(page).dragTo(column(page, '3'));
  await expect(page.locator('.snackbar')).toContainText('changed');
  await expect(column(page, '1').locator('.board-card')).toContainText('Raghav Sharma');
  expect(stages(page)).toBe('inbound,inbound');
});
