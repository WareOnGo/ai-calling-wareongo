import { NextRequest, NextResponse } from "next/server";
import { workerAuthorized, apiError } from "@/lib/api";
import { runCallJobs } from "@/lib/call-jobs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function POST(req: NextRequest) {
  if (!workerAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { return NextResponse.json(await runCallJobs("district")); } catch (error) { return apiError(error); }
}
export const GET = POST;
