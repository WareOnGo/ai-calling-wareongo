import { z } from "zod";
import { jsonBody, apiError, selectedIds } from "@/lib/api";
import { toCallFilters, toRawFilters } from "@/lib/filters";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { assignEntities, ASSIGN_CAP } from "@/lib/assignments";
import { getUser } from "@/lib/users";
import { getCallIds } from "@/lib/calls";
import { getRawRecordIds } from "@/lib/raw";

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

  try {
  const body = await jsonBody(req, z.object({
    entity_type: z.enum(["record", "call"]), assignee: z.string().trim().email(), note: z.string().trim().max(10000).nullable().optional(),
    reassign: z.boolean().optional(), ids: selectedIds.optional(), filters: z.record(z.unknown()).optional(),
  }).strict().refine(v => !!v.ids !== !!v.filters, "Provide either ids or filters"));
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
    ids = body.ids;
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
  } catch (error) { return apiError(error); }
}
