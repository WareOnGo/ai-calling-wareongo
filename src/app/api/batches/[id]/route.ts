import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentAdmin } from "@/lib/auth";
import { apiError, jsonBody, uuid } from "@/lib/api";
import { reconcileBatch, resolveBatch } from "@/lib/batch-reconciliation";
export const maxDuration = 60;
const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reconcile") }).strict(),
  z.object({ action: z.literal("resolve"), state: z.enum(["completed", "canceled"]),
    note: z.string().trim().min(10).max(2000), confirmedNoPendingCalls: z.literal(true) }).strict(),
]);
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentAdmin();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    const id = uuid.parse((await params).id), body = await jsonBody(req, action);
    if (body.action === "reconcile") return NextResponse.json({ ok: true, batch: await reconcileBatch(id) });
    await resolveBatch(id, body.state, body.note, user.email);
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
