// Server-side assembly + transport scaffold for a Bolna calling batch.
//
// SECURITY: the client's selection is never trusted for the actual send. The
// dispatch route re-fetches matching rows from the DB (getRawQueueRows), then
// assembleBatch() re-applies dedup + category exclusions here. The client's toggles
// are only hints; the server reconstructs the callable list.
//
// The real Bolna transport is intentionally NOT wired — sendBatchToBolna throws
// until credentials + the API shape are chosen. Nothing can fire a live call yet.

import { type QueueSel, type CallCat, dedupByNumber, buildCsv } from "@/lib/queue";
import { isHindiBlocked } from "@/lib/routing";

const BOLNA_API_BASE = "https://api.bolna.ai";

// Auto-retry failed calls in a batch: 3 retries at 30 / 60 / 120 min after the prior
// attempt. Bolna wants this as a JSON string in the create-batch form.
const RETRY_CONFIG = { enabled: true, max_retries: 3, retry_intervals_minutes: [30, 60, 120] };

export const KNOWN_CATS: CallCat[] = ["dead", "unclear", "available", "unavailable"];

export type DispatchSummary = {
  total: number;            // rows after dedup (the full candidate set)
  excludedCats: CallCat[];  // categories the caller asked to drop
  excludedByCat: number;    // rows removed by those category exclusions
  heldRegion: number;       // rows held back by region/language routing (TN/KL/KA)
  alreadyQueued: number;    // rows skipped because the number is in a live batch
  skippedNoNumber: number;  // kept rows that have no phone (can't be called)
  callable: QueueSel[];     // final list (deduped, in-category, routable, not-queued, has phone)
};

// Build the final callable batch from candidate rows. Idempotent and pure so it can
// be unit-tested and reused by the route. `excludeCats` mirrors the modal's toggles;
// the region hold-back and already-queued skip are hard safeguards applied regardless
// of client input. Filter order (each stage narrows): dedup → category → region →
// already-queued → has-number.
export function assembleBatch(rows: QueueSel[], excludeCats: CallCat[] = []): DispatchSummary {
  const deduped = dedupByNumber(rows);
  const excl = new Set(excludeCats.filter((c): c is CallCat => KNOWN_CATS.includes(c)));
  const afterCat = deduped.filter((r) => !(r.cat && excl.has(r.cat)));
  const routable = afterCat.filter((r) => !isHindiBlocked(r.state));
  const notQueued = routable.filter((r) => !r.queued);
  const callable = notQueued.filter((r) => r.contact.trim());
  return {
    total: deduped.length,
    excludedCats: [...excl],
    excludedByCat: deduped.length - afterCat.length,
    heldRegion: afterCat.length - routable.length,
    alreadyQueued: routable.length - notQueued.length,
    skippedNoNumber: notQueued.length - callable.length,
    callable,
  };
}

// Bolna names the batch after the uploaded CSV's filename, so we build a descriptive
// one: the cities being called + the (IST) execution date, e.g. "Rajkot-Delhi-2026-07-03".
// Cities are ranked by frequency; beyond 3 we append "+N". IST is a fixed +5:30 offset
// (no DST) so the date math is deterministic and testable.
export function batchFileName(batch: QueueSel[], scheduledAt: string): string {
  const counts = new Map<string, number>();
  for (const r of batch) {
    const city = (r.area ?? "").trim();
    if (city) counts.set(city, (counts.get(city) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c);
  const clean = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "");
  const top = ranked.slice(0, 3).map(clean).filter(Boolean);
  let cities = top.join("-") || "batch";
  if (ranked.length > 3) cities += `+${ranked.length - 3}`;

  const p = (n: number) => String(n).padStart(2, "0");
  const ist = new Date(new Date(scheduledAt).getTime() + 330 * 60_000);
  const date = `${ist.getUTCFullYear()}-${p(ist.getUTCMonth() + 1)}-${p(ist.getUTCDate())}`;

  return `${cities}-${date}.csv`;
}

export type BolnaSendResult = { dispatched: number; bolnaBatchId: string; scheduledAt: string };

// LIVE dispatch to Bolna: create the batch (multipart CSV upload + agent_id +
// from_phone_numbers), then schedule it so calls actually go out. `batch` must already
// be the assembled callable set (deduped, in-category, region-routable, has-number) —
// this function does NOT re-apply guardrails, so callers must pass assembleBatch(...).callable.
//
// Docs: POST /batches (multipart) -> {batch_id}; POST /batches/{id}/schedule (scheduled_at,
// ISO w/ numeric offset, ≥2min, rounds up to next 10-min mark). Auth: Bearer BOLNA_API_KEY.
export async function sendBatchToBolna(batch: QueueSel[], scheduledAt: string): Promise<BolnaSendResult> {
  const apiKey = process.env.BOLNA_API_KEY;
  const agentId = process.env.BOLNA_AGENT_ID;
  const fromNumber = process.env.BOLNA_FROM_NUMBER;
  if (!apiKey) throw new Error("BOLNA_API_KEY is not set");
  if (!agentId) throw new Error("BOLNA_AGENT_ID is not set");
  if (batch.length === 0) throw new Error("empty batch — nothing to dispatch");

  const auth = { Authorization: `Bearer ${apiKey}` };

  // 1) Create the batch with the CSV (contact_number column is required by Bolna).
  const form = new FormData();
  form.append("agent_id", agentId);
  const csv = buildCsv(batch);
  form.append("file", new Blob([csv], { type: "text/csv" }), batchFileName(batch, scheduledAt));
  // FastAPI List[str] form fields are sent as repeated keys. Optional anyway — the
  // agent has a default caller ID configured (the same number), so omitting it is safe.
  if (fromNumber) form.append("from_phone_numbers", fromNumber);
  form.append("retry_config", JSON.stringify(RETRY_CONFIG));

  const createRes = await fetch(`${BOLNA_API_BASE}/batches`, { method: "POST", headers: auth, body: form });
  const createBody = await createRes.text();
  if (!createRes.ok) throw new Error(`Bolna create failed (${createRes.status}): ${createBody.slice(0, 300)}`);
  const created = JSON.parse(createBody) as { batch_id?: string };
  const bolnaBatchId = created.batch_id;
  if (!bolnaBatchId) throw new Error(`Bolna create returned no batch_id: ${createBody.slice(0, 300)}`);

  // 2) Schedule it — this is what actually places the calls.
  const schedForm = new FormData();
  schedForm.append("scheduled_at", scheduledAt);
  const schedRes = await fetch(`${BOLNA_API_BASE}/batches/${bolnaBatchId}/schedule`, {
    method: "POST",
    headers: auth,
    body: schedForm,
  });
  const schedBody = await schedRes.text();
  if (!schedRes.ok) {
    throw new Error(
      `Bolna schedule failed (${schedRes.status}) for batch ${bolnaBatchId}: ${schedBody.slice(0, 300)}`,
    );
  }

  return { dispatched: batch.length, bolnaBatchId, scheduledAt };
}
