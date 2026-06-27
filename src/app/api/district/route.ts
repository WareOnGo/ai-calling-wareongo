import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { inferDistrict } from "@/lib/openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Infer district/city for calls where the source DB gave no `area`, using the
// transcript + city_area hint. Only rows with some signal are attempted; the
// rest are marked '' (tried, undeterminable) so they aren't re-selected.

const BATCH = Number.parseInt(process.env.DISTRICT_BATCH_SIZE || "24", 10);
const CONCURRENCY = Number.parseInt(process.env.ENRICH_CONCURRENCY || "4", 10);

type Row = { id: string; transcript: string | null; city_area: string | null };

function authorized(req: NextRequest): boolean {
  const secret = process.env.PROCESS_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : req.nextUrl.searchParams.get("token");
  return token === secret;
}

async function claimRows(): Promise<Row[]> {
  const { rows } = await getPool().query<Row>(
    `select id, transcript, city_area
       from call_logs
      where context_details -> 'recipient_data' ->> 'area' is null
        and inferred_district is null
        and (length(trim(coalesce(transcript, ''))) > 20
             or length(trim(coalesce(city_area, ''))) > 0)
      limit $1`,
    [BATCH],
  );
  return rows;
}

async function inferRow(row: Row) {
  const { district } = await inferDistrict(row.transcript, row.city_area);
  await getPool().query(
    `update call_logs set inferred_district = $2 where id = $1`,
    [row.id, district ?? ""],
  );
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await claimRows();
  let succeeded = 0;
  let failed = 0;
  let cursor = 0;
  async function worker() {
    while (cursor < rows.length) {
      const row = rows[cursor++];
      try {
        await inferRow(row);
        succeeded++;
      } catch (err) {
        failed++;
        console.error(`[district] ${row.id} failed:`, err instanceof Error ? err.message : err);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));
  return NextResponse.json({ claimed: rows.length, succeeded, failed });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
