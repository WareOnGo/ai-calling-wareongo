// Applies every sql/*.sql migration in sorted order.
// Usage: DATABASE_URL=... node scripts/db-init.mjs
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Prefer the direct/session pooler for DDL.
const rawUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!rawUrl) {
  console.error("DIRECT_URL (or DATABASE_URL) is not set");
  process.exit(1);
}

// Strip ssl/pgbouncer query params so pg uses our explicit ssl config
// (sslmode=require is otherwise treated as verify-full and rejects Supabase's cert).
const u = new URL(rawUrl);
for (const k of ["sslmode", "pgbouncer", "connection_limit"]) u.searchParams.delete(k);

const sqlDir = join(__dirname, "..", "sql");
const files = readdirSync(sqlDir).filter((f) => f.endsWith(".sql")).sort();

const client = new pg.Client({
  connectionString: u.toString(),
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  for (const f of files) {
    await client.query(readFileSync(join(sqlDir, f), "utf8"));
    console.log(`  ✓ ${f}`);
  }
  console.log("✅ Schema applied (call_logs, webhook_events, call_analysis view).");
} catch (err) {
  console.error("❌ Failed:", err.message);
  process.exit(1);
} finally {
  await client.end();
}
