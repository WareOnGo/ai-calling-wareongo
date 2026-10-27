import { NextRequest,NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { apiError,bigintId,jsonBody } from "@/lib/api";
import { manualAttemptSchema,recordManualAttempt } from "@/lib/manual-attempts";
import { query } from "@/lib/db";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){
  const user=await getCurrentUser();if(!user)return NextResponse.json({error:"unauthorized"},{status:401});
  try{return NextResponse.json({ok:true,...await recordManualAttempt(bigintId.parse((await params).id),user,await jsonBody(req,manualAttemptSchema))});}
  catch(error){return apiError(error);}
}
export async function GET(_req:NextRequest,{params}:{params:Promise<{id:string}>}){
  const user=await getCurrentUser();if(!user)return NextResponse.json({error:"unauthorized"},{status:401});
  try{
    const id=bigintId.parse((await params).id);
    const rows=(await query(`select e.* from bolna_effective_manual_attempts e join bolna_assignments a on a.id=e.assignment_id
      where a.id=$1 and ($2::boolean or a.assignee=$3 and a.state<>'dropped') order by e.occurred_at desc,e.created_at desc limit 50`,[id,user.isAdmin,user.email.toLowerCase()])).rows;
    return NextResponse.json({rows});
  }catch(error){return apiError(error);}
}
