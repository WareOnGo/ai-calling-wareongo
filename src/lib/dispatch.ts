import { type QueueSel, buildCsv } from "@/lib/queue";
import type { DispatchAgent } from "./agents";

const BOLNA_API_BASE = "https://api.bolna.ai";

// Auto-retry failed calls in a batch: 3 retries at 30 / 60 / 120 min after the prior
// attempt. Bolna wants this as a JSON string in the create-batch form.
const RETRY_CONFIG = { enabled: true, max_retries: 3, retry_intervals_minutes: [30, 60, 120] };

export { assembleBatch, KNOWN_CATS, type DispatchSummary } from "./dispatch-plan";

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
export async function sendBatchToBolna(batch: QueueSel[], scheduledAt: string, localId: string, agent: DispatchAgent, onCreated: (id: string) => Promise<void>): Promise<BolnaSendResult> {
  const apiKey = process.env.BOLNA_API_KEY;
  const agentId = agent.id;
  const fromNumber = process.env.BOLNA_FROM_NUMBER;
  if (!apiKey) throw new Error("BOLNA_API_KEY is not set");
  if (!agentId) throw new Error("No agent configured for this batch");
  if (batch.length === 0) throw new Error("empty batch — nothing to dispatch");

  const auth = { Authorization: `Bearer ${apiKey}` };

  // 1) Create the batch with the CSV (contact_number column is required by Bolna).
  const form = new FormData();
  form.append("agent_id", agentId);
  const csv = buildCsv(batch);
  form.append("file", new Blob([csv], { type: "text/csv" }), batchFileName(batch, scheduledAt).replace(".csv", `-${agent.language}-${localId}.csv`));
  // FastAPI List[str] form fields are sent as repeated keys. Optional anyway — the
  // agent has a default caller ID configured (the same number), so omitting it is safe.
  if (fromNumber) form.append("from_phone_numbers", fromNumber);
  form.append("retry_config", JSON.stringify(RETRY_CONFIG));

  const createRes = await fetch(`${BOLNA_API_BASE}/batches`, { method: "POST", headers: auth, body: form, signal: AbortSignal.timeout(20_000) });
  const createBody = await createRes.text();
  if (!createRes.ok) throw new Error(`Bolna create failed (${createRes.status}): ${createBody.slice(0, 300)}`);
  const created = JSON.parse(createBody) as { batch_id?: string };
  const bolnaBatchId = created.batch_id;
  if (!bolnaBatchId) throw new Error(`Bolna create returned no batch_id: ${createBody.slice(0, 300)}`);

  await onCreated(bolnaBatchId); // Durable checkpoint BEFORE the scheduling side effect.

  // 2) Schedule it — this is what actually places the calls.
  const schedForm = new FormData();
  schedForm.append("scheduled_at", scheduledAt);
  const schedRes = await fetch(`${BOLNA_API_BASE}/batches/${bolnaBatchId}/schedule`, {
    method: "POST",
    headers: auth,
    body: schedForm,
    signal: AbortSignal.timeout(20_000),
  });
  const schedBody = await schedRes.text();
  if (!schedRes.ok) {
    throw new Error(
      `Bolna schedule failed (${schedRes.status}) for batch ${bolnaBatchId}: ${schedBody.slice(0, 300)}`,
    );
  }

  return { dispatched: batch.length, bolnaBatchId, scheduledAt };
}
