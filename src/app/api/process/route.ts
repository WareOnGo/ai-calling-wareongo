import { NextRequest, NextResponse } from "next/server";
import { workerAuthorized, apiError } from "@/lib/api";
import { runEvents } from "@/lib/process-events";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(req: NextRequest) {
  if (!workerAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { return NextResponse.json(await runEvents()); } catch (error) { return apiError(error); }
}
export const GET = POST;
