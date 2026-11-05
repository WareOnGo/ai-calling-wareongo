import { test, expect } from './fixtures';
import { execFileSync } from 'node:child_process';
import { CONTAINER } from '../lib/env.mjs';
import { unreadableText } from '../lib/visual-audit';

// Seed: Raghav (priya) = tasks 1 and 5 on one phone, in Inbound; Suresh (raj) = task 4.
const sql = (statement: string) => execFileSync('podman', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-c', statement]);
/** Unanswered calls on `days` distinct IST days before today, attributed to the task's caller. */
const strikes = (taskId: number, days: number) => sql(`insert into bolna_manual_attempts(id,assignment_id,actor,assignee,occurred_at,disposition,request_hash)
  select gen_random_uuid(),a.id,a.assignee,a.assignee,((now() at time zone 'Asia/Kolkata')::date - g + time '12:00') at time zone 'Asia/Kolkata','no_answer','fixture'
  from bolna_assignments a cross join generate_series(1,${days}) g where a.id=${taskId}`);
const raghav = (page: any) => page.locator('.board-columns .board-card').filter({ hasText: 'Raghav Sharma' });
const digest = (page: any) => page.getByRole('region', { name: 'Junk proposals' });

test('logging a no-answer from the panel adds one strike per day', async ({ employeePage: page }) => {
  await page.goto('/dashboard/board');
  await raghav(page).click();
  const panel = page.getByRole('complementary');
  await panel.getByRole('button', { name: 'Log a no-answer call' }).click();
  await expect(panel.locator('.board-panel-note')).toHaveText('Logged. 1 of 5 strikes.');
  await expect(raghav(page).locator('.board-strikes')).toHaveAttribute('aria-label', '1 of 5 strikes');
  await panel.getByRole('button', { name: 'Log a no-answer call' }).click();
  await expect(panel.locator('.board-panel-note')).toHaveText('Already counted today. Strikes count days, not calls.');
});

test('five strikes put a card up for review without moving it, and confirming moves it to Junk', async ({ employeePage: page, shot }) => {
  strikes(1, 5);
  await page.goto('/dashboard/board');
  await expect(digest(page)).toContainText('1 lead has 5 strikes and is proposed for Junk. Nothing moves until you confirm.');
  await expect(raghav(page)).toContainText('Proposed for Junk');
  await expect(page.locator('.board-column[data-code="1"] .board-card')).toContainText('Raghav Sharma');
  await digest(page).getByRole('button', { name: 'Review 1 lead' }).click();
  const dialog = page.getByRole('dialog', { name: 'Review Junk proposals' });
  await expect(dialog.locator('.board-proposal')).toHaveCount(1);
  await expect(dialog.locator('.board-proposal')).toContainText('5 strikes');
  await shot(page, 'board-junk-review');
  await dialog.getByRole('button', { name: 'Move Raghav Sharma to Junk' }).click();
  await expect(dialog.locator('.board-proposal')).toHaveCount(0);
  await expect(dialog).toContainText('No leads waiting for review');
  await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(digest(page)).toHaveCount(0);
  await expect(page.locator('.board-column[data-code="5"] .board-card')).toContainText('Raghav Sharma');
});

test('keeping a proposed card sets its next follow-up and withdraws the proposal', async ({ employeePage: page }) => {
  strikes(1, 5);
  await page.goto('/dashboard/board');
  await digest(page).getByRole('button', { name: 'Review 1 lead' }).click();
  const dialog = page.getByRole('dialog', { name: 'Review Junk proposals' });
  const due = new Date(Date.now() + 4 * 86400_000).toISOString().slice(0, 10);
  await dialog.getByLabel('Try again on').fill(due);
  await dialog.getByRole('button', { name: 'Keep trying Raghav Sharma' }).click();
  await expect(dialog.locator('.board-proposal')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(digest(page)).toHaveCount(0);
  await expect(raghav(page)).toContainText('Follow up');
  await expect(raghav(page)).not.toContainText('Proposed for Junk');
});

test('callers review only their own proposals; admins review everyone\'s', async ({ employeePage: employee, adminPage: admin }) => {
  strikes(1, 5); strikes(4, 6);
  await employee.goto('/dashboard/board');
  await expect(digest(employee)).toContainText('1 lead has');
  await admin.goto('/dashboard/board');
  await expect(digest(admin)).toContainText('2 leads have');
  await digest(admin).getByRole('button', { name: 'Review 2 leads' }).click();
  const dialog = admin.getByRole('dialog', { name: 'Review Junk proposals' });
  await expect(dialog.locator('.board-proposal').first()).toContainText('Suresh Kumar');
  await expect(dialog.locator('.board-proposal').first()).toContainText('Raj Eval');
});

for (const theme of ['light', 'dark'] as const) {
  test(`strikes and the review dialog stay readable in the ${theme} theme`, async ({ employeePage: page, shot }) => {
    strikes(1, 5); strikes(5, 3);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/dashboard/board');
    if (theme === 'dark') { await page.locator('.theme-toggle').click(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark'); }
    expect(await unreadableText(page, '.dashboard-content')).toEqual([]);
    await shot(page, `board-strikes-${theme}`);
    await digest(page).getByRole('button', { name: 'Review 1 lead' }).click();
    expect(await unreadableText(page, 'dialog')).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Move Raghav Sharma to Junk' })).toBeInViewport();
    await shot(page, `board-junk-review-390-${theme}`);
  });
}
