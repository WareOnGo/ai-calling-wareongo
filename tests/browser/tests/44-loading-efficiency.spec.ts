import { test, expect } from './fixtures';
import { execFileSync } from 'node:child_process';
import { CONTAINER } from '../lib/env.mjs';

const record = 'a0000000-0000-4000-8000-000000000001';
const sql = (input: string) => execFileSync('podman', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1'], { input, stdio: ['pipe', 'ignore', 'pipe'] });

test('Details loads manual evidence on demand and pagination does not refetch the record', async ({ adminPage: page, employeePage }) => {
  sql("insert into bolna_manual_attempts(id,assignment_id,actor,assignee,occurred_at,disposition,request_hash) select gen_random_uuid(),1,'priya@eval.test','priya@eval.test',now()-n*interval '1 minute','connected',n::text from generate_series(1,55) n");
  const requests: string[] = [];
  // Ignore requests aborted by the development-only Strict Mode effect rehearsal.
  page.on('response', response => { if (response.status() === 200 && response.url().includes(`/api/details/record/${record}?`)) requests.push(response.url()); });
  await page.goto('/dashboard/raw?q=Raghav');
  const initialResponse = page.waitForResponse(response => response.url().includes('section=overview'));
  await page.getByRole('button', { name: 'Details for record', exact: true }).click();
  const overview = await (await initialResponse).json();
  expect(overview.row.id).toBe(record); expect(overview.manual).toBeUndefined(); expect(overview.history).toBeUndefined();
  await expect(page.getByRole('dialog')).toContainText('Property');
  expect(requests).toHaveLength(1);
  const manualResponse = page.waitForResponse(response => response.url().includes('section=manual'));
  await page.getByRole('tab', { name: 'Manual activity', exact: true }).click();
  const manual = await (await manualResponse).json();
  expect(manual.row).toBeUndefined(); expect(manual.manual.total).toBe(55);
  await expect(page.getByRole('navigation', { name: 'Manual history pages' })).toContainText('1 / 2');
  await page.getByRole('button', { name: 'Next attempts', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Manual history pages' })).toContainText('2 / 2');
  await page.getByRole('button', { name: 'Previous attempts', exact: true }).click();
  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
  await page.getByRole('tab', { name: 'Manual activity', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Manual history pages' })).toContainText('1 / 2');
  expect(requests.filter(url => url.includes('section=overview'))).toHaveLength(1);
  expect(requests.filter(url => url.includes('section=manual'))).toHaveLength(2);
  expect((await employeePage.request.get('/api/details/record/a0000000-0000-4000-8000-000000000003?section=manual')).status()).toBe(404);
  expect((await employeePage.request.get(`/api/details/record/${record}?section=manual`)).status()).toBe(200);
});

test('balance is shared across navigation and calling dialogs, with one explicit refresh', async ({ adminPage: page }) => {
  let reads = 0;
  await page.route('**/api/balance*', route => route.fulfill({ json: { balance: 50 - ++reads, unit: 'USD', state: 'fresh', refreshedAt: new Date().toISOString(), low: false, message: null } }));
  await page.goto('/dashboard/raw');
  await expect(page.locator('.wallet-balance').first()).toContainText('$49.00 USD');
  await page.locator('.topnav').getByRole('link', { name: 'Batches', exact: true }).click();
  await expect(page.locator('.records-header .page-title:visible')).toHaveText('Batches');
  await expect(page.locator('.wallet-balance:visible').first()).toContainText('$49.00 USD');
  await page.locator('.topnav').getByRole('link', { name: 'Raw Dataset', exact: true }).click();
  await page.locator('.rowsel[data-id="a0000000-0000-4000-8000-000000000005"]').check();
  await page.getByRole('button', { name: /Queue for calling/ }).click();
  await expect(page.getByRole('dialog').locator('.wallet-balance')).toContainText('$49.00 USD');
  expect(reads).toBe(1);
  await page.getByRole('dialog').getByRole('button', { name: 'Refresh balance', exact: true }).click();
  await expect(page.getByRole('dialog').locator('.wallet-balance')).toContainText('$48.00 USD');
  expect(reads).toBe(2);
  await page.keyboard.press('Escape');
  await expect(page.locator('.wallet-balance:visible').first()).toContainText('$48.00 USD');
});

test('manual polling refreshes visible batch changes and detail notes without reloading an unchanged catalog', async ({ adminPage: page }) => {
  await page.clock.install();
  await page.goto('/dashboard/batches?kind=manual');
  let refreshes = 0;
  page.on('request', request => { const url = new URL(request.url()); if (url.pathname === '/dashboard/batches' && url.searchParams.has('_rsc') && request.headers()['next-router-prefetch'] !== '1') refreshes++; });
  await page.clock.fastForward(2500);
  expect(refreshes).toBe(0);
  const unchanged=page.waitForResponse(response=>response.url().includes('/api/batches/version?'));
  await page.clock.fastForward(30_000);
  expect((await unchanged).status()).toBe(200);
  await expect(page.locator('.batch-live')).toHaveText('Live updates · every 30s');
  expect(refreshes).toBe(0);
  sql("update bolna_assignments set remarks='Changed during live polling' where id=1");
  let response=page.waitForResponse(response=>response.url().includes('/api/batches/version?'));
  await page.clock.fastForward(30_000);
  expect((await response).status()).toBe(200);
  await expect(page.locator('.batch-live')).toHaveText('Live updates · every 30s');
  expect(refreshes).toBe(0); // The catalog does not display assignment notes.
  const assigned=await page.request.post('/api/assignments',{data:{entity_type:'record',ids:['a0000000-0000-4000-8000-000000000004'],assignee:'priya@eval.test'}});
  expect(assigned.status()).toBe(200);
  response=page.waitForResponse(response=>response.url().includes('/api/batches/version?'));
  await page.clock.fastForward(30_000);expect((await response).status()).toBe(200);
  await expect.poll(() => refreshes).toBe(1);
  await expect(page.locator('.batch-card')).toHaveCount(1);

  await page.goto('/dashboard/batches/manual/legacy');
  await expect(page.locator('.batch-grid')).toContainText('Changed during live polling');
  sql("update bolna_assignments set remarks='Updated detail note' where id=1");
  response=page.waitForResponse(response=>response.url().includes('/api/batches/version?'));
  await page.clock.fastForward(30_000);expect((await response).status()).toBe(200);
  await expect(page.locator('.batch-grid')).toContainText('Updated detail note');
});
