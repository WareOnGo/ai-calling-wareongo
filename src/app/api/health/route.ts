import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { rows } = await query<{ pending: string }>(
      `select count(*)::text as pending from bolna_webhook_events
        where status in ('pending', 'failed')`,
    );
    return NextResponse.json({ ok: true, db: "up", pending: Number(rows[0].pending) });
  } catch (err) {
    return NextResponse.json(
      { ok: false, db: "down", error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
