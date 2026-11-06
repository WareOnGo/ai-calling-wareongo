import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { ownWork } from "@/lib/board";
import { apiError, bigintId } from "@/lib/api";
import { cardTimeline } from "@/lib/board-moves";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ids = z.array(bigintId).min(1).max(50);

// Only the viewer's own tasks contribute events. Logged calls are for admins only:
// employees, including admins in Employee view, do not see manual call records.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const tasks = ids.parse([...new Set(req.nextUrl.searchParams.getAll("task"))]);
    return NextResponse.json({ events: await cardTimeline(ownWork(user), tasks, { includeCalls: user.isAdmin }) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
