// One-time backfill: pull past Bolna executions and queue them for processing.
//
// It fetches from GET /v2/agent/{agent_id}/executions (per-agent, paginated,
// 7-day max window) and inserts each TERMINAL execution into webhook_events as
// 'pending'. The normal worker (/api/process, or `npm run drain`) then enriches
// and writes them into call_logs — same path as live webhooks, fully idempotent.
//
// Usage:
//   npm run backfill
//   # or override: node --env-file=.env.local scripts/backfill.mjs <agentIds> <fromISO> <toISO>
import pg from "pg";

const API_BASE = "https://api.bolna.ai";
const KEY = process.env.BOLNA_API_KEY;
const DB = process.env.DIRECT_URL || process.env.DATABASE_URL;

const AGENT_IDS = (process.env.BACKFILL_AGENT_IDS || process.argv[2] || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const FROM = process.env.BACKFILL_FROM || process.argv[3];
const TO = process.env.BACKFILL_TO || process.argv[4] || new Date().toISOString();

const TERMINAL = new Set([
  "completed", "failed", "busy", "no-answer", "canceled",
  "stopped", "error", "balance-low", "call-disconnected",
]);

const PAGE_SIZE = 50;
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // API caps each query at 7 days
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function assert(cond, msg) {
  if (!cond) {
    console.error("❌ " + msg);
    process.exit(1);
  }
}

assert(KEY, "BOLNA_API_KEY is not set");
assert(DB, "DIRECT_URL / DATABASE_URL is not set");
assert(AGENT_IDS.length > 0, "No agent IDs. Set BACKFILL_AGENT_IDS or pass as arg 1.");
assert(FROM, "No start date. Set BACKFILL_FROM or pass as arg 2 (UTC ISO 8601).");

// Build the list of <=7-day [from,to] windows covering the whole range.
function windows(fromISO, toISO) {
  const out = [];
  let start = new Date(fromISO).getTime();
  const end = new Date(toISO).getTime();
  while (start < end) {
    const next = Math.min(start + WINDOW_MS, end);
    out.push([new Date(start).toISOString(), new Date(next).toISOString()]);
    start = next;
  }
  return out;
}

async function fetchPage(agentId, from, to, page) {
  const url = new URL(`${API_BASE}/v2/agent/${agentId}/executions`);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  url.searchParams.set("page_number", String(page));
  url.searchParams.set("page_size", String(PAGE_SIZE));

  const res = await fetch(url, { headers: { Authorization: `Bearer ${KEY}` } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Bolna API ${res.status} for agent ${agentId}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

const dbUrl = new URL(DB);
for (const k of ["sslmode", "pgbouncer", "connection_limit"]) dbUrl.searchParams.delete(k);
const client = new pg.Client({
  connectionString: dbUrl.toString(),
  ssl: { rejectUnauthorized: false },
});

async function insertEvent(e) {
  const r = await client.query(
    `insert into webhook_events (id, raw, status, next_attempt_at)
     values ($1, $2, 'pending', now())
     on conflict (id) do nothing`,
    [e.id, e],
  );
  return r.rowCount; // 1 = inserted, 0 = already existed
}

async function main() {
  await client.connect();
  const wins = windows(FROM, TO);
  let fetched = 0, inserted = 0, skippedNonTerminal = 0, duplicates = 0;

  console.log(`Backfilling ${AGENT_IDS.length} agent(s) across ${wins.length} window(s): ${FROM} → ${TO}\n`);

  for (const agentId of AGENT_IDS) {
    for (const [from, to] of wins) {
      let page = 1;
      while (true) {
        const json = await fetchPage(agentId, from, to, page);
        const data = json.data ?? [];
        for (const e of data) {
          fetched++;
          if (!e.id) continue;
          if (!TERMINAL.has(e.status)) { skippedNonTerminal++; continue; }
          const n = await insertEvent(e);
          if (n === 1) inserted++; else duplicates++;
        }
        process.stdout.write(
          `\r  agent ${agentId.slice(0, 8)}… ${from.slice(0, 10)}→${to.slice(0, 10)} ` +
          `page ${page} | fetched ${fetched}, queued ${inserted}, dup ${duplicates}   `,
        );
        if (!json.has_more) break;
        page++;
        await sleep(250); // be gentle with the API
      }
      process.stdout.write("\n");
    }
  }

  console.log(
    `\n✅ Done. fetched=${fetched} queued=${inserted} duplicates=${duplicates} ` +
    `skipped_non_terminal=${skippedNonTerminal}`,
  );
  console.log(`Now run \`npm run drain\` (with the dev server up) to enrich + store them.`);
  await client.end();
}

main().catch(async (err) => {
  console.error("\n❌ Backfill failed:", err.message);
  await client.end().catch(() => {});
  process.exit(1);
});
