import { test, expect } from './fixtures';
import { execFileSync } from 'node:child_process';
import { CONTAINER } from '../lib/env.mjs';
import { unreadableText } from '../lib/visual-audit';

// Seed ids: 1 Raghav listing + 5 Raghav AI follow-up (priya, same phone), 2 Meera (priya, done),
// 4 Suresh (raj, open). With no stage set, Raghav is one Inbound card with two tasks.
const sql = (statement: string) => execFileSync('podman', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-c', statement]);
const column = (page: any, code: string) => page.locator(`.board-column[data-code="${code}"]`);
const cardButton = (page: any, name: string) => page.locator('.board-columns .board-card').filter({ hasText: name });
const panel = (page: any) => page.getByRole('complementary');
const stage = (page: any) => panel(page).getByRole('combobox', { name: 'Stage' });
/** Choose a stage in the dropdown, then confirm: a dropdown alone never moves a card. */
const moveTo = async (page: any, value: string, short: string) => {
  await stage(page).selectOption(value);
  await panel(page).getByRole('button', { name: `Move to ${short}` }).click();
};

/** The value beside a label in the panel's aligned detail lists. */
const fact = (page: any, label: string) => panel(page).locator('.board-facts > div')
  .filter({ has: page.locator('dt', { hasText: new RegExp(`^${label.replace(/[?]/g, '\\?')}$`) }) }).locator('dd');

test('the panel reads top-down: the lead, the next step, the task, then activity', async ({ employeePage: page, shot }) => {
  await page.goto('/dashboard/board');
  await cardButton(page, 'Raghav Sharma').click();
  await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Raghav Sharma');
  await expect(panel(page)).toContainText('+919811100001');
  await expect(panel(page).locator('.board-panel-status')).toContainText('1 Inbound');
  // City, state and size are the lead's key facts, labelled and at body size under the phone.
  const keyFact = (label: string) => panel(page).locator('.board-keyfacts > div').filter({ has: page.locator('dt', { hasText: label }) }).locator('dd');
  await expect(keyFact('City')).toHaveText('Rajkot');
  await expect(keyFact('State')).toHaveText('Gujarat');
  await expect(keyFact('Size')).toHaveText('12,000 sqft');
  // The close control is a clear icon button with a 32px target.
  const close = panel(page).getByRole('button', { name: 'Close lead' });
  await expect(close.locator('svg')).toBeVisible();
  const box = (await close.boundingBox())!;
  expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(32);
  await expect(cardButton(page, 'Raghav Sharma')).toHaveAttribute('aria-expanded', 'true');
  await expect(stage(page)).toHaveValue('inbound');
  await expect(panel(page).getByRole('button', { name: /Move to/ })).toHaveCount(0);
  await expect(panel(page).getByRole('heading', { level: 3 })).toHaveText(['Next step', 'Your notes', 'Listing details', 'Calls', 'Activity']);
  // Two tasks on one phone are tabs, not two stacked copies of the same layout.
  await expect(panel(page).getByRole('tab')).toHaveText(['Listing', 'AI follow-up']);
  await expect(panel(page).getByRole('tab', { name: 'Listing' })).toHaveAttribute('aria-selected', 'true');
  await expect(panel(page).locator('.board-task')).toHaveCount(1);
  await expect(panel(page).locator('.board-brief')).toContainText('verify area + rent');
  await expect(panel(page).locator('.board-timeline')).toContainText('No activity yet');
  await shot(page, 'board-panel-open');
  // Tall enough to review the whole panel without its scroll cutting it off.
  await page.setViewportSize({ width: 1600, height: 1900 });
  await shot(page, 'board-panel-full');
});

/** Key-fact words split across lines. A value may wrap between words, never inside one. */
const splitWords = (page: any): Promise<string[]> => panel(page).locator('.board-keyfacts dd').evaluateAll((nodes: Element[]) => nodes.flatMap(node => {
  const text = node.firstChild;
  if (!text || text.nodeType !== Node.TEXT_NODE) return [];
  return [...(text.textContent || '').matchAll(/\S+/g)].filter(match => {
    const range = document.createRange();
    range.setStart(text, match.index!);
    range.setEnd(text, match.index! + match[0].length);
    return range.getClientRects().length > 1;
  }).map(match => match[0]);
}));

for (const width of [1366, 390]) {
  test(`long city and state names wrap between words, never inside one, at ${width}px`, async ({ employeePage: page, shot }) => {
    // The card shows its latest task's place: here the AI follow-up call's recipient area.
    sql(`update raw_records set city='Vishakhapatnam', state='Andhra Pradesh' where id='a0000000-0000-4000-8000-000000000001';
         update bolna_call_logs set context_details = jsonb_set(context_details, '{recipient_data,area}', '"vishakhapatnam"')
          where id='c0000000-0000-4000-8000-000000000001'`);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/dashboard/board');
    await cardButton(page, 'Raghav Sharma').click();
    const facts = panel(page).locator('.board-keyfacts');
    await expect(facts).toContainText('Vishakhapatnam');
    expect(await splitWords(page)).toEqual([]);
    // Nothing spills past the panel edge either.
    expect(await facts.evaluate((node: Element) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await shot(page, `board-panel-long-place-${width}`);
  });
}

test('each task shows everything My Work shows for it', async ({ employeePage: page }) => {
  await page.goto('/dashboard/board');
  await cardButton(page, 'Raghav Sharma').click();
  // Property facts, assigner, AI status and the manual work fields, as in My Work's row.
  await expect(fact(page, 'Assigned')).toContainText('Eval Admin');
  await expect(fact(page, 'City')).toHaveText('Rajkot');
  await expect(fact(page, 'Area')).toHaveText('12,000 sqft');
  await expect(fact(page, 'Rent')).toHaveText('₹45,000');
  await expect(fact(page, 'Result')).toHaveText('Not called yet');
  await expect(fact(page, 'In DB?')).toHaveText('Not yet');
  await expect(fact(page, 'WH ID')).toHaveText('—');
  await expect(fact(page, 'Finished?')).toHaveText('Open');
  await expect(fact(page, 'AI calls').locator('.work-ai-status')).toHaveText('AI: Unclear');
  await expect(fact(page, 'AI calls').locator('.work-ai-count')).toHaveText('2 AI calls');
  // Employees do not see manual or Callyzer call records.
  await expect(fact(page, 'Manual calls')).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: /manual calls/i })).toHaveCount(0);
  // AI call history expands inside the panel; nothing opens over it. With no provider
  // attempts recorded, the saved AI summary from the call logs is one click away.
  const showAi = panel(page).getByRole('button', { name: 'Show AI calls' });
  await expect(showAi).toHaveAttribute('aria-expanded', 'false');
  await showAi.click();
  await expect(panel(page).getByRole('button', { name: 'Hide AI calls' })).toHaveAttribute('aria-expanded', 'true');
  const history = panel(page).getByRole('region', { name: 'AI call history' });
  await expect(history).toContainText('No recorded AI calls for this number');
  await history.getByRole('button', { name: 'View saved record details' }).click();
  await expect(history.getByRole('region', { name: 'Saved AI summary' })).toContainText('AI notes');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await panel(page).getByRole('button', { name: 'Hide AI calls' }).click();
  await expect(panel(page).getByRole('region', { name: 'AI call history' })).toHaveCount(0);
  // An employee's full record is My Work's details view, without manual call tabs.
  await panel(page).getByRole('button', { name: 'Details for this listing' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('tab', { name: 'Manual activity' })).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button', { name: 'Close details' }).click();
  // The other task on the same phone has its own facts.
  await panel(page).getByRole('tab', { name: 'AI follow-up' }).click();
  await expect(panel(page).getByRole('heading', { name: 'AI follow-up details' })).toBeVisible();
  await expect(fact(page, 'AI calls').locator('.work-ai-status')).toHaveText('AI: Available');
  await expect(fact(page, 'Area')).toHaveText('12,000 sqft built-up');
});

test('tabs number tasks within their kind', async ({ employeePage: page }) => {
  // A second AI follow-up on Raghav's number: the call made on 5 August.
  sql(`insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state,stage)
       values ('call','c0000000-0000-4000-8000-000000000005','priya@eval.test','admin@eval.test','open','inbound')`);
  await page.goto('/dashboard/board');
  await cardButton(page, 'Raghav Sharma').click();
  await expect(panel(page).getByRole('tab')).toHaveText(['Listing', 'AI follow-up 1', 'AI follow-up 2']);
});

test('saving notes and moving straight away does not report a false conflict', async ({ employeePage: page }) => {
  await page.goto('/dashboard/board');
  await cardButton(page, 'Raghav Sharma').click();
  const notes = panel(page).getByRole('textbox', { name: 'Your notes' });
  // A trailing space is trimmed on save; the button must not stay enabled because of it.
  await notes.fill('Owner asked for a call on Monday ');
  await panel(page).getByRole('button', { name: 'Save notes' }).click();
  await moveTo(page, 'details_collected', 'Details');
  await expect(column(page, '3').locator('.board-card')).toContainText('Raghav Sharma');
  await expect(panel(page).locator('.board-panel-error')).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: 'Save notes' })).toBeDisabled();
});

test('moving a card to an open stage updates the board, the panel and the timeline', async ({ employeePage: page }) => {
  await page.goto('/dashboard/board');
  await cardButton(page, 'Raghav Sharma').click();
  await moveTo(page, 'awaiting_details', 'Awaiting');
  await expect(column(page, '2C').locator('.board-card')).toContainText('Raghav Sharma');
  await expect(column(page, '1').locator('.board-card')).toHaveCount(0);
  await expect(stage(page)).toHaveValue('awaiting_details');
  await expect(panel(page).locator('.board-timeline li').first()).toContainText('Moved to 2C Available, details awaited');
});

test('moving to RnR counts a strike without showing the call record to an employee', async ({ employeePage: page }) => {
  await page.goto('/dashboard/board');
  await cardButton(page, 'Raghav Sharma').click();
  await moveTo(page, 'rnr', 'RnR');
  await expect(column(page, '2A').locator('.board-card')).toContainText('Raghav Sharma');
  await expect(panel(page).locator('.board-panel-status')).toContainText('1 of 5 strikes');
  await expect(panel(page).locator('.board-timeline')).toContainText('Moved to 2A RnR');
  await expect(panel(page).locator('.board-timeline')).not.toContainText('No answer / RNR');
});

test('admins see logged calls and their history in the panel', async ({ adminPage: page }) => {
  // A phone-less listing, so the admin can hold it without phone-ownership conflicts.
  sql(`insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state,stage)
       values ('record','a0000000-0000-4000-8000-000000000006','admin@eval.test','admin@eval.test','open','inbound')`);
  await page.goto('/dashboard/board');
  await cardButton(page, 'No Phone Owner').click();
  await moveTo(page, 'rnr', 'RnR');
  await expect(fact(page, 'Manual calls')).toContainText('1 logged');
  await expect(panel(page).locator('.board-timeline')).toContainText('No answer / RNR');
  await panel(page).getByRole('button', { name: 'Show manual calls' }).click();
  await expect(panel(page).getByRole('region', { name: 'Manual call history' }).locator('.attempt-item')).toContainText(['No answer / RNR']);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('Junk needs a reason before the card moves', async ({ employeePage: page }) => {
  await page.goto('/dashboard/board');
  await cardButton(page, 'Raghav Sharma').click();
  await stage(page).selectOption('junk');
  const confirm = panel(page).getByRole('button', { name: 'Move to Junk' });
  await expect(confirm).toBeDisabled();
  await panel(page).getByRole('radio', { name: 'Wrong or invalid number' }).check();
  await confirm.click();
  await expect(column(page, '5').locator('.board-card')).toContainText('Closed');
  await expect(stage(page)).toHaveValue('junk');
});

test('stage 4 asks which warehouse ID the lead created and rejects malformed IDs', async ({ employeePage: page }) => {
  await page.goto('/dashboard/board');
  await cardButton(page, 'Raghav Sharma').click();
  await stage(page).selectOption('warehouse_created');
  const id = panel(page).getByRole('textbox', { name: 'Warehouse ID' });
  await id.fill('WH-12');
  await panel(page).getByRole('button', { name: 'Move to Warehouse' }).click();
  await expect(panel(page).getByRole('alert')).toHaveText(/positive whole number/);
  await id.fill('4521');
  await panel(page).getByRole('button', { name: 'Move to Warehouse' }).click();
  await expect(column(page, '4').locator('.board-card .board-wh')).toHaveText('1 warehouse');
});

test('notes and the follow-up date save from the panel', async ({ employeePage: page }) => {
  await page.goto('/dashboard/board');
  await cardButton(page, 'Raghav Sharma').click();
  const listing = panel(page).locator('.board-task').first();
  await listing.getByRole('textbox', { name: 'Notes' }).fill('Owner asked to call after Diwali');
  await listing.getByRole('button', { name: 'Save notes' }).click();
  await expect(listing.getByRole('status')).toHaveText('Saved');
  await expect(panel(page).locator('.board-timeline')).toContainText('Owner asked to call after Diwali');
  const due = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);
  await panel(page).getByLabel('Next follow-up').fill(due);
  await panel(page).getByRole('button', { name: 'Save follow-up' }).click();
  await expect(cardButton(page, 'Raghav Sharma')).toContainText('Follow up');
});

test('the keyboard opens a card, Escape closes the panel and focus returns to the card', async ({ employeePage: page }) => {
  await page.goto('/dashboard/board');
  await cardButton(page, 'Raghav Sharma').focus();
  await page.keyboard.press('Enter');
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole('heading', { level: 2 })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0);
  await expect(cardButton(page, 'Raghav Sharma')).toBeFocused();
});

test('clicking another card swaps the panel', async ({ employeePage: page }) => {
  sql(`update bolna_assignments set stage='rejected' where id=2`); // Meera, finished: shown in 2B
  await page.goto('/dashboard/board');
  await cardButton(page, 'Raghav Sharma').click();
  await cardButton(page, 'Meera Nair').click();
  await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Meera Nair');
  await expect(cardButton(page, 'Raghav Sharma')).toHaveAttribute('aria-expanded', 'false');
});

test('a card changed elsewhere reports the conflict instead of overwriting it', async ({ employeePage: page }) => {
  await page.goto('/dashboard/board');
  await cardButton(page, 'Raghav Sharma').click();
  sql(`update bolna_assignments set remarks='changed elsewhere', revision=revision+1 where id=1`);
  await moveTo(page, 'details_collected', 'Details');
  await expect(panel(page).getByRole('alert')).toHaveText(/changed/);
  await expect(column(page, '3').locator('.board-card')).toHaveCount(0);
});

for (const theme of ['light', 'dark'] as const) {
  test(`the panel stays readable on a laptop and a phone in the ${theme} theme`, async ({ employeePage: page, shot }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/dashboard/board');
    if (theme === 'dark') { await page.locator('.theme-toggle').click(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark'); }
    await cardButton(page, 'Raghav Sharma').click();
    await stage(page).selectOption('junk');
    expect(await unreadableText(page, '.dashboard-content')).toEqual([]);
    await shot(page, `board-panel-1366-${theme}`);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(panel(page)).toBeInViewport();
    await expect(panel(page).getByRole('button', { name: 'Close lead' })).toBeInViewport();
    expect(await unreadableText(page, '.dashboard-content')).toEqual([]);
    await shot(page, `board-panel-390-${theme}`);
  });
}
