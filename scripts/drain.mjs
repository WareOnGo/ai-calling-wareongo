// Repeatedly trigger /api/process until the queue is empty.
// Useful after a backfill to process everything quickly instead of waiting for
// the scheduled (AWS) runs. Requires the app running (npm run dev) with
// OPENAI_API_KEY + DATABASE_URL configured.
//
// Usage: npm run drain                  (drains /api/process)
//        npm run enrich                  (drains /api/enrich)
//        node ... scripts/drain.mjs <url>
const URL =
  process.argv[2] || process.env.DRAIN_URL || process.env.PROCESS_URL ||
  "http://localhost:3000/api/process";
const SECRET = process.env.PROCESS_SECRET;

if (!SECRET) {
  console.error("❌ PROCESS_SECRET is not set");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let totalOk = 0, totalFail = 0, rounds = 0;
  console.log(`Draining via ${URL} …\n`);

  while (true) {
    // Retry transient network/server blips instead of dying mid-drain.
    let res, attempt = 0;
    while (true) {
      try {
        res = await fetch(URL, { method: "POST", headers: { Authorization: `Bearer ${SECRET}` } });
        if (res.ok) break;
        if (res.status >= 500 && attempt < 5) throw new Error(`HTTP ${res.status}`);
        console.error(`❌ ${res.status}: ${(await res.text()).slice(0, 300)}`);
        process.exit(1);
      } catch (err) {
        if (attempt++ >= 5) throw err;
        const wait = 2000 * attempt;
        console.error(`  ⚠ transient (${err.message}); retry ${attempt}/5 in ${wait}ms`);
        await sleep(wait);
      }
    }
    const { claimed, succeeded, failed } = await res.json();
    rounds++;
    totalOk += succeeded ?? 0;
    totalFail += failed ?? 0;
    console.log(`  round ${rounds}: claimed=${claimed} ok=${succeeded} fail=${failed}`);

    if (!claimed) break; // nothing due → done
    await sleep(500);
  }

  console.log(`\n✅ Drained. processed=${totalOk} failed=${totalFail} over ${rounds} round(s).`);
  if (totalFail) {
    console.log(`   Inspect failures: select id, attempts, last_error from webhook_events where status='failed';`);
  }
}

main().catch((err) => {
  console.error("❌ Drain failed:", err.message);
  process.exit(1);
});
