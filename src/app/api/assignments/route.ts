import { NextRequest, NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { assignEntities, validIds, ASSIGN_CAP } from "@/lib/assignments";
import { getUser } from "@/lib/users";
import { getCallIds, type CallFilters } from "@/lib/calls";
import { getRawRecordIds, type RawFilters } from "@/lib/raw";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bulk-assign records or calls to one employee. Admin only.
//
// Two scopes, mirroring the CSV export: an explicit checkbox selection (`ids`), or
// everything matching the current filters (`filters`). In the filters case the
// server RE-RESOLVES the id set from the database — the client sends the filter
// values, never a row list or a count. Same rule as /api/raw/dispatch: the client
// picks the target, the server decides the rows.
export async function POST(req: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const entity = body?.entity_type === "call" ? "call" : body?.entity_type === "record" ? "record" : null;
  if (!entity) {
    return NextResponse.json({ error: "entity_type must be 'record' or 'call'" }, { status: 400 });
  }

  const assignee = typeof body?.assignee === "string" ? body.assignee.trim().toLowerCase() : "";
  if (!assignee) return NextResponse.json({ error: "assignee is required" }, { status: 400 });

  // The FK would catch an unknown email, but an inactive user needs an explicit
  // check — assigning work to a deactivated account would silently black-hole it.
  const target = await getUser(assignee);
  if (!target || !target.active) {
    return NextResponse.json({ error: `${assignee} is not an active user` }, { status: 400 });
  }

  const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim() : null;
  const reassign = body?.reassign === true;

  let ids: string[];
  let capped = false;
  let skippedNoPhone = 0;
  if (Array.isArray(body?.ids) && body.ids.length > 0) {
    ids = validIds(body.ids);
    if (ids.length === 0) return NextResponse.json({ error: "no valid ids" }, { status: 400 });
  } else if (body?.filters && typeof body.filters === "object") {
    const f = body.filters as Record<string, unknown>;
    if (entity === "call") {
      const r = await getCallIds(admin, toCallFilters(f), ASSIGN_CAP);
      ids = r.ids;
      capped = r.capped;
    } else {
      // requirePhone: an unreachable record isn't assignable work (see lib/raw.ts).
      const r = await getRawRecordIds(admin, toRawFilters(f), ASSIGN_CAP, { requirePhone: true });
      ids = r.ids;
      capped = r.capped;
      skippedNoPhone = r.excludedNoPhone;
    }
    if (ids.length === 0) return NextResponse.json({ error: "no rows match those filters" }, { status: 400 });
  } else {
    return NextResponse.json({ error: "provide ids or filters" }, { status: 400 });
  }

  const summary = await assignEntities({
    entity, ids, assignee, assignedBy: admin.email, note, reassign,
  });

  return NextResponse.json({ ok: true, assignee, ...summary, skippedNoPhone, capped: capped || summary.capped });
}

// Filter parsing mirrors the two dashboard pages. Kept local (and explicit) so an
// arbitrary client-supplied key can never reach a filter builder.
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown) => (v == null || v === "" ? undefined : Number(v));

function toCallFilters(f: Record<string, unknown>): CallFilters {
  return {
    q: str(f.q), availability: str(f.availability), agent_id: str(f.agent_id),
    status: str(f.status), source: str(f.source), state: str(f.state),
    contact: str(f.contact), call_type: str(f.call_type),
    date_from: str(f.date_from), date_to: str(f.date_to),
    needs_review: f.needs_review === "1" || f.needs_review === true,
    assignee: str(f.assignee),
  };
}

function toRawFilters(f: Record<string, unknown>): RawFilters {
  return {
    q: str(f.q), source: str(f.source), state: str(f.state), city: str(f.city),
    warehouse_type: str(f.warehouse_type), contact: str(f.contact),
    called: str(f.called), last_result: str(f.last_result),
    min_area: num(f.min_area), max_area: num(f.max_area),
    has_phone: f.has_phone === "1" || f.has_phone === true,
    assignee: str(f.assignee),
  };
}
