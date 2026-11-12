import {NextRequest,NextResponse} from 'next/server';
import {getCurrentUser} from '@/lib/auth';
import {apiError,uuid,ApiError} from '@/lib/api';
import {aiHistory} from '@/lib/ai-attempts';
import {employeeWorkPerspective} from '@/lib/employee-work-perspective';
export async function GET(req:NextRequest,{params}:{params:Promise<{entity:string;id:string}>}){
 const user=await getCurrentUser();if(!user)return NextResponse.json({error:'unauthorized'},{status:401});
 try{
  const viewer=await employeeWorkPerspective(user,req.nextUrl.searchParams.get('employee'));if(!viewer)throw new ApiError(404,'Employee not found');
  const {entity,id}=await params;if(entity!=='record'&&entity!=='call')throw new ApiError(404,'Not found');uuid.parse(id);
  const sp=req.nextUrl.searchParams;return NextResponse.json(await aiHistory(viewer,entity,id,{page:Number(sp.get('page')||1),scope:sp.get('scope')==='contact'?'contact':'execution',batch:sp.get('batch')||undefined,phone:sp.get('phone')||undefined}));
 }catch(error){return apiError(error);}
}
