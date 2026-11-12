import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { apiError, bigintId, jsonBody, revision } from "@/lib/api";
import { setFollowUp } from "@/lib/board-moves";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TWO_YEARS = 2 * 366 * 86400_000;
const schema = z.object({
  tasks: z.array(z.object({ id: bigintId, revision }).strict()).min(1).max(50),
  next_due_at: z.string().datetime({ offset: true }).refine(value => Math.abs(Date.parse(value) - Date.now()) < TWO_YEARS, "Choose a date within two years").nullable(),
}).strict();

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const body = await jsonBody(req, schema);
    return NextResponse.json({ tasks: await setFollowUp(user, { tasks: body.tasks, nextDueAt: body.next_due_at }, req.nextUrl.searchParams.get("employee")) });
  } catch (error) { return apiError(error); }
}
