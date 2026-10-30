import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, readFile, symlink, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import pg from 'pg';

// Read committed SQL from the feature history without merging it into this app.
// This is the shared production ledger verified on 30 October 2026; 009 is pending.
const schemaRef = process.argv[2];
if (!schemaRef || !/^[a-f0-9]{40}$/.test(schemaRef)) throw Error('Supply the full reviewed schema commit SHA');
const target = new URL(process.env.TEST_DATABASE_URL || '');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) throw Error('Disposable local PostgreSQL required');
const root = resolve('.');
const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8'});
const files = git('ls-tree', '-r', '--name-only', schemaRef, 'database/migrations').trim().split('\n')
  .filter(file => /\/(?:00[1-8]|01[0-7])_.*\.sql$/.test(file));
assert.equal(files.length, 16, 'Expected the 16 applied migrations, excluding 009');
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
    // The main runner must leave the retained feature ledger and schema intact.
    run(process.execPath, ['database/migrate.mjs'], env);
    assert.deepEqual((await db.query('select name,checksum,applied_at from bolna_schema_migrations order by name')).rows, before);
    assert.equal((await db.query("select count(*)::int n from bolna_schema_migrations where name like '009_%'")).rows[0].n, 0);
  } finally { await db.end(); }
  run('npm', ['run', 'test:integration'], env);
  console.log(`Main compatibility passed against shared schema from ${schemaRef}; no feature application code was imported.`);
} finally {
  try { if (created) await admin.query(`drop database ${database} with (force)`); }
  finally { await admin.end(); await rm(temporary, {recursive: true, force: true}); }
}
