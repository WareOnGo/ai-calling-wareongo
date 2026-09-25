import { z } from "zod";
import { apiError, uuid, ApiError } from "@/lib/api";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { enrichCallById } from "@/lib/call-jobs";
import { ownsEntity } from "@/lib/assignments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One OpenAI call — keep headroom over the default serverless timeout.
export const maxDuration = 60;

// Re-run OpenAI inference for a single call (the dashboard "Infer" button on
// rows that landed unenriched, e.g. during an OpenAI outage). Returns the fresh
// inference fields so the client can update the row in place.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
  const id = uuid.parse((await params).id);
  // Single-id action: can't go through a filter builder, so check ownership directly.
  // Same 404 as a missing row — don't confirm the call exists to a non-owner.
  if (!(await ownsEntity(user, "call", id))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
    const text = await req.text();
    let data: unknown;
    try { data = text ? JSON.parse(text) : {}; } catch { throw new ApiError(400, "Invalid JSON body"); }
    const body = z.object({ force: z.boolean().optional() }).strict().parse(data);
    const res = await enrichCallById(id, user, body.force);
    if (!res.ok) return NextResponse.json({ error: "Call changed during inference; refresh and retry" }, { status: 409 });
    return NextResponse.json({ ok: true, ...res.fields });
  } catch (err) {
    return apiError(err);
  }
}
