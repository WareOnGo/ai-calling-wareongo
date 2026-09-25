import { NextRequest, NextResponse } from "next/server";
import { apiError, workerAuthorized } from "@/lib/api";
import { reconcileBatches } from "@/lib/batch-reconciliation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function POST(req: NextRequest) {
  if (!workerAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { return NextResponse.json(await reconcileBatches()); } catch (error) { return apiError(error); }
}
export const GET = POST;
