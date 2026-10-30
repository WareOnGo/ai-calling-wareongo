import {NextRequest,NextResponse} from 'next/server';
import {getCurrentUser} from '@/lib/auth';
import {apiError,uuid,ApiError} from '@/lib/api';
import {aiHistory} from '@/lib/ai-attempts';
export async function GET(req:NextRequest,{params}:{params:Promise<{entity:string;id:string}>}){
 const viewer=await getCurrentUser();if(!viewer)return NextResponse.json({error:'unauthorized'},{status:401});
 try{
  const {entity,id}=await params;if(entity!=='record'&&entity!=='call')throw new ApiError(404,'Not found');uuid.parse(id);
  const sp=req.nextUrl.searchParams;return NextResponse.json(await aiHistory(viewer,entity,id,{page:Number(sp.get('page')||1),scope:sp.get('scope')==='contact'?'contact':'execution',batch:sp.get('batch')||undefined,phone:sp.get('phone')||undefined}));
 }catch(error){return apiError(error);}
}
