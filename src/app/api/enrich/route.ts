import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { inferCall, INFERENCE_VERSION } from "@/lib/openai";
import { MIN_COST_CENTS, NEEDS_INFERENCE_SQL } from "@/lib/inference";
import { writeInference } from "@/lib/enrich";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Bulk "enrich later" pass over bolna_call_logs (e.g. the historical backfill).
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
       from bolna_call_logs
      where ${NEEDS_INFERENCE_SQL}
      order by total_cost desc
      limit $3`,
    [MIN_COST_CENTS, INFERENCE_VERSION, BATCH],
  );
  return rows;
}

async function enrichRow(row: Row) {
  // Transcript already in hand from the bulk claim — infer here, share the write.
  await writeInference(row.id, await inferCall(row.transcript));
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
