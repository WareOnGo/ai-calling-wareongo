import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, getCurrentAdmin } from "@/lib/auth";
import { updateAssignment, dropAssignment, type AssignmentPatch } from "@/lib/assignments";
import { isOutcome, isAssignmentState } from "@/lib/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Record the outcome of a unit of work. The assignee edits their own; an admin can
// edit any. Ownership is enforced inside the UPDATE (see lib/assignments.ts), so a
// non-owner simply gets 404.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const patch: AssignmentPatch = {};

  if ("outcome" in body) {
    const v = body.outcome;
    if (v !== null && v !== "" && !isOutcome(v)) {
      return NextResponse.json({ error: "outcome must be Available | Unavailable | Unclear" }, { status: 400 });
    }
    patch.outcome = v === "" ? null : (v as AssignmentPatch["outcome"]);
  }
  if ("remarks" in body) {
    patch.remarks = body.remarks == null || body.remarks === "" ? null : String(body.remarks);
  }
  if ("state" in body) {
    if (!isAssignmentState(body.state)) {
      return NextResponse.json({ error: "state must be open | done | dropped" }, { status: 400 });
    }
    patch.state = body.state;
  }
  if (body.log_attempt === true) patch.logAttempt = true;

  const row = await updateAssignment(id, user, patch);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true, ...row });
}

// Unassign — admin only. Closes the assignment without recording an outcome; the
// row stays as history and the entity becomes assignable again.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const ok = await dropAssignment(id);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
