import {NextResponse} from 'next/server';
import {z} from 'zod';
import {getCurrentAdmin} from '@/lib/auth';
import {apiError,jsonBody} from '@/lib/api';
import {bulkAssignments} from '@/lib/bulk-assignments';

export const runtime='nodejs';
export const dynamic='force-dynamic';
async function handle(req:Request,apply:boolean) {
  const admin=await getCurrentAdmin();
  if(!admin)return NextResponse.json({error:'forbidden'},{status:403});
  try{return NextResponse.json(await bulkAssignments(admin,await jsonBody(req,z.unknown()),apply));}
  catch(error){return apiError(error);}
}
export const POST=(req:Request)=>handle(req,false);
export const PATCH=(req:Request)=>handle(req,true);
