import { createHash } from "node:crypto";
import { z } from "zod";
import { query, transaction } from "./db";
import { ApiError, selectedIds, uuid } from "./api";
import { getRawQueueRowsByIds } from "./raw";
import { assembleBatch, sendBatchToBolna } from "./dispatch";
import { getDispatchAgents, type DispatchAgent } from "./agents";
import { normNum, type QueueSel } from "./queue";
import { CALL_LANGUAGES, LANGUAGE_LABELS, computeScheduleAt, type CallLanguage, type RoutingMode } from "./routing";
import type { Viewer } from "./scope";

export const dispatchSchema = z.object({
  ids: selectedIds, intentKey: uuid, confirm: z.literal(true),
  // Older tabs previewed Hindi-only calls and omit this field. Auto must be explicit.
  routingMode: z.enum(["auto", "hindi", "english"]).default("hindi"),
  filters: z.record(z.string().max(1000)).nullable().optional(),
  excludeCats: z.array(z.enum(["dead", "unclear", "available", "unavailable"])).max(4).default([]),
}).strict();
export type DispatchInput = z.output<typeof dispatchSchema>;
export const ACTIVE_BATCH_SQL = "('sending', 'creating', 'scheduling', 'scheduled', 'uncertain')";
type Counts = { total: number; callable: number; held_region: number; already_queued: number; excluded_by_cat: number; skipped_no_number: number };
type Batch = Counts & {
  id: string; state: string; request_hash: string; bolna_batch_id: string | null; scheduled_at: string;
  agent_id: string; agent_language: CallLanguage | null; last_error: string | null;
};
type DispatchRequest = Counts & { id: string; request_hash: string; routing_mode: RoutingMode; scheduled_at: string };
export type DispatchBatchResult = {
  batchId: string; bolnaBatchId: string | null; agentId: string; language: CallLanguage; agentLabel: string;
  state: string; scheduled: boolean; scheduledAt: string; callable: number; error: string | null;
};
export type DispatchResult = {
  dispatchId: string; routingMode: RoutingMode; scheduled: boolean; state: string;
  scheduledAt: string; total: number; callable: number; heldRegion: number; alreadyQueued: number;
  excludedByCat: number; skippedNoNumber: number; batches: DispatchBatchResult[];
  // Compatibility for the earlier single-batch client and existing operator links.
  batchId: string; bolnaBatchId: string | null;
};

export function batchResponse(b: Batch): DispatchBatchResult {
  const language = b.agent_language ?? "hindi";
  return { scheduled: b.state === "scheduled" || b.state === "completed", state: b.state, batchId: b.id,
    bolnaBatchId: b.bolna_batch_id, scheduledAt: b.scheduled_at, callable: b.callable,
    agentId: b.agent_id, language, agentLabel: LANGUAGE_LABELS[language], error: b.last_error };
}
function response(request: DispatchRequest, rows: Batch[]): DispatchResult {
  const batches = rows.map(batchResponse);
  const scheduled = batches.length > 0 && batches.every(b => b.scheduled);
  const state = scheduled ? (batches.every(b => b.state === "completed") ? "completed" : "scheduled")
    : batches.some(b => b.scheduled) ? "partial"
    : batches.some(b => b.state === "uncertain") ? "uncertain"
    : batches.every(b => b.state === "canceled") ? "canceled" : "creating";
  return { dispatchId: request.id, routingMode: request.routing_mode, scheduled, state, scheduledAt: request.scheduled_at,
    total: request.total, callable: request.callable, heldRegion: request.held_region, alreadyQueued: request.already_queued,
    excludedByCat: request.excluded_by_cat, skippedNoNumber: request.skipped_no_number, batches,
    batchId: batches[0]?.batchId ?? request.id, bolnaBatchId: batches[0]?.bolnaBatchId ?? null };
}
function requestHash(input: DispatchInput, legacy = false) {
  // Agent choice is part of the intent. Resolved IDs are frozen on child batches;
  // a later environment change must never resend a previously accepted intent.
  return createHash("sha256").update(JSON.stringify({ ids: [...input.ids].sort(), exclusions: [...new Set(input.excludeCats)].sort(),
    ...(!legacy ? { routingMode: input.routingMode } : {}) })).digest("hex");
}
async function savedResponse(request: DispatchRequest) {
  const batches = await query<Batch>("select * from call_batches where dispatch_request_id = $1 order by agent_language desc", [request.id]);
  return response(request, batches.rows);
}
async function sendPrepared(batch: Batch, rows: QueueSel[], agent: DispatchAgent) {
  try {
    const sent = await sendBatchToBolna(rows, new Date(batch.scheduled_at).toISOString().replace("Z", "+00:00"), batch.id, agent, async providerId => {
      const saved = await query(`update call_batches set bolna_batch_id = $2, state = 'scheduling', updated_at = now()
        where id = $1 and state = 'creating' returning id`, [batch.id, providerId]);
      if (!saved.rowCount) throw new Error("Batch state changed before scheduling");
    });
    const saved = await query(`update call_batches set state = 'scheduled', bolna_batch_id = $2, last_error = null, updated_at = now()
      where id = $1 and state = 'scheduling' returning id`, [batch.id, sent.bolnaBatchId]);
    if (!saved.rowCount) throw new Error("Batch state changed while scheduling");
  } catch (error) {
    // An uncertain child retains its reservations. Never resend either child on a
    // repeated parent request, even if only the other language was scheduled.
    await query(`update call_batches set state = 'uncertain', last_error = $2, updated_at = now()
      where id = $1 and state in ('creating', 'scheduling')`, [batch.id, String(error).slice(0, 1000)]);
  }
}

export async function dispatchBatch(viewer: Viewer, input: DispatchInput): Promise<DispatchResult> {
  if (!viewer.isAdmin) throw new ApiError(403, "forbidden");
  const hash = requestHash(input);
  const existing = (await query<DispatchRequest>("select * from bolna_dispatch_requests where id = $1", [input.intentKey])).rows[0];
  if (existing) {
    if (existing.request_hash !== hash) throw new ApiError(409, "Dispatch key was already used for another selection or agent choice");
    return savedResponse(existing);
  }
  // Do not turn a retry from the old dashboard into a new English/Hindi dispatch.
  const legacy = (await query<Batch>("select * from call_batches where intent_key = $1 and dispatch_request_id is null", [input.intentKey])).rows[0];
  if (legacy) {
    if (input.routingMode === "english" || legacy.request_hash !== requestHash(input, true)) throw new ApiError(409, "Dispatch key was already used for another selection or agent choice");
    return response({ ...legacy, id: input.intentKey, routing_mode: "hindi" }, [legacy]);
  }
  const agents = getDispatchAgents();
  const availableLanguages = CALL_LANGUAGES.filter(language => !!agents[language]);
  if (!process.env.BOLNA_API_KEY || !availableLanguages.length) throw new ApiError(503, "Calling service is not configured");
  if (input.routingMode !== "auto" && !agents[input.routingMode]) throw new ApiError(503, `${LANGUAGE_LABELS[input.routingMode]} agent is not configured`);
  if (agents.hindi && agents.english && agents.hindi.id === agents.english.id) throw new ApiError(503, "Hindi and English must use different agent IDs");
  const candidates = await getRawQueueRowsByIds(viewer, input.ids);
  const prepared = await transaction(async client => {
    // Reserve every phone across both languages in a single transaction before
    // either provider request. The global unique phone key also fences other admins.
    await client.query("select pg_advisory_xact_lock(81620402)");
    const duplicate = (await client.query<DispatchRequest>("select * from bolna_dispatch_requests where id = $1", [input.intentKey])).rows[0];
    if (duplicate) {
      if (duplicate.request_hash !== hash) throw new ApiError(409, "Dispatch key was already used for another selection or agent choice");
      return { request: duplicate, batches: [] as { batch: Batch; rows: QueueSel[]; agent: DispatchAgent }[] };
    }
    // A request handled by the old server may have committed while we waited.
    // Never reinterpret its key as a new multi-agent request during a rolling deploy.
    const legacyRace = await client.query("select id from call_batches where intent_key = $1 and dispatch_request_id is null", [input.intentKey]);
    if (legacyRace.rowCount) throw new ApiError(409, "This dispatch was accepted by an earlier dashboard version. Refresh Recent batches before continuing.");
    const live = await client.query<{ phone: string }>(`select phone_last10 as phone from bolna_dispatch_reservations
      union select right(regexp_replace(i.contact_number, '\\D', '', 'g'), 10)
        from call_batch_items i join call_batches b on b.id = i.batch_id where b.state in ${ACTIVE_BATCH_SQL}`);
    const reserved = new Set(live.rows.map(r => r.phone));
    const summary = assembleBatch(candidates.map(r => ({ ...r, queued: reserved.has(normNum(r.contact)) })), input.excludeCats,
      { mode: input.routingMode, availableLanguages });
    if (!summary.callable.length) throw new ApiError(409, "No callable numbers remain after routing and reservation checks");
    const scheduledAt = computeScheduleAt(new Date());
    const request = (await client.query<DispatchRequest>(`insert into bolna_dispatch_requests
      (id, created_by, request_hash, routing_mode, scheduled_at, total, callable, excluded_by_cat, held_region, already_queued, skipped_no_number)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
      [input.intentKey, viewer.email, hash, input.routingMode, scheduledAt, summary.total, summary.callable.length,
        summary.excludedByCat, summary.heldRegion, summary.alreadyQueued, summary.skippedNoNumber])).rows[0];
    const batches: { batch: Batch; rows: QueueSel[]; agent: DispatchAgent }[] = [];
    for (const language of CALL_LANGUAGES) {
      const rows = summary.groups[language];
      if (!rows.length) continue;
      const agent = agents[language]!;
      const batch = (await client.query<Batch>(`insert into call_batches
        (created_by, agent_id, agent_language, dispatch_request_id, scheduled_at, state, filters, total, callable,
          excluded_by_cat, held_region, already_queued, skipped_no_number, intent_key, request_hash)
        values ($1,$2,$3,$4,$5,'creating',$6,$7,$7,0,0,0,0,gen_random_uuid(),$8) returning *`,
        [viewer.email, agent.id, language, request.id, scheduledAt, input.filters ?? null, rows.length, hash])).rows[0];
      await client.query(`insert into bolna_dispatch_reservations(phone_last10, batch_id)
        select x, $2 from unnest($1::text[]) x order by x`, [rows.map(r => normNum(r.contact)), batch.id]);
      await client.query(`insert into call_batch_items(batch_id, record_id, name, contact_number, area, cat)
        select $1, * from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[])`,
        [batch.id, rows.map(r => r.id), rows.map(r => r.name), rows.map(r => r.contact), rows.map(r => r.area), rows.map(r => r.cat)]);
      batches.push({ batch, rows, agent });
    }
    return { request, batches };
  });
  // Each child has its own durable create/schedule checkpoints and reconciliation.
  const results = await Promise.allSettled(prepared.batches.map(({ batch, rows, agent }) => sendPrepared(batch, rows, agent)));
  for (const result of results) if (result.status === "rejected") console.error("[dispatch] could not record child outcome; reconciliation will recover it", result.reason);
  return savedResponse(prepared.request);
}
