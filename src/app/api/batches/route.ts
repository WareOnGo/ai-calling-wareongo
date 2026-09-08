import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { query } from "@/lib/db";

export async function GET() {
  if (!await getCurrentAdmin()) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const result = await query(`with recent as materialized (
      select id, created_at, created_by, scheduled_at, state, callable, held_region, bolna_batch_id
      from call_batches order by created_at desc limit 20
    ), received as (
      select c.batch_id, count(*)::int as n from bolna_call_logs c
      where c.batch_id in (select bolna_batch_id from recent where bolna_batch_id is not null)
      group by c.batch_id
    ) select r.*, coalesce(received.n, 0) as results_received
      from recent r left join received on received.batch_id = r.bolna_batch_id
      order by r.created_at desc`);
  return NextResponse.json({ batches: result.rows, updatedAt: new Date().toISOString() });
}
