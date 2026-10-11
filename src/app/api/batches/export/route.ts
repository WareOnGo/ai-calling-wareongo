import {NextRequest,NextResponse} from 'next/server';
import {getCurrentAdmin} from '@/lib/auth';
import {batchListSchema,batchListExport,type BatchRow} from '@/lib/batch-browser';
import {csvResponse} from '@/lib/export';
import {apiError} from '@/lib/api';
export async function GET(req:NextRequest){const user=await getCurrentAdmin();if(!user)return NextResponse.json({error:'forbidden'},{status:403});try{
 const filters=batchListSchema.parse(Object.fromEntries([...req.nextUrl.searchParams].filter(([,v])=>v)));
 const columns=['id','kind','created_at','created_by','state','entity_type','agent_id','agent_language','dispatch_request_id','bolna_batch_id','assignees'] as const;
 return csvResponse<BatchRow>(batchListExport(user,filters),columns.map(key=>({label:key,get:r=>Array.isArray(r[key])?(r[key] as string[]).join('; '):r[key]})),`bolna-${filters.kind}-batches.csv`);
}catch(error){return apiError(error);}}
