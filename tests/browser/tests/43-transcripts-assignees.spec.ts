import { test, expect, bodyOverflowsX } from './fixtures';
import { unreadableText } from '../lib/visual-audit';
import { execFileSync } from 'node:child_process';
import { CONTAINER } from '../lib/env.mjs';

const batch = 'b0000000-0000-4000-8000-000000000043';
const sql = (input: string) => execFileSync('podman', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1'], { input, stdio: ['pipe', 'ignore', 'pipe'] });
const messages = [
  ['assistant', 'Hello! आपकी warehouse property अभी भी available है?'],
  ['user', "Yes ma’am, it is available."],
  ['assistant', 'मैं Priya बोल रही हूँ Bangalore से। हम companies के लिए commercial spaces source करते हैं। क्या आप area और rent की details share कर सकते हैं?'],
  ['user', 'The warehouse is available for a visit.\nPlease send your requirements on WhatsApp.'],
  ['assistant', 'Perfect, please do — मैं इसी number पर text भेज दूँगी।'],
  ['user', 'Okay, thank you.'],
];

function seedTranscript() {
  const payload = { id: 'c0000000-0000-4000-8000-000000000001', status: 'completed', initiated_at: '2026-10-14T10:00:00Z', transcript: messages.map(([role,text])=>`${role}: ${text}`).join('\n'), telephony_data: { provider_call_id: 'chat-bubbles', call_type: 'outbound', to_number: '+919811100001', duration: 80 } };
  sql(`select bolna_record_ai_evidence('${JSON.stringify(payload).replaceAll("'", "''")}'::jsonb,'retained')`);
}
function seedBatch() {
  sql(`insert into bolna_assignment_batches(id,intent_key,created_by,created_at,entity_type,distribution,assignees,selection,request_hash)
    values('${batch}','${batch}','admin@eval.test','2026-10-14T19:30:00Z','record','single',array['priya@eval.test'],'{}','preview-fixture');
    update bolna_assignments set assigned_at='2026-10-14T19:30:00Z',batch_id='${batch}' where id in(1,2);
    update bolna_assignments set completed_at='2026-10-15T19:30:00Z' where id=2;
    insert into bolna_assignment_batch_items(batch_id,entity_id,assignment_id,disposition,assignee,phones)
      select '${batch}',entity_id,id,'assign',assignee,array[]::text[] from bolna_assignments where id in(1,2);`);
}

for (const width of [1366, 390]) for (const theme of ['light', 'dark']) {
  test(`transcripts read as chat bubbles at ${width}px in ${theme}`, async ({ adminPage: page, shot }) => {
    seedTranscript();
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(theme=>localStorage.setItem('theme',theme), theme);
    await page.goto('/dashboard/raw?q=Raghav');
    await page.getByRole('button', { name: 'Show AI attempts', exact: true }).click();
    const transcript = page.getByRole('dialog').getByRole('list', { name: 'Call transcript', exact: true });
    await page.locator('.attempt-transcript > summary').click();
    await expect(transcript.locator('.transcript-bubble')).toHaveText(messages.map(([,text])=>text));
    await expect(transcript.locator('.transcript-speaker')).toHaveText(['AI agent','Caller','AI agent','Caller','AI agent','Caller']);
    const positions = await transcript.locator('.transcript-turn').evaluateAll(elements=>elements.map(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right})));
    expect(positions[1].left).toBeGreaterThan(positions[0].left);
    expect(positions[1].right).toBeGreaterThan(positions[0].right);
    await transcript.locator('.transcript-bubble').first().scrollIntoViewIfNeeded();
    expect(await bodyOverflowsX(page)).toBe(false);
    expect(await unreadableText(page)).toEqual([]);
    await shot(page, `transcript-bubbles-${width}-${theme}`);
    await transcript.locator('.transcript-bubble').last().scrollIntoViewIfNeeded();
    await expect(transcript.locator('.transcript-bubble').last()).toBeInViewport();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Show AI attempts', exact: true })).toBeFocused();
  });

  test(`assignee cards show attribution, completion dates and their batch at ${width}px in ${theme}`, async ({ adminPage: page, shot }) => {
    seedBatch();
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(theme=>localStorage.setItem('theme',theme), theme);
    await page.goto('/dashboard/assignments');
    const row = page.locator('tbody tr').filter({ hasText: 'Meera Nair' });
    const card = row.locator('.assignee-card');
    await expect(card).toContainText('Priya Eval');
    await expect(card).toContainText('Assigned by Eval Admin on 15 Oct 26');
    await expect(card).not.toContainText('@');
    await expect(row.locator('.assignment-completed')).toHaveText('16 Oct 26');
    await expect(page.locator('tbody tr').filter({hasText:'Raghav Sharma'}).locator('.assignment-completed')).toHaveCount(0);
    await card.scrollIntoViewIfNeeded();
    await shot(page, `assignee-cards-${width}-${theme}`);
    await card.focus(); await page.keyboard.press('Enter');
    const modal = page.getByRole('dialog', { name: 'Assignment batch', exact: true });
    await expect(modal.getByRole('list', { name: 'Batch records' }).locator('li')).toHaveCount(2);
    await expect(modal.locator('.assignment-batch-progress')).toContainText('2 assignments');
    await expect(modal.locator('.assignment-batch-progress')).toContainText('1 open');
    await expect(modal.locator('.assignment-batch-progress')).toContainText('1 done');
    await expect(modal.getByRole('link', { name: 'Open full batch', exact: true })).toHaveAttribute('href', `/dashboard/batches/manual/${batch}`);
    await expect(modal).toContainText('Meera Nair');
    await expect(modal).toContainText('Raghav Sharma');
    expect(await modal.evaluate(el=>el.scrollWidth > el.clientWidth+1)).toBe(false);
    expect(await bodyOverflowsX(page)).toBe(false);
    expect(await unreadableText(page)).toEqual([]);
    await shot(page, `assignment-batch-modal-${width}-${theme}`);
    await page.keyboard.press('Escape');
    await expect(card).toBeFocused();
    await expect(page).toHaveURL(/\/dashboard\/assignments$/);
  });
}

test('legacy assignment cards retain name fallbacks and show only the selected assignment', async ({ adminPage: page, employeePage }) => {
  sql("update bolna_app_users set name=null where email in('admin@eval.test','priya@eval.test')");
  await page.goto('/dashboard/assignments?q=Meera');
  const card=page.locator('.assignee-card');
  await expect(card.locator('.assignee-name')).toHaveText('priya');
  await expect(card).toContainText('Assigned by admin');
  await expect(card).not.toContainText('@');
  await expect(page.locator('.assignment-completed')).toHaveText('Date not recorded');
  await card.click();
  const modal=page.getByRole('dialog',{name:'Assignment details',exact:true});
  await expect(modal).toContainText('This assignment has no recorded batch.');
  await expect(modal).toContainText('Meera Nair');
  await expect(modal).not.toContainText('Raghav Sharma');
  await expect(modal.getByRole('link',{name:'Open full batch',exact:true})).toHaveCount(0);
  expect((await employeePage.request.get('/api/assignments/2/batch')).status()).toBe(403);
  expect((await page.request.get('/api/assignments/99999999/batch')).status()).toBe(404);
  expect((await page.request.get('/api/assignments/not-an-id/batch')).status()).toBe(400);
  expect((await page.request.get('/api/assignments/2/batch?page=0')).status()).toBe(400);
});

test('batch previews recover from loading errors and paginate all members', async ({ adminPage: page }) => {
  seedBatch();
  sql(`insert into bolna_assignment_batch_items(batch_id,entity_id,disposition,phones) select '${batch}',md5('preview-extra-'||n)::uuid,'missing_phone',array[]::text[] from generate_series(1,51) n`);
  let fail=true;
  await page.route('**/api/assignments/*/batch?*',async route=>{
    if(fail){fail=false;await route.fulfill({status:503,json:{error:'Temporary failure'}});}else await route.continue();
  });
  await page.goto('/dashboard/assignments?q=Meera');
  await page.locator('.assignee-card').click();
  const modal=page.getByRole('dialog');
  await expect(modal.getByRole('alert')).toBeVisible();
  await modal.getByRole('button',{name:'Retry batch details'}).click();
  await expect(modal.locator('.assignment-batch-members > li')).toHaveCount(50);
  await expect(modal.getByRole('navigation',{name:'Batch record pages'})).toContainText('Page 1 of 2');
  await modal.getByRole('button',{name:'Next records'}).click();
  await expect(modal.locator('.assignment-batch-members > li')).toHaveCount(3);
  await expect(modal.getByRole('navigation',{name:'Batch record pages'})).toContainText('Page 2 of 2');
  await expect(modal.getByRole('button',{name:'Next records'})).toBeDisabled();
  await modal.getByRole('button',{name:'Previous records'}).click();
  await expect(modal.locator('.assignment-batch-members > li')).toHaveCount(50);
  await page.keyboard.press('Escape');
  await expect(page.locator('.assignee-card')).toBeFocused();
  await expect(page).toHaveURL(/q=Meera$/);
});

for (const currentCaller of [false, true]) test(`caller assignments link closes the modal when already filtered: ${currentCaller}`, async ({ adminPage: page }) => {
  await page.goto(currentCaller ? '/dashboard/assignments?assignee=priya%40eval.test' : '/dashboard/assignments?q=Meera');
  await page.locator('tbody tr').filter({hasText:'Meera Nair'}).locator('.assignee-card').click();
  const modal=page.getByRole('dialog',{name:'Assignment details',exact:true});
  const link=modal.getByRole('link',{name:'View this caller’s assignments',exact:true});
  if(currentCaller) {await link.focus();await page.keyboard.press('Enter');} else await link.click();
  await expect(modal).toHaveCount(0);
  await expect(page).toHaveURL(/\/dashboard\/assignments\?assignee=priya%40eval.test$/);
  await expect(page.locator('tbody tr')).toHaveCount(4);
  await expect(page.locator('.assignment-sheet:visible > tbody')).not.toContainText('Suresh Kumar');
  await page.locator('tbody tr').filter({hasText:'Meera Nair'}).locator('.assignee-card').click();
  await expect(modal).toBeVisible();
  await modal.getByRole('button',{name:'Close',exact:true}).last().click();
  await expect(modal).toHaveCount(0);
});

test('full batch navigation dismisses the assignment modal', async ({adminPage:page})=>{
  seedBatch();await page.goto('/dashboard/assignments?q=Meera');await page.locator('.assignee-card').click();
  await page.getByRole('dialog').getByRole('link',{name:'Open full batch',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(`/dashboard/batches/manual/${batch}`);
  await expect(page.locator('.batch-grid tbody tr')).toHaveCount(2);
});
