import {NextRequest,NextResponse} from 'next/server';
import {getCurrentUser} from '@/lib/auth';
import {apiError,uuid,ApiError} from '@/lib/api';
import {aiHistory,aiTranscript} from '@/lib/ai-attempts';
import {employeeWorkPerspective} from '@/lib/employee-work-perspective';
export async function GET(req:NextRequest,{params}:{params:Promise<{entity:string;id:string}>}){
 const user=await getCurrentUser();if(!user)return NextResponse.json({error:'unauthorized'},{status:401});
 try{
  const viewer=await employeeWorkPerspective(user,req.nextUrl.searchParams.get('employee'));if(!viewer)throw new ApiError(404,'Employee not found');
  const {entity,id}=await params;if(entity!=='record'&&entity!=='call')throw new ApiError(404,'Not found');uuid.parse(id);
  const sp=req.nextUrl.searchParams;
  const options={page:Number(sp.get('page')||1),scope:sp.get('scope')==='contact'?'contact' as const:'execution' as const,
    batch:sp.get('batch')||undefined,phone:sp.get('phone')||undefined,primaryPhone:sp.get('primary')==='1',lazyTranscripts:sp.get('transcripts')==='lazy'};
  if(sp.get('transcript')==='1') {
    const execution=uuid.parse(sp.get('execution')),provider=sp.get('provider_call');
    if(!provider || provider.length>1000)throw new ApiError(400,'Invalid provider call');
    return NextResponse.json({transcript:await aiTranscript(viewer,entity,id,execution,provider,options)},{headers:{'Cache-Control':'no-store'}});
  }
  return NextResponse.json(await aiHistory(viewer,entity,id,options),{headers:{'Cache-Control':'no-store'}});
 }catch(error){return apiError(error);}
}
