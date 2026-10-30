import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, readFile, symlink, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import pg from 'pg';

// Recreate the deployed pre-merge schema from immutable history, then test its upgrade.
// This is the shared production ledger after 009 was deployed on 30 October 2026.
const schemaRef = process.argv[2];
if (!schemaRef || !/^[a-f0-9]{40}$/.test(schemaRef)) throw Error('Supply the full reviewed schema commit SHA');
const target = new URL(process.env.TEST_DATABASE_URL || '');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) throw Error('Disposable local PostgreSQL required');
const root = resolve('.');
const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8'});
const files = git('ls-tree', '-r', '--name-only', schemaRef, 'database/migrations').trim().split('\n')
  .filter(file => /\/(?:00[1-9]|01[0-7])_.*\.sql$/.test(file));
assert.equal(files.length, 17, 'Expected all 17 applied migrations');
const temporary = await mkdtemp(join(tmpdir(), 'bolna-shared-schema-'));
const database = `bolna_compat_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Client({connectionString: target.href, ssl: false});
const local = new URL(target);
local.pathname = `/${database}`;
let created = false;
const run = (command, args, env) => {
  const result = spawnSync(command, args, {cwd: root, env, stdio: 'inherit'});
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed`);
};
try {
  await mkdir(join(temporary, 'database/migrations'), {recursive: true});
  await symlink(resolve('node_modules'), join(temporary, 'node_modules'));
  for (const file of ['database/baseline.sql', 'database/migrate.mjs', 'database/backfill-ai-evidence.mjs', ...files]) {
    await writeFile(join(temporary, file), git('show', `${schemaRef}:${file}`));
  }
  await admin.connect();
  await admin.query(`create database ${database}`);
  created = true;
  const env = {...process.env, TEST_DATABASE_URL: local.href, DATABASE_URL: local.href, DIRECT_URL: local.href,
    DATABASE_SSL: 'disable', TEST_SHARED_SCHEMA: '1'};
  run(process.execPath, [join(temporary, 'database/migrate.mjs'), '--init'], env);
  const db = new pg.Client({connectionString: local.href, ssl: false});
  await db.connect();
  try {
    await db.query(await readFile('database/rollback-handoff.sql', 'utf8'));
    const before = (await db.query('select name,checksum,applied_at from bolna_schema_migrations order by name')).rows;
    // Preserve every existing ledger record and add only the compatibility migration.
    run(process.execPath, ['database/migrate.mjs'], env);
    const after = (await db.query('select name,checksum,applied_at from bolna_schema_migrations order by name')).rows;
    assert.deepEqual(after.filter(row => row.name !== '018_employee_workflow_compat.sql'), before);
    assert.equal(after.filter(row => row.name === '018_employee_workflow_compat.sql').length, 1);
    run(process.execPath, ['database/migrate.mjs'], env);
    assert.deepEqual((await db.query('select name,checksum,applied_at from bolna_schema_migrations order by name')).rows, after);
    assert.equal((await db.query("select count(*)::int n from bolna_schema_migrations where name='009_dashboard_page_indexes.sql'")).rows[0].n, 1);
    const indexes = (await db.query(`select indisvalid,indisready from pg_index where indexrelid=any(array[
      to_regclass('public.bolna_raw_page_order'),to_regclass('public.bolna_assignment_page_order')])`)).rows;
    assert.equal(indexes.length, 2);
    assert.ok(indexes.every(index => index.indisvalid && index.indisready));
  } finally { await db.end(); }
  run('npm', ['run', 'test:integration', '--', 'tests/integration/shared-schema.test.ts', 'tests/integration/employee-workflow.test.ts'], env);
  console.log(`Merged main compatibility passed after upgrading the shared schema from ${schemaRef}; existing ledger entries and trigger states were preserved.`);
} finally {
  try { if (created) await admin.query(`drop database ${database} with (force)`); }
  finally { await admin.end(); await rm(temporary, {recursive: true, force: true}); }
}
