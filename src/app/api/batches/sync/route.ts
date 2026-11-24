import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentAdmin } from "@/lib/auth";
import { apiError, jsonBody, uuid } from "@/lib/api";
import { syncVisibleBatches } from "@/lib/batch-reconciliation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const schema = z.object({ids:z.array(uuid).max(25),background:z.boolean().optional()}).strict();
export async function POST(req:NextRequest) {
  try {
    const user=await getCurrentAdmin();
    if(!user)return NextResponse.json({error:"forbidden"},{status:403});
    const body=await jsonBody(req,schema);
    if(body.background) {
      after(async()=>{
        try { await syncVisibleBatches(body.ids); }
        catch(error) { console.error('Batch status sync failed',{error:error instanceof Error?error.name:'Unknown'}); }
      });
      return NextResponse.json({queued:true},{status:202});
    }
    return NextResponse.json(await syncVisibleBatches(body.ids));
  } catch(error) { return apiError(error); }
}
