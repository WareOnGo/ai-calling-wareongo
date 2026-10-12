import { test, expect, bodyOverflowsX } from './fixtures';
import { unreadableText } from '../lib/visual-audit';
import type { Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONTAINER } from '../lib/env.mjs';

const record = 'a0000000-0000-4000-8000-000000000001';
const call = 'c0000000-0000-4000-8000-000000000001';
const aiBatch = 'd0000000-0000-4000-8000-000000000001';
const sql = (input: string) => execFileSync('podman', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1'], { input, stdio: ['pipe', 'ignore', 'pipe'] });

// A catalog is a reproducible collection of real UI states, not a pixel baseline.
// All data comes from the disposable eval database, including retained AI events.
for (const width of [1366, 390]) for (const theme of ['light', 'dark']) {
  test(`@render dashboard pages and interactions ${width} ${theme}`, async ({ adminPage: page, employeePage, browser }, testInfo) => {
    test.setTimeout(120_000);
    const height = width === 390 ? 844 : 768;
    const output = resolve(process.env.EVAL_RENDER_DIR || 'shots/dashboard-render');
    mkdirSync(output, { recursive: true });
    const captures: object[] = [], errors: string[] = [];
    for (const target of [page, employeePage]) {
      await target.setViewportSize({ width, height });
      await target.addInitScript(value => localStorage.setItem('theme', value), theme);
      target.on('pageerror', error => errors.push(error.message));
    }
    const capture = async (target: Page, name: string, label: string) => {
      await target.evaluate(async () => { await document.fonts.ready; await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))); });
      const metrics = await target.evaluate(() => {
        const visible = (element: Element) => { const bounds = element.getBoundingClientRect(); return bounds.width > 0 && bounds.height > 0 && bounds.top >= 0 && bounds.bottom <= innerHeight; };
        const grid = document.querySelector('.gridwrap')?.getBoundingClientRect();
        const rows = [...document.querySelectorAll('table.sheet tbody tr')].filter(element => visible(element) && (!grid || element.getBoundingClientRect().bottom <= grid.bottom));
        return { visibleRows: rows.length, visibleControls: [...document.querySelectorAll('button,input,select,textarea,summary')].filter(visible).length };
      });
      const file = `${name}-${width}-${theme}.png`;
      await target.screenshot({ path: resolve(output, file), animations: 'disabled' });
      await testInfo.attach(`${name}-${theme}`, { path: resolve(output, file), contentType: 'image/png' });
      captures.push({ name, label, theme, width, height, file, route: new URL(target.url()).pathname, ...metrics });
      // Persist incrementally so an interrupted audit still has useful evidence.
      writeFileSync(resolve(output, `manifest-${width}-${theme}.json`), JSON.stringify(captures, null, 2));
      if (name === 'raw' && width === 1366) expect(metrics.visibleRows, 'useful laptop record density').toBeGreaterThanOrEqual(6);
      expect.soft(await unreadableText(target), `${name}: text contrast`).toEqual([]);
      expect.soft(await bodyOverflowsX(target), `${name}: page overflow`).toBe(false);
      const dialog = target.locator('dialog[open]');
      if (await dialog.count()) {
        const geometry = await dialog.evaluate(element => ({ width: element.clientWidth, content: element.scrollWidth, bottom: element.querySelector('.modal-foot')?.getBoundingClientRect().bottom }));
        expect.soft(geometry.content, `${name}: dialog overflow`).toBeLessThanOrEqual(geometry.width + 1);
        if (geometry.bottom) expect.soft(geometry.bottom, `${name}: footer`).toBeLessThanOrEqual(height);
      }
    };

    sql(`insert into call_batches(id,created_by,state,bolna_batch_id,agent_language,agent_id) values ('${aiBatch}','admin@eval.test','uncertain','render-provider','hindi','b0000000-0000-4000-8000-00000000000a');
      insert into call_batch_items(batch_id,record_id,name,contact_number) values ('${aiBatch}','${record}','Raghav Sharma','+919811100001');
      update bolna_call_logs set batch_id='render-provider' where id='${call}';
      update bolna_assignments set remarks='Owner confirmed availability. Site visit requested.', wh_id='1042', added_to_db=true where entity_type='call' and entity_id='${call}';
      insert into raw_records(source,source_record_id,owner_name,city,area_sqft) select 'catalog','render-'||i,'Warehouse contact '||i,'Pune',3000+i*100 from generate_series(1,15) i;
      insert into raw_phone_numbers(phone_last10,phone) select '989999'||lpad(i::text,4,'0'),'+91989999'||lpad(i::text,4,'0') from generate_series(1,15) i;
      insert into raw_phones(master_id,phone_id,is_primary) select r.id,p.phone_id,true from raw_records r join raw_phone_numbers p on p.phone_last10='989999'||lpad(replace(r.source_record_id,'render-',''),4,'0') where r.source='catalog';`);
    const evidence = { id: call, status: 'no-answer', created_at: '2026-10-10T00:00:00Z', initiated_at: '2026-10-10T03:00:00Z', updated_at: '2026-10-10T03:00:30Z', batch_id: 'render-provider', telephony_data: { provider: 'twilio', provider_call_id: 'render-first', call_type: 'outbound', to_number: '+919811100001', duration: 0 } };
    const retain = (value: object) => sql(`select bolna_record_ai_evidence('${JSON.stringify(value).replaceAll("'", "''")}'::jsonb,'retained')`);
    retain(evidence);
    retain({ ...evidence, status: 'completed', initiated_at: '2026-10-10T04:00:00Z', updated_at: '2026-10-10T04:01:00Z', conversation_duration: 30, transcript: 'user: Warehouse available', telephony_data: { ...evidence.telephony_data, provider_call_id: 'render-second', duration: 30 } });
    retain({...evidence,id:'c0000000-0000-4000-8000-000000000002',status:'completed',telephony_data:{...evidence.telephony_data,provider_call_id:'render-unavailable',to_number:'+919811100002'}});
    retain({...evidence,id:'c0000000-0000-4000-8000-000000000003',status:'completed',telephony_data:{...evidence.telephony_data,provider_call_id:'render-unclear',to_number:'+919811100003'}});
    const assigned = await page.request.post('/api/assignments', { data: { entity_type: 'record', ids: ['a0000000-0000-4000-8000-000000000005'], assignee: 'priya@eval.test' } });
    expect(assigned.ok()).toBe(true);
    const manualBatch = (await assigned.json()).batchId;
    for (const [name, path, label] of [
      ['home', '/dashboard', 'Dashboard overview'],
      ['raw', '/dashboard/raw', 'Raw Dataset: primary record list'],
      ['calls', '/dashboard/calls', 'Call Analytics: primary record list'],
      ['assignments', '/dashboard/assignments', 'Assignment management'],
      ['batches', '/dashboard/batches', 'AI batches'],
      ['manual-batches', '/dashboard/batches?kind=manual', 'Manual batches'],
      ['ai-batch', '/dashboard/batches/ai/' + aiBatch, 'AI batch details'],
      ['manual-batch', '/dashboard/batches/manual/' + manualBatch, 'Manual batch details'],
      ['team', '/dashboard/team', 'Team: performance'],
      ['team-access', '/dashboard/team/access', 'Team: access control'],
    ]) {
      await page.goto(path); await capture(page, name, label);
      if(name==='home'){
        await page.locator('.account-menu > summary').click();
        await capture(page,'account-menu','Navigation: account and view controls');
        await page.keyboard.press('Escape');
      }
      // The member tables and team access list sit below the first viewport.
      // Capture them explicitly instead of auditing only the page introduction.
      if (name === 'ai-batch' || name === 'manual-batch') {
        await page.locator('.batch-grid').scrollIntoViewIfNeeded();
        await capture(page, name + '-members', label + ': member table');
      }
      if (name === 'team-access') {
        await page.getByRole('button', { name: 'Add someone', exact: true }).click();
        await capture(page, 'team-access-add', 'Team access: add a member');
      }
      if (name === 'assignments') {
        await page.locator('.views-menu > summary').click();
        await capture(page, 'saved-views', 'Saved views: menu at the page edge');
        await page.keyboard.press('Escape');
      }
    }

    await page.goto('/dashboard/raw');
    await page.getByRole('button', { name: 'Toggle filters', exact: true }).click();
    await capture(page, 'filters-outcome', 'Filters: call outcome');
    await page.getByRole('tab', { name: 'Property', exact: true }).click();
    await capture(page, 'filters-property', 'Filters: property fields');
    await page.locator('.filter-panel details').filter({ hasText: 'Source' }).locator('summary').click();
    await capture(page, 'filters-options', 'Filters: source choices');
    await page.keyboard.press('Escape');
    if (await page.locator('.filter-panel[open]').count()) await page.getByRole('button', { name: 'Close filters', exact: true }).click();

    await page.getByRole('button', { name: 'Assign', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Assignment preview' })).toBeVisible();
    await capture(page, 'assign-summary', 'Assign records: decision summary');
    await page.getByRole('radio', { name: 'Split across callers', exact: true }).check();
    await page.getByRole('checkbox', { name: 'Priya Eval (priya@eval.test)', exact: true }).check();
    await expect(page.locator('.allocation-split-title')).toBeVisible();
    await capture(page, 'assign-split', 'Assign records: split calls across multiple callers');
    await page.getByText('Inspect selected records and planned actions', { exact: true }).click();
    await page.locator('.allocation-record').first().scrollIntoViewIfNeeded();
    await capture(page, 'assign-inspection', 'Assign records: optional inspection');
    await page.keyboard.press('Escape');

    await page.goto('/dashboard/raw?q=Raghav');
    await page.getByRole('button', { name: 'Show AI attempts' }).click();
    await expect(page.locator('.attempt-card')).toHaveCount(2);
    await capture(page, 'ai-history', 'AI attempts: timeline drawer');
    await page.locator('.attempt-card').first().getByText('Provider details', { exact: true }).click();
    await capture(page, 'ai-evidence', 'AI attempts: optional provider evidence');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Details for record', exact: true }).click();
    await expect(page.locator('.detail-facts').first()).toBeVisible();
    await capture(page, 'record-details', 'Record details: property and history');
    await page.locator('.detail-listings').first().locator('summary').click();
    await page.locator('.detail-listing').first().scrollIntoViewIfNeeded();
    await capture(page, 'record-listings', 'Record details: separate source listings');
    await page.getByRole('tab', { name: 'AI activity', exact: true }).click();
    await expect(page.locator('.record-details-dialog .history-summary')).toBeVisible();
    await capture(page, 'record-ai', 'Record details: AI activity and recording');
    await page.getByRole('tab', { name: 'Manual activity', exact: true }).click();
    await capture(page, 'record-manual', 'Record details: manual calls and verification');
    await page.keyboard.press('Escape');

    await page.goto('/dashboard/raw?q=Latha');
    await page.locator('.rowsel').check();
    await page.getByRole('button', { name: /^Queue for calling/ }).click();
    await expect(page.getByRole('region', { name: 'Calling summary' })).toBeVisible();
    await expect(page.locator('dialog .wallet-readout')).toContainText('42.42');
    await capture(page, 'queue-review', 'Queue for calling: no eligible contacts');
    await page.keyboard.press('Escape');

    await page.goto('/dashboard/raw');
    await page.locator('.selall').check();
    await page.getByRole('button', { name: /^Queue for calling/ }).click();
    await expect(page.getByRole('region', { name: 'Calling summary' })).toBeVisible();
    await expect(page.locator('dialog .wallet-readout')).toContainText('42.42');
    await capture(page, 'queue-ready', 'Queue for calling: eligibility summary');
    await page.locator('.queue-previous summary').click();
    await capture(page, 'queue-outcomes', 'Queue for calling: optional previous outcomes');
    await page.locator('.queue-previous summary').click();
    await page.locator('.queue-contacts summary').click();
    await page.locator('.queue-contact').first().scrollIntoViewIfNeeded();
    await capture(page, 'queue-contacts', 'Queue for calling: optional contact review');
    await page.locator('.queue-contacts summary').click();
    await page.getByRole('button', { name: /Send to Bolna/ }).click();
    await page.locator('.queue-overview').scrollIntoViewIfNeeded();
    await capture(page, 'queue-confirm', 'Queue for calling: explicit call confirmation');
    await page.keyboard.press('Escape');

    await employeePage.goto('/dashboard/my');
    await capture(employeePage, 'my-work', 'My Work: calling assignments');
    const task = employeePage.locator('[data-entity="record"] tbody tr').filter({ hasText: 'Raghav' });
    await task.getByRole('button', { name: 'Log manual call' }).click();
    await capture(employeePage, 'manual-call', 'Manual call: recording a result');
    await employeePage.keyboard.press('Escape');
    await employeePage.getByRole('button', { name: 'Toggle filters', exact: true }).click();
    await capture(employeePage, 'work-filters', 'My Work: extra filters');

    const guest = await browser.newPage({ viewport: { width, height } });
    await guest.addInitScript(value => localStorage.setItem('theme', value), theme);
    await guest.goto('/'); await capture(guest, 'sign-in', 'Sign in'); await guest.close();
    expect(errors).toEqual([]);
  });
}
