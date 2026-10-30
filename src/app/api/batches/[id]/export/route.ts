import {searchValues} from "@/lib/filter-values";
import {NextRequest,NextResponse} from 'next/server';
import {getCurrentAdmin} from '@/lib/auth';
import {getBatch,batchMembersExport,batchMemberFiltersSchema,type BatchMember} from '@/lib/batch-browser';
import {csvResponse} from '@/lib/export';
import {apiError,ApiError} from '@/lib/api';
export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 const user=await getCurrentAdmin();if(!user)return NextResponse.json({error:'forbidden'},{status:403});try{
  const kind=req.nextUrl.searchParams.get('kind');if(kind!=='ai'&&kind!=='manual')throw new ApiError(400,'Choose AI or manual');
  const batch=await getBatch(user,kind,(await params).id),metric=req.nextUrl.searchParams.get('metric')||'all';
  const columns=['member_id','entity_type','entity_id','assignment_id','name','phone','city','assignee','current_owner','disposition','state','outcome','attempts','connected','onboarded','wh_id','quality_issue','status','execution_id'] as const;
  return csvResponse<BatchMember>(batchMembersExport(user,batch,metric,batchMemberFiltersSchema.parse(searchValues(new URLSearchParams([...req.nextUrl.searchParams].filter(([,v])=>v))))),[
    ...columns.map(key=>({label:key,get:(r:BatchMember)=>r[key]})),
    {label:'warehouse_match',get:r=>r.warehouse_ids.length?'yes':'no'},
    {label:'warehouse_ids',get:r=>r.warehouse_ids.join('; ')},
  ],`callongo-${kind}-batch-members.csv`);
 }catch(error){return apiError(error);}
}
