import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { enrichCallById } from "@/lib/enrich";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One OpenAI call — keep headroom over the default serverless timeout.
export const maxDuration = 60;

// Re-run OpenAI inference for a single call (the dashboard "Infer" button on
// rows that landed unenriched, e.g. during an OpenAI outage). Returns the fresh
// inference fields so the client can update the row in place.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    const res = await enrichCallById(id);
    if (!res.ok) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true, ...res.fields });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[calls/${id}/enrich] failed:`, msg);
    // 502: the upstream (OpenAI) failed, not the client's request.
    return NextResponse.json({ error: msg.slice(0, 300) }, { status: 502 });
  }
}
