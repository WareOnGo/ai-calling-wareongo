import { NextRequest, NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { jsonBody, apiError } from "@/lib/api";
import { dispatchBatch, dispatchSchema } from "@/lib/dispatch-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function POST(req: NextRequest) {
  const user = await getCurrentAdmin();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    const result = await dispatchBatch(user, await jsonBody(req, dispatchSchema));
    return NextResponse.json(result, { status: result.scheduled ? 200 : 202 });
  } catch (error) { return apiError(error); }
}
