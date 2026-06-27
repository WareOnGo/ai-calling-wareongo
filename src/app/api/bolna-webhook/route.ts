import { NextRequest, NextResponse } from "next/server";
import { executionSchema, isTerminal } from "@/lib/bolna";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---- Part A: catch & save. No external calls. Must be fast + reliable. ----

function authorized(req: NextRequest): { ok: true } | { ok: false; reason: string } {
  const secret = process.env.BOLNA_WEBHOOK_SECRET;
  if (!secret) return { ok: false, reason: "server missing BOLNA_WEBHOOK_SECRET" };

  const token =
    req.nextUrl.searchParams.get("token") || req.headers.get("x-webhook-secret");
  if (token !== secret) return { ok: false, reason: "bad token" };

  if (process.env.ENFORCE_BOLNA_IP === "true") {
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
    const allowed = process.env.BOLNA_WEBHOOK_IP || "13.203.39.153";
    if (ip !== allowed) return { ok: false, reason: `ip ${ip} not allowed` };
  }
  return { ok: true };
}

export async function POST(req: NextRequest) {
  const auth = authorized(req);
  if (!auth.ok) {
    return NextResponse.json({ error: "unauthorized", reason: auth.reason }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = executionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid payload", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  const e = parsed.data;

  // Bolna fires on every status change. Only the final state matters here.
  if (!isTerminal(e.status)) {
    return NextResponse.json({ ok: true, ignored: `non-terminal status: ${e.status}` });
  }

  try {
    // Idempotent: a duplicate terminal fire for the same execution is a no-op.
    await query(
      `insert into webhook_events (id, raw, status, next_attempt_at)
       values ($1, $2, 'pending', now())
       on conflict (id) do nothing`,
      [e.id, body],
    );
  } catch (err) {
    console.error("[bolna-webhook] landing insert failed", err);
    // We did NOT safely capture the event -> 5xx so it can be redelivered.
    return NextResponse.json({ error: "storage failure" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, captured: e.id });
}
