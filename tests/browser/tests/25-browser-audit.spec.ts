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
