import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { executionSchema, normalize } from "@/lib/bolna";
import { inferCall } from "@/lib/openai";
import { ENABLE_ENRICHMENT, qualifiesForInference, inferenceFields } from "@/lib/inference";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Worker may run for a while (OpenAI calls). Raise on Vercel Pro; Hobby caps lower.
export const maxDuration = 60;

// ---- Part B: drain pending events, enrich, store. Retried on failure. ----

const BATCH = Number.parseInt(process.env.PROCESS_BATCH_SIZE || "5", 10);

type ClaimedRow = {
  id: string;
  raw: unknown;
  attempts: number;
  max_attempts: number;
};

function authorized(req: NextRequest): boolean {
  const secret = process.env.PROCESS_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ")
    ? auth.slice(7)
    : req.nextUrl.searchParams.get("token");
  return token === secret;
}

// Exponential backoff in minutes, capped at 60.
function backoffInterval(nextAttempt: number): string {
  const minutes = Math.min(2 ** nextAttempt, 60);
  return `${minutes} minutes`;
}

// Atomically grab a batch of due rows and flip them to 'processing'
// so overlapping worker runs never pick the same row (skip locked).
async function claimBatch(): Promise<ClaimedRow[]> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<ClaimedRow>(
      `select id, raw, attempts, max_attempts
         from webhook_events
        where status in ('pending', 'failed')
          and attempts < max_attempts
          and next_attempt_at <= now()
        order by next_attempt_at
        limit $1
        for update skip locked`,
      [BATCH],
    );
    if (rows.length > 0) {
      await client.query(
        `update webhook_events set status = 'processing'
          where id = any($1::uuid[])`,
        [rows.map((r) => r.id)],
      );
    }
    await client.query("commit");
    return rows;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

async function processEvent(row: ClaimedRow) {
  const pool = getPool();
  try {
    const e = executionSchema.parse(row.raw);
    const c = normalize(e);
    const shouldInfer =
      ENABLE_ENRICHMENT && qualifiesForInference(c.status, c.total_cost, c.transcript);
    const inf = shouldInfer ? await inferCall(c.transcript) : null;
    const f = inferenceFields(inf);

    await pool.query(
      `insert into call_logs (
         id, agent_id, batch_id, status, call_type, from_number, to_number,
         duration_secs, total_cost, cost_breakdown, recording_url, hangup_by,
         hangup_reason, answered_by_vm, transcript, context_details, raw, call_created_at,
         llm_availability, built_up_area_sqft, city_area, expected_rent, possession,
         confidence, notes, enrichment, enriched, inference_version, inference_model,
         needs_review, processed_at
       ) values (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
         $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30, now()
       )
       on conflict (id) do update set
         status          = excluded.status,
         transcript      = excluded.transcript,
         context_details = excluded.context_details,
         raw             = excluded.raw,
         -- only overwrite inference when this run actually inferred
         llm_availability   = case when excluded.enriched then excluded.llm_availability   else call_logs.llm_availability   end,
         built_up_area_sqft = case when excluded.enriched then excluded.built_up_area_sqft else call_logs.built_up_area_sqft end,
         city_area          = case when excluded.enriched then excluded.city_area          else call_logs.city_area          end,
         expected_rent      = case when excluded.enriched then excluded.expected_rent      else call_logs.expected_rent      end,
         possession         = case when excluded.enriched then excluded.possession         else call_logs.possession         end,
         confidence         = case when excluded.enriched then excluded.confidence         else call_logs.confidence         end,
         notes              = case when excluded.enriched then excluded.notes              else call_logs.notes              end,
         enrichment         = case when excluded.enriched then excluded.enrichment         else call_logs.enrichment         end,
         inference_model    = case when excluded.enriched then excluded.inference_model    else call_logs.inference_model    end,
         needs_review       = case when excluded.enriched then excluded.needs_review       else call_logs.needs_review       end,
         enriched           = call_logs.enriched or excluded.enriched,
         inference_version  = greatest(call_logs.inference_version, excluded.inference_version),
         processed_at       = now()`,
      [
        c.id,
        c.agent_id,
        c.batch_id,
        c.status,
        c.call_type,
        c.from_number,
        c.to_number,
        c.duration_secs,
        c.total_cost,
        c.cost_breakdown,
        c.recording_url,
        c.hangup_by,
        c.hangup_reason,
        c.answered_by_vm,
        c.transcript,
        c.context_details,
        row.raw,
        c.call_created_at,
        f.llm_availability,
        f.built_up_area_sqft,
        f.city_area,
        f.expected_rent,
        f.possession,
        f.confidence,
        f.notes,
        f.inference, // raw inference object -> jsonb
        f.enriched,
        f.inference_version,
        f.inference_model,
        f.needs_review,
      ],
    );

    await pool.query(
      `update webhook_events
          set status = 'processed', processed_at = now(), last_error = null
        where id = $1`,
      [c.id],
    );
    return { id: c.id, ok: true as const };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const nextAttempt = row.attempts + 1;
    await pool.query(
      `update webhook_events
          set status          = 'failed',
              attempts        = attempts + 1,
              last_error      = $2,
              next_attempt_at = now() + ($3)::interval
        where id = $1`,
      [row.id, msg.slice(0, 1000), backoffInterval(nextAttempt)],
    );
    console.error(`[process] event ${row.id} failed (attempt ${nextAttempt}):`, msg);
    return { id: row.id, ok: false as const, error: msg };
  }
}

async function run() {
  const batch = await claimBatch();
  const results = [];
  // Sequential to stay friendly to OpenAI rate limits and the function time budget.
  for (const row of batch) {
    results.push(await processEvent(row));
  }
  return {
    claimed: batch.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await run());
  } catch (err) {
    console.error("[process] run failed", err);
    return NextResponse.json({ error: "process run failed" }, { status: 500 });
  }
}

// Allow GET too, so a simple scheduler can trigger it with a token query param.
export async function GET(req: NextRequest) {
  return POST(req);
}
