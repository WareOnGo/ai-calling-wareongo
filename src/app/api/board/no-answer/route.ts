import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { ownWork } from "@/lib/board";
import { apiError, bigintId, jsonBody, revision } from "@/lib/api";
import { logNoAnswer } from "@/lib/board-moves";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ tasks: z.array(z.object({ id: bigintId, revision }).strict()).min(1).max(50) }).strict();

// One unanswered call per open task per IST day; repeats the same day count once.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await logNoAnswer(ownWork(user), await jsonBody(req, schema)));
  } catch (error) { return apiError(error); }
}
