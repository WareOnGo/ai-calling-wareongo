import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { apiError, bigintId, jsonBody, revision } from "@/lib/api";
import { STAGE_SLUGS, type Stage } from "@/lib/board-stages";
import { moveCard } from "@/lib/board-moves";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  tasks: z.array(z.object({ id: bigintId, revision }).strict()).min(1).max(50),
  stage: z.enum(STAGE_SLUGS as [Stage, ...Stage[]]),
  reason: z.string().max(40).nullable().optional(),
  wh_id: z.string().max(100).nullable().optional(),
}).strict();

// Moves one card: every task the client sends, all or nothing.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const body = await jsonBody(req, schema);
    const tasks = await moveCard(user, { tasks: body.tasks, stage: body.stage, reason: body.reason, whId: body.wh_id }, req.nextUrl.searchParams.get("employee"));
    return NextResponse.json({ tasks });
  } catch (error) { return apiError(error); }
}
