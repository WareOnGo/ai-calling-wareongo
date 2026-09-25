import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import pg from "pg";

// Deliberately does not load .env.local: the operator supplies the target explicitly.
const connection = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connection) throw new Error("Set DIRECT_URL or DATABASE_URL explicitly");
const url = new URL(connection);
for (const key of ["sslmode", "pgbouncer", "connection_limit"]) url.searchParams.delete(key);
const client = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 15000, ssl: process.env.DATABASE_SSL === "disable" ? false : {
  rejectUnauthorized: process.env.DATABASE_SSL !== "insecure",
  ...(process.env.DATABASE_SSL_CA ? { ca: process.env.DATABASE_SSL_CA.replace(/\\n/g, "\n") } : {}),
} });
const base = new URL("./", import.meta.url);
const digest = sql => createHash("sha256").update(sql).digest("hex");
const owned = ["bolna_call_logs", "bolna_webhook_events", "raw_records", "raw_phones", "raw_phone_numbers", "call_batches", "call_batch_items", "bolna_app_users", "bolna_assignments"];
await client.connect();
try {
  await client.query("begin");
  // Fail and roll back promptly instead of queuing behind live dashboard traffic.
  await client.query("set local lock_timeout = '2s'");
  await client.query("set local statement_timeout = '30s'");
  await client.query("set local idle_in_transaction_session_timeout = '30s'");
  await client.query("select pg_advisory_xact_lock(81620403)");
  await client.query(`create table if not exists bolna_schema_migrations (
    name text primary key, checksum text not null, applied_at timestamptz not null default now())`);
  const history = new Map((await client.query("select name, checksum from bolna_schema_migrations")).rows.map(r => [r.name, r.checksum]));
  const baseline = await readFile(new URL("baseline.sql", base), "utf8");
  if (!history.has("baseline.sql")) {
    const present = (await client.query("select tablename from pg_tables where schemaname = 'public' and tablename = any($1::text[])", [owned])).rows;
    if (process.argv.includes("--init")) {
      if (present.length) throw new Error("--init requires an empty app schema; use normal migration for an existing installation");
      await client.query(baseline);
    } else {
      if (present.length !== owned.length) throw new Error("Incomplete or missing app schema. For a fresh database use --init");
      const view = await client.query("select to_regclass('public.bolna_call_analysis') as name");
      if (!view.rows[0].name) throw new Error("Existing database is missing bolna_call_analysis; repair its baseline first");
      console.log("Adopting existing app schema; baseline SQL will not run");
    }
    await client.query("insert into bolna_schema_migrations(name, checksum) values ($1, $2)", ["baseline.sql", digest(baseline)]);
  } else if (history.get("baseline.sql") !== digest(baseline)) throw new Error("Baseline checksum changed; add a forward migration instead");
  const files = (await readdir(new URL("migrations/", base))).filter(n => n.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await readFile(new URL(`migrations/${file}`, base), "utf8"), checksum = digest(sql);
    if (history.has(file)) {
      if (history.get(file) !== checksum) throw new Error(`Applied migration changed: ${file}`);
      continue;
    }
    await client.query(sql);
    await client.query("insert into bolna_schema_migrations(name, checksum) values ($1, $2)", [file, checksum]);
    console.log(`Applied ${file}`);
  }
  await client.query("commit");
  console.log("Schema is up to date");
} catch (error) {
  await client.query("rollback");
  throw error;
} finally { await client.end(); }
