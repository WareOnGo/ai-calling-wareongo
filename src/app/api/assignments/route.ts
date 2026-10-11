import { NextRequest, NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { jsonBody, apiError } from "@/lib/api";
import { assignEntities, assignmentReplay } from "@/lib/assignment-allocation";
import { assignmentRequestSchema, requestIdentity, resolveAssignment } from "@/lib/assignment-request";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    const body = await jsonBody(req, assignmentRequestSchema), identity = requestIdentity(body);
    // Replay before resolving filters: assigning can remove rows from Unassigned now.
    const replay = body.intentKey ? await assignmentReplay(admin.email, identity.intentKey, identity.requestHash) : null;
    if (replay) return NextResponse.json({ ok: true, assignee: body.assignee, ...replay });
    const { options, capped } = await resolveAssignment(body, admin);
    const summary = await assignEntities({ ...options, ...identity });
    return NextResponse.json({ ok: true, assignee: body.assignee, ...summary, capped: capped || summary.capped });
  } catch (error) { return apiError(error); }
}
