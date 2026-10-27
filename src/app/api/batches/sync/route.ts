import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentAdmin } from "@/lib/auth";
import { apiError, jsonBody, uuid } from "@/lib/api";
import { syncVisibleBatches } from "@/lib/batch-reconciliation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const schema = z.object({ids:z.array(uuid).max(25)}).strict();
export async function POST(req:NextRequest) {
  try {
    const user=await getCurrentAdmin();
    if(!user)return NextResponse.json({error:"forbidden"},{status:403});
    const body=await jsonBody(req,schema);
    return NextResponse.json(await syncVisibleBatches(body.ids));
  } catch(error) { return apiError(error); }
}
