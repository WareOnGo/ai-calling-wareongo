import { NextResponse } from "next/server";
import { apiError, workerAuthorized } from "@/lib/api";
import { syncCallyzer } from "@/lib/callyzer-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!workerAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const result = await syncCallyzer();
    return NextResponse.json(result, { status: result.status === "retry_scheduled" || result.status === "not_configured" ? 503 : 200 });
  } catch (error) { return apiError(error); }
}
