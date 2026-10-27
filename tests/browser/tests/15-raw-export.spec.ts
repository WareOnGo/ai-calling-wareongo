import { test, expect } from './fixtures';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { CONTAINER } from '../lib/env.mjs';

const source = 'export-eval';
const rawId = (n: number) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function seedExportRows() {
  execFileSync('podman', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-c', `
    insert into raw_records (id,source,source_record_id,owner_name,city,area_sqft)
    select ('e0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${source}',n::text,'Export owner '||n,case when n<=123 then 'Pune' else 'Delhi' end,20000-n
    from generate_series(1,130) n;
    insert into raw_phone_numbers(phone_last10,phone)
    select '980000'||lpad(n::text,4,'0'),'+91980000'||lpad(n::text,4,'0') from generate_series(1,130) n;
    insert into raw_phones(master_id,phone_id,is_primary)
    select r.id,p.phone_id,true from raw_records r join raw_phone_numbers p on p.phone_last10='980000'||lpad(r.source_record_id,4,'0') where r.source='${source}';
  `]);
}

async function download(page: any) {
  const request = page.waitForRequest((r: any) => r.url().endsWith('/api/raw/export') && r.method() === 'POST');
  const file = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Download CSV', exact: true}).click();
  const saved = await file;
  const csv = await readFile((await saved.path())!, 'utf8');
  return { body: (await request).postDataJSON(), ids: [...csv.matchAll(/^export-eval,(\d+),/gm)].map(match => Number(match[1])) };
}

for (const pageNumber of [1, 2]) test(`all matching raw CSV exports 123 filtered records from page ${pageNumber}`, async ({adminPage: page}) => {
  seedExportRows();
  await page.goto(`/dashboard/raw?source=${source}&city=Pune&page=${pageNumber}`);
  await expect(page.locator('.rowsel')).toHaveCount(50);
  await page.getByRole('checkbox', {name: 'Select all on this page', exact: true}).check();
  await page.getByRole('button', {name: 'Select all 123 matching', exact: true}).click();
  await expect(page.locator('.selection-summary')).toContainText('All 123 matching selected');
  await page.getByRole('button', {name: 'Export CSV', exact: true}).click();
  await expect(page.getByRole('dialog')).toContainText('123');
  await expect(page.getByRole('radio', {name: 'All 123 matching rows', exact: true})).toBeChecked();
  const result = await download(page);
  expect(result.body.filters.source).toBe(source);
  expect(result.body.filters.city).toBe('Pune');
  expect(result.body.filters).not.toHaveProperty('page');
  expect(result.body.filters).not.toHaveProperty('ids');
  expect(result.body).not.toHaveProperty('ids');
  expect(result.ids).toEqual(Array.from({length: 123}, (_, i) => i + 1));
});

test('all matching export clears retained IDs from the page URL', async ({adminPage: page}) => {
  seedExportRows();
  const retainedIds = Array.from({length: 50}, (_, i) => rawId(i + 1));
  await page.goto(`/dashboard/raw?source=${source}&city=Pune&ids=${retainedIds.join(',')}`);
  await expect(page.locator('.rowsel')).toHaveCount(50);
  await page.getByRole('checkbox', {name: 'Select all on this page', exact: true}).check();
  await page.getByRole('button', {name: 'Select all 123 matching', exact: true}).click();
  await page.getByRole('button', {name: 'Export CSV', exact: true}).click();
  const result = await download(page);
  expect(result.body).not.toHaveProperty('ids');
  expect(result.body.filters).not.toHaveProperty('ids');
  expect(result.ids).toHaveLength(123);
});

test('export dialog can expand page selection to every matching page and keep explicit selections', async ({adminPage: page, shot}) => {
  seedExportRows();
  await page.goto(`/dashboard/raw?source=${source}&city=Pune&page=2`);
  await expect(page.locator('.rowsel')).toHaveCount(50);
  await page.getByRole('checkbox', {name: 'Select all on this page', exact: true}).check();
  await page.getByRole('button', {name: 'Export CSV', exact: true}).click();
  await expect(page.getByRole('radio', {name: '50 selected rows on this page', exact: true})).toBeChecked();
  const selected = await download(page);
  expect(selected.body.ids).toHaveLength(50);
  expect(selected.ids).toEqual(Array.from({length: 50}, (_, i) => i + 51));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', {name: 'Export CSV', exact: true}).click();
  await page.getByRole('radio', {name: 'All 123 matching rows', exact: true}).check();
  await expect(page.getByRole('dialog')).toContainText('Includes every page');
  await shot(page, 'raw-export-all-matching');
  const matching = await download(page);
  expect(matching.body).not.toHaveProperty('ids');
  expect(matching.ids).toEqual(Array.from({length: 123}, (_, i) => i + 1));
});

test('matching raw export still enforces employee ownership across pages', async ({employeePage: page}) => {
  seedExportRows();
  execFileSync('podman', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-c', `
    insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state)
    select 'record',id,case when source_record_id::int <= 73 then 'priya@eval.test' else 'raj@eval.test' end,'admin@eval.test','open'
    from raw_records where source='${source}';
  `]);
  const result = await page.request.get(`/api/raw/export?source=${source}&city=Pune&page=2`);
  expect(result.status()).toBe(200);
  const csv = await result.text();
  const ids = [...csv.matchAll(/^export-eval,(\d+),/gm)].map(match => Number(match[1]));
  expect(ids).toEqual(Array.from({length: 73}, (_, i) => i + 1));
});
