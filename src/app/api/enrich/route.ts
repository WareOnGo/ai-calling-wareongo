import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { inferCall, INFERENCE_VERSION } from "@/lib/openai";
import { inferenceFields, MIN_COST_CENTS } from "@/lib/inference";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Bulk "enrich later" pass over call_logs (e.g. the historical backfill).
// Selects calls that pass the cost gate and haven't been inferred at the current
// version, runs OpenAI, and writes the inference fields back. Idempotent + resumable:
// re-running only picks up rows still needing inference. Run single-runner (drain loop).

const BATCH = Number.parseInt(process.env.ENRICH_BATCH_SIZE || "24", 10);
const CONCURRENCY = Number.parseInt(process.env.ENRICH_CONCURRENCY || "4", 10);

type Row = { id: string; transcript: string | null };

function authorized(req: NextRequest): boolean {
  const secret = process.env.PROCESS_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ")
    ? auth.slice(7)
    : req.nextUrl.searchParams.get("token");
  return token === secret;
}

async function claimRows(): Promise<Row[]> {
  const { rows } = await getPool().query<Row>(
    `select id, transcript
       from call_logs
      where status = 'completed'
        and total_cost > $1
        and length(trim(coalesce(transcript, ''))) > 0
        and (enriched = false or inference_version < $2)
      order by total_cost desc
      limit $3`,
    [MIN_COST_CENTS, INFERENCE_VERSION, BATCH],
  );
  return rows;
}

async function enrichRow(row: Row) {
  const f = inferenceFields(await inferCall(row.transcript));
  await getPool().query(
    `update call_logs set
       llm_availability   = $2,
       built_up_area_sqft = $3,
       city_area          = $4,
       expected_rent      = $5,
       possession         = $6,
       confidence         = $7,
       notes              = $8,
       enrichment         = $9,
       enriched           = true,
       inference_version  = $10,
       inference_model    = $11,
       needs_review       = $12,
       processed_at       = now()
     where id = $1`,
    [
      row.id,
      f.llm_availability,
      f.built_up_area_sqft,
      f.city_area,
      f.expected_rent,
      f.possession,
      f.confidence,
      f.notes,
      f.inference,
      f.inference_version,
      f.inference_model,
      f.needs_review,
    ],
  );
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const rows = await claimRows();
  let succeeded = 0;
  let failed = 0;

  // Process with bounded concurrency (workers pull from a shared cursor).
  let cursor = 0;
  async function worker() {
    while (cursor < rows.length) {
      const row = rows[cursor++];
      try {
        await enrichRow(row);
        succeeded++;
      } catch (err) {
        failed++;
        console.error(`[enrich] ${row.id} failed:`, err instanceof Error ? err.message : err);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));

  return NextResponse.json({ claimed: rows.length, succeeded, failed });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
