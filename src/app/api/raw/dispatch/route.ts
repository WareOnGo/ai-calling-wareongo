import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getRawQueueRowsByIds } from "@/lib/raw";
import { assembleBatch, sendBatchToBolna } from "@/lib/dispatch";
import { computeScheduleAt } from "@/lib/routing";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Dispatch a Bolna calling batch — LIVE.
//
// The client sends the selected record ids (+ a filters snapshot) and `confirm: true`.
// The server RE-FETCHES numbers from the DB (never trusts client-supplied numbers),
// re-dedups, applies the region hold-back (TN/Kerala/Karnataka), then:
//   1. persists the batch (state='sending') + items — always, so there's an audit row
//      even if the Bolna call fails;
//   2. creates + schedules the batch on Bolna (multipart CSV upload → /batches, then
//      /batches/{id}/schedule at the ASAP slot);
//   3. updates state -> 'scheduled' + stores bolna_batch_id (calls reconcile back via
//      the webhook: bolna_call_logs.batch_id = call_batches.bolna_batch_id).
// On Bolna failure the batch is marked state='failed' and a 502 is returned.
//
// `confirm` must be true — real phones ring — so an accidental POST is a no-op 400.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter((x: unknown) => typeof x === "string") : [];
  const filters = body?.filters && typeof body.filters === "object" ? body.filters : null;
  if (ids.length === 0) {
    return NextResponse.json({ error: "no records selected" }, { status: 400 });
  }
  if (body?.confirm !== true) {
    return NextResponse.json({ error: "confirmation required — this places live calls" }, { status: 400 });
  }

  const rows = await getRawQueueRowsByIds(ids);
  const summary = assembleBatch(rows);
  const scheduledAt = computeScheduleAt(new Date());

  if (summary.callable.length === 0) {
    return NextResponse.json(
      { error: "nothing callable after routing", heldRegion: summary.heldRegion, skippedNoNumber: summary.skippedNoNumber },
      { status: 400 },
    );
  }

  const agentId = process.env.BOLNA_AGENT_ID ?? null;

  // 1) Persist the batch (audit trail + double-call protection + analytics-by-time).
  const batchRes = await query<{ id: string }>(
    `insert into call_batches
       (created_by, agent_id, scheduled_at, state, filters,
        total, callable, excluded_by_cat, held_region, already_queued, skipped_no_number)
     values ($1, $2, $3, 'sending', $4, $5, $6, $7, $8, $9, $10)
     returning id`,
    [
      user.email,
      agentId,
      scheduledAt,
      filters ? JSON.stringify(filters) : null,
      summary.total,
      summary.callable.length,
      summary.excludedByCat,
      summary.heldRegion,
      summary.alreadyQueued,
      summary.skippedNoNumber,
    ],
  );
  const batchId = batchRes.rows[0].id;

  // Bulk-insert items with a single unnest round-trip.
  await query(
    `insert into call_batch_items (batch_id, record_id, name, contact_number, area, cat)
     select $1, * from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[])`,
    [
      batchId,
      summary.callable.map((r) => r.id),
      summary.callable.map((r) => r.name),
      summary.callable.map((r) => r.contact),
      summary.callable.map((r) => r.area),
      summary.callable.map((r) => r.cat),
    ],
  );

  // 2) Create + schedule on Bolna. On failure, mark the batch and surface the error.
  let bolnaBatchId: string;
  try {
    const sent = await sendBatchToBolna(summary.callable, scheduledAt);
    bolnaBatchId = sent.bolnaBatchId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "dispatch failed";
    await query(`update call_batches set state = 'failed' where id = $1`, [batchId]);
    return NextResponse.json({ error: msg, batchId }, { status: 502 });
  }

  // 3) Mark scheduled + store Bolna's id for later reconciliation.
  await query(
    `update call_batches set state = 'scheduled', bolna_batch_id = $2 where id = $1`,
    [batchId, bolnaBatchId],
  );

  return NextResponse.json({
    scheduled: true,
    batchId,
    bolnaBatchId,
    scheduledAt,
    total: summary.total,
    callable: summary.callable.length,
    excludedByCat: summary.excludedByCat,
    heldRegion: summary.heldRegion,
    alreadyQueued: summary.alreadyQueued,
    skippedNoNumber: summary.skippedNoNumber,
  });
}
