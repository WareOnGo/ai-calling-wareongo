// This command destroys only the synthetic fixture created for this handoff.
// Never load .env.local or accept an arbitrary DB URL for this operation.
import pg from 'pg';
import assert from 'node:assert/strict';
const target = new URL(process.env.TEST_DATABASE_URL || '');
assert.equal(target.hostname, '127.0.0.1');
assert.equal(target.port, '55439');
assert.equal(target.pathname, '/postgres');
assert.equal(target.password, 'bolna-fixes-test-only');
const db = new pg.Client({connectionString: target.href, ssl: false});
await db.connect();
try {
  await db.query('begin');
  await db.query("set local lock_timeout='2s'");
  await db.query('drop schema public cascade');
  await db.query('create schema public');
  await db.query('commit');
  console.log('Dedicated synthetic handoff schema reset');
} catch (error) {
  await db.query('rollback');
  throw error;
} finally { await db.end(); }
