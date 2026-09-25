import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { jsonBody, apiError, uuid, nullableText, revision } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const patchSchema = z.object({
  call_status: nullableText.optional(), called_by: nullableText.optional(),
  added_to_db: z.boolean().optional(), wh_id: nullableText.optional(), revision,
}).strict().refine(v => Object.keys(v).length > 1, "No editable fields provided");
const columns = { call_status: "m_call_status", called_by: "called_by", added_to_db: "added_to_db", wh_id: "wh_id" } as const;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const id = uuid.parse((await params).id);
    const body = await jsonBody(req, patchSchema);
    const vals: unknown[] = [id, body.revision];
    const sets = ["revision = revision + 1"];
    for (const key of Object.keys(columns) as (keyof typeof columns)[]) {
      if (body[key] !== undefined) { vals.push(body[key]); sets.push(`${columns[key]} = $${vals.length}`); }
    }
    let ownership = "";
    if (!user.isAdmin) {
      vals.push(user.email.toLowerCase());
      ownership = ` and exists (select 1 from bolna_assignments a where a.entity_type = 'call'
        and a.entity_id = bolna_call_logs.id and a.state = 'open' and a.assignee = $${vals.length})`;
    }
    const res = await query(`update bolna_call_logs set ${sets.join(", ")}
      where id = $1 and revision = $2${ownership} returning revision`, vals);
    if (!res.rowCount) return NextResponse.json({ error: "Call changed or is no longer editable. Refresh to review the latest version." }, { status: 409 });
    return NextResponse.json({ ok: true, ...res.rows[0] });
  } catch (error) { return apiError(error); }
}
