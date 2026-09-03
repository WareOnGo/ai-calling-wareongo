import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Map editable API field -> (db column, coercion). Anything else is rejected.
const FIELDS: Record<string, { col: string; coerce: (v: unknown) => unknown }> = {
  call_status: { col: "m_call_status", coerce: (v) => (v == null ? null : String(v)) },
  called_by: { col: "called_by", coerce: (v) => (v == null || v === "" ? null : String(v)) },
  added_to_db: { col: "added_to_db", coerce: (v) => Boolean(v) },
  wh_id: { col: "wh_id", coerce: (v) => (v == null || v === "" ? null : String(v)) },
};

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [key, spec] of Object.entries(FIELDS)) {
    if (key in body) {
      vals.push(spec.coerce(body[key]));
      sets.push(`${spec.col} = $${vals.length}`);
    }
  }
  if (sets.length === 0) {
    return NextResponse.json({ error: "no editable fields provided" }, { status: 400 });
  }

  vals.push(id);
  const idParam = `$${vals.length}`;

  // Employees may only edit calls currently assigned to them. Enforced INSIDE the
  // update rather than as a pre-check: no TOCTOU window, and a non-owner falls
  // straight through to the existing rowCount===0 → 404 path.
  let ownership = "";
  if (!user.isAdmin) {
    vals.push(user.email.toLowerCase());
    ownership = ` and exists (select 1 from bolna_assignments a
                    where a.entity_type = 'call' and a.entity_id = bolna_call_logs.id
                      and a.state <> 'dropped' and a.assignee = $${vals.length})`;
  }

  const res = await query(
    `update bolna_call_logs set ${sets.join(", ")} where id = ${idParam}${ownership}`,
    vals,
  );
  if (res.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
