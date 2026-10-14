import {test, expect, bodyOverflowsX} from './fixtures';
import {execFileSync} from 'node:child_process';
import {CONTAINER} from '../lib/env.mjs';

const work = (page: any) => page.locator('[data-entity="record"] tbody tr').filter({hasText: 'Raghav Sharma'});
const seed = (statement: string) => execFileSync('podman', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1'], {input: statement});

for (const width of [1366, 390]) for (const dark of [false, true]) {
  test(`visual audit of changed screens at ${width}px in ${dark ? 'dark' : 'light'} mode`, async ({adminPage: page, employeePage, shot}) => {
    const errors: string[] = [];
    for (const p of [page, employeePage]) {p.on('pageerror', e => errors.push(e.message));await p.setViewportSize({width, height: width === 390 ? 844 : 768});}
    seed("insert into call_batches(id,created_by,state,bolna_batch_id,agent_language,agent_id) values ('d0000000-0000-4000-8000-000000000001','admin@eval.test','uncertain','audit-provider','hindi','b0000000-0000-4000-8000-00000000000a'); insert into call_batch_items(batch_id,record_id,name,contact_number) values ('d0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','Raghav Sharma','+919811100001'); update bolna_call_logs set batch_id='audit-provider' where id='c0000000-0000-4000-8000-000000000001'");
    const assigned = await page.request.post('/api/assignments', {data: {entity_type: 'record', ids: ['a0000000-0000-4000-8000-000000000005'], assignee: 'priya@eval.test'}});
    expect(assigned.status()).toBe(200);const batch = await assigned.json();expect(batch.assigned).toBe(1);
    await page.goto('/dashboard/raw');if (dark) await page.getByRole('button', {name: 'Toggle dark mode'}).click();
    for (const [name, path] of [
      ['raw', '/dashboard/raw'], ['calls', '/dashboard/calls'], ['assignments', '/dashboard/assignments'], ['team', '/dashboard/team'],
      ['batch-list', '/dashboard/batches?kind=manual'], ['manual-batch', '/dashboard/batches/manual/' + batch.batchId], ['ai-batch', '/dashboard/batches/ai/d0000000-0000-4000-8000-000000000001'],
    ]) {
      await page.goto(path);expect.soft(await bodyOverflowsX(page), name + ' page overflow').toBe(false);
      await shot(page, 'audit-' + name + '-' + width + '-' + (dark ? 'dark' : 'light'));
    }
    await employeePage.goto('/dashboard/my');if (dark) await employeePage.getByRole('button', {name: 'Toggle dark mode'}).click();
    expect.soft(await bodyOverflowsX(employeePage)).toBe(false);await shot(employeePage, 'audit-my-' + width + '-' + (dark ? 'dark' : 'light'));
    expect(errors).toEqual([]);
  });
}

test('manual call dialog keeps its header and save controls reachable on short mobile screens', async ({employeePage: page, shot}) => {
  await page.setViewportSize({width: 390, height: 640});await page.goto('/dashboard/my');
  const trigger = work(page).getByRole('button', {name: 'Log manual call'});await trigger.click();
  const dialog = page.getByRole('dialog');await expect(dialog).toBeVisible();
  await shot(page, 'audit-manual-dialog-short');
  const geometry = await dialog.evaluate(el => {
    const head = el.querySelector('.modal-head')!.getBoundingClientRect(), foot = el.querySelector('.modal-foot')!.getBoundingClientRect();
    return {head: head.top, foot: foot.bottom, viewport: innerHeight, scrollWidth: el.scrollWidth, width: el.clientWidth};
  });
  expect.soft(geometry.head).toBeGreaterThanOrEqual(0);
  expect.soft(geometry.foot).toBeLessThanOrEqual(geometry.viewport);
  expect.soft(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1);
  await page.setViewportSize({width: 320, height: 568});
  const narrow = await dialog.evaluate(el => ({bottom: el.querySelector('.modal-foot')!.getBoundingClientRect().bottom, viewport: innerHeight}));
  await shot(page, 'audit-manual-dialog-320');expect.soft(narrow.bottom).toBeLessThanOrEqual(narrow.viewport);
  await dialog.getByLabel('Attempt notes').fill('Mobile calling notes stay accessible.');
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();
  await page.getByRole('button', {name: 'Toggle dark mode'}).click();await trigger.click();
  const notes = dialog.getByLabel('Attempt notes');await notes.fill('Readable notes in the dark theme.');await shot(page, 'audit-manual-dialog-320-dark');
  expect(await notes.evaluate(el => getComputedStyle(el).color)).toBe(await dialog.evaluate(el => getComputedStyle(el).color));
  await dialog.getByRole('button', {name: 'Record attempt'}).click();await expect(dialog).toHaveCount(0);
});

test('a new manual attempt does not inherit a previous call or correction values', async ({employeePage: page, shot}) => {
  await page.goto('/dashboard/my');await work(page).getByRole('button', {name: 'Log manual call'}).click();
  let dialog = page.getByRole('dialog');await dialog.getByLabel('What happened?').selectOption('no_answer');
  await dialog.getByLabel('Reported duration').fill('17');await dialog.getByRole('combobox', {name: 'Manual result', exact: true}).selectOption('Unavailable');
  await dialog.getByLabel('Next follow-up').fill(new Date(Date.now() + 86400000).toLocaleString('sv-SE', {timeZone: 'Asia/Kolkata'}).replace(' ', 'T').slice(0, 16));
  await dialog.getByLabel('Attempt notes').fill('An earlier attempt for correction.');await dialog.getByRole('button', {name: 'Record attempt'}).click();await expect(dialog).toHaveCount(0);
  await work(page).getByRole('button', {name: 'Log manual call'}).click();dialog = page.getByRole('dialog');
  await expect.soft(dialog.getByLabel('What happened?')).toHaveValue('connected');
  const event = dialog.getByRole('combobox', {name: 'Event', exact: true});await expect(event.locator('option')).toHaveCount(2);
  await event.selectOption({index: 1});await expect(dialog.getByLabel('Reported duration')).toHaveValue('17');
  await dialog.getByLabel('Why is this correction needed?').fill('The earlier attempt needs an amended result.');
  await event.selectOption('');await shot(page, 'audit-manual-new-after-correction');
  await expect.soft(dialog.getByLabel('What happened?')).toHaveValue('connected');
  await expect.soft(dialog.getByRole('combobox', {name: 'Manual result', exact: true})).toHaveValue('');
  await expect.soft(dialog.getByLabel('Reported duration')).toHaveValue('');
  await expect.soft(dialog.getByLabel('Attempt notes')).toHaveValue('');
  await expect(dialog.getByLabel('Next follow-up')).toHaveValue('');
  const sent = page.waitForRequest(r => r.url().endsWith('/api/assignments/1/attempts') && r.method() === 'POST');
  await dialog.getByRole('button', {name: 'Record attempt'}).click();const payload = (await sent).postDataJSON();await expect(dialog).toHaveCount(0);
  expect(payload).toMatchObject({disposition: 'connected', duration_seconds: null, notes: '', next_due_at: null});expect(payload.corrects_id).toBeUndefined();expect(payload.outcome).toBeUndefined();
  const history = await (await page.request.get('/api/assignments/1/attempts')).json();expect(history.rows).toHaveLength(2);
  expect(history.rows.filter((e: any) => e.duration_seconds === 17)).toHaveLength(1);
});

test('manual history failures are visible and retry preserves a new attempt draft', async ({employeePage: page, shot}) => {
  seed("insert into bolna_manual_attempts(id,assignment_id,actor,assignee,occurred_at,disposition,request_hash) values (gen_random_uuid(),1,'priya@eval.test','priya@eval.test',now(),'connected','audit')");
  await page.goto('/dashboard/my');let failed = true;
  await page.route('**/api/assignments/1/attempts', route => route.request().method() === 'GET' && failed ? route.fulfill({status: 503, json: {error: 'History temporarily unavailable'}}) : route.continue());
  await work(page).getByRole('button', {name: 'Log manual call'}).click();const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Attempt notes').fill('Keep this draft while history recovers.');
  await expect(dialog.getByRole('alert')).toContainText(/history/i);
  await shot(page, 'audit-manual-history-error');
  failed = false;await dialog.getByRole('button', {name: 'Retry history'}).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);await expect(dialog.getByLabel('Attempt notes')).toHaveValue('Keep this draft while history recovers.');
  await expect(dialog.getByRole('combobox', {name: 'Event', exact: true}).locator('option')).toHaveCount(2);
});

test('retrying a manual call after a lost success response records exactly one attempt', async ({employeePage: page}) => {
  await page.goto('/dashboard/my');let loseResponse = true;const ids: string[] = [];
  let release!: () => void;const gate = new Promise<void>(resolve => release = resolve);
  await page.route('**/api/assignments/1/attempts', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    ids.push(route.request().postDataJSON().id);
    if (!loseResponse) return route.continue();
    loseResponse = false;const saved = await route.fetch();expect(saved.status()).toBe(200);
    await gate;
    await route.fulfill({status: 503, json: {error: 'Response interrupted. Retry the same attempt.'}});
  });
  await work(page).getByRole('button', {name: 'Log manual call'}).click();const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Attempt notes').fill('One real call despite a lost response.');await dialog.getByLabel('Reported duration').fill('31');
  await dialog.getByRole('button', {name: 'Record attempt'}).click();
  try {
    await expect(dialog.getByRole('button', {name: 'Saving…'})).toBeDisabled();await expect(dialog.getByLabel('Attempt notes')).toBeDisabled();
    await expect(dialog.getByRole('button', {name: 'Close', exact: true})).toBeDisabled();await page.keyboard.press('Escape');await expect(dialog).toBeVisible();
  } finally {release();}
  await expect(dialog.getByRole('alert')).toContainText(/couldn't confirm|could not confirm/i);
  await expect(dialog.getByLabel('Attempt notes')).toHaveValue('One real call despite a lost response.');await expect(dialog.getByLabel('Reported duration')).toHaveValue('31');
  await dialog.getByRole('button', {name: 'Record attempt'}).click();await expect(dialog).toHaveCount(0);
  expect(ids).toHaveLength(2);expect(ids[0]).toBe(ids[1]);
  const history = await (await page.request.get('/api/assignments/1/attempts')).json();expect(history.rows).toHaveLength(1);expect(history.rows[0].duration_seconds).toBe(31);
});

test('closing and reopening manual history ignores the older delayed response', async ({employeePage: page}) => {
  seed("insert into bolna_manual_attempts(id,assignment_id,actor,assignee,occurred_at,disposition,request_hash) values (gen_random_uuid(),1,'priya@eval.test','priya@eval.test',now(),'connected','audit')");
  await page.goto('/dashboard/my');let first = true, release!: () => void, started!: () => void, finished!: () => void;
  const gate = new Promise<void>(resolve => release = resolve), arrived = new Promise<void>(resolve => started = resolve), done = new Promise<void>(resolve => finished = resolve);
  await page.route('**/api/assignments/1/attempts', async route => {
    if (!first || route.request().method() !== 'GET') return route.continue();
    first = false;started();await gate;
    try {await route.fulfill({json: {rows: []}});} catch { /* Closing the dialog aborts this request. */ } finally {finished();}
  });
  const trigger = work(page).getByRole('button', {name: 'Log manual call'});await trigger.click();await arrived;
  try {
    await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await trigger.click();
    await expect(page.getByRole('dialog').getByRole('combobox', {name: 'Event', exact: true}).locator('option')).toHaveCount(2);
    await page.getByRole('dialog').getByLabel('Attempt notes').fill('The reopened draft remains current.');
  } finally {release();}
  await done;await expect(page.getByRole('dialog').getByRole('combobox', {name: 'Event', exact: true}).locator('option')).toHaveCount(2);
  await expect(page.getByRole('dialog').getByLabel('Attempt notes')).toHaveValue('The reopened draft remains current.');
});

test('open multi-select menus fit the mobile viewport and support keyboard dismissal', async ({adminPage: page, shot}) => {
  await page.setViewportSize({width: 390, height: 844});
  for (const path of ['/dashboard/raw', '/dashboard/calls', '/dashboard/assignments']) {
    await page.goto(path);await page.getByRole('button', {name: 'Toggle filters', exact: true}).click();
    const tabs=page.getByRole('tab');
    for(let category=0;category<Math.max(1,await tabs.count());category++){
    if(await tabs.count())await tabs.nth(category).click();
    const menus = page.locator('.filter-panel details.filter-multi:visible');
    for (let i = 0; i < await menus.count(); i++) {
      const menu = menus.nth(i), summary = menu.locator('summary');await summary.click();
      const box = await menu.locator('fieldset').boundingBox();
      expect.soft(box!.x, path + ' menu ' + i + ' left').toBeGreaterThanOrEqual(0);
      expect.soft(box!.x + box!.width, path + ' menu ' + i + ' right').toBeLessThanOrEqual(390);
      expect.soft(await bodyOverflowsX(page), path + ' menu ' + i + ' body overflow').toBe(false);
      if (i === 1) await shot(page, 'audit-open-filter-' + path.split('/').at(-1));
      if (path === '/dashboard/calls' && i === 0) await shot(page, 'audit-open-filter-calls-result');
      await summary.click();
    }
    }
  }
  await page.getByRole('tab').first().click();
  const summary = page.locator('.filter-panel details.filter-multi:visible').first().locator('summary');await summary.focus();await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');await page.keyboard.press('Escape');
  await expect(page.locator('details.filter-multi[open]')).toHaveCount(0);await expect(summary).toBeFocused();
});

test('primary action text remains readable in both themes before and during hover', async ({employeePage: page}) => {
  await page.goto('/dashboard/my');
  for (const dark of [false, true]) {
    if (dark) await page.getByRole('button', {name: 'Toggle dark mode'}).click();
    await work(page).getByRole('button', {name: 'Log manual call'}).click();
    const button = page.getByRole('dialog').getByRole('button', {name: 'Record attempt'});
    for (const hover of [false, true]) {
      if (hover) await button.hover();else await page.mouse.move(0, 0);
      const contrast = await button.evaluate(el => {
        const style = getComputedStyle(el);
        const luminance = (color: string) => color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(v => {v /= 255;return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);}).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
        const a = luminance(style.color), b = luminance(style.backgroundColor);return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      });
      expect.soft(contrast, `${dark ? 'dark' : 'light'} theme, hover=${hover}`).toBeGreaterThanOrEqual(4.5);
    }
    await page.keyboard.press('Escape');
  }
});
