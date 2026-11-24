import { NextRequest,NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { apiError,jsonBody,ApiError } from "@/lib/api";
import { assignmentRequestSchema,resolveAssignment } from "@/lib/assignment-request";
import { previewAssignment } from "@/lib/assignment-allocation";
import { getAssigneeWorkloads } from "@/lib/users";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(req:NextRequest){
  const admin=await getCurrentAdmin();
  if(!admin)return NextResponse.json({error:"forbidden"},{status:403});
  try{
    const requested=Number(req.nextUrl.searchParams.get('page')||1);
    if(!Number.isSafeInteger(requested)||requested<1)throw new ApiError(400,'Invalid preview page');
    const body=await jsonBody(req,assignmentRequestSchema),{options,capped}=await resolveAssignment(body,admin);
    const [preview,workloads]=await Promise.all([previewAssignment(options),getAssigneeWorkloads()]);
    const pageSize=50,pages=Math.max(1,Math.ceil(preview.items.length/pageSize)),page=Math.min(pages,requested);
    // Older clients expect the complete preview. The current dialog explicitly
    // requests a page, so it only downloads the records currently being shown.
    return NextResponse.json({...preview,items:req.nextUrl.searchParams.has('page')?preview.items.slice((page-1)*pageSize,page*pageSize):preview.items,
      page,pages,pageSize,itemTotal:preview.items.length,capped:capped||preview.capped,workloads},{headers:{'Cache-Control':'no-store'}});
  }catch(error){return apiError(error);}
}
