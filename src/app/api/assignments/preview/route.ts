import { NextRequest,NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { apiError,jsonBody } from "@/lib/api";
import { assignmentRequestSchema,resolveAssignment } from "@/lib/assignment-request";
import { previewAssignment } from "@/lib/assignment-allocation";
import { getAssigneeWorkloads } from "@/lib/users";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(req:NextRequest){
  const admin=await getCurrentAdmin();
  if(!admin)return NextResponse.json({error:"forbidden"},{status:403});
  try{
    const body=await jsonBody(req,assignmentRequestSchema),{options,capped}=await resolveAssignment(body,admin);
    const [preview,workloads]=await Promise.all([previewAssignment(options),getAssigneeWorkloads()]);
    return NextResponse.json({...preview,capped:capped||preview.capped,workloads});
  }catch(error){return apiError(error);}
}
