import { NextResponse } from "next/server";
import { query } from "@/lib/db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const events = (await query(`select
      count(*) filter (where status in ('pending','failed') and attempts < max_attempts)::int as pending,
      count(*) filter (where status = 'processing')::int as processing,
      count(*) filter (where status = 'processing' and lease_until <= now())::int as expired_leases,
      count(*) filter (where status <> 'processed' and attempts >= max_attempts)::int as exhausted
      from bolna_webhook_events`)).rows[0];
    const jobs = (await query(`select count(*) filter (where completed_at is null and attempts >= 8)::int as exhausted,
      count(*) filter (where completed_at is null and lease_until <= now())::int as expired_leases from bolna_call_jobs`)).rows[0];
    return NextResponse.json({ ok: true, db: "up", pending: events.pending, events, jobs });
  } catch (error) {
    console.error("[health] database check failed", error);
    return NextResponse.json({ ok: false, db: "down" }, { status: 503 });
  }
}
