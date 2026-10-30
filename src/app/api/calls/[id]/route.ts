import {NextRequest,NextResponse} from 'next/server';
import {getCurrentUser} from '@/lib/auth';
import {ownsEntity} from '@/lib/assignments';
import {apiError,uuid} from '@/lib/api';
export const runtime='nodejs';
export const dynamic='force-dynamic';
// Retired duplicate manual-status channel. Keep an explicit response for old tabs.
export async function PATCH(_req:NextRequest,{params}:{params:Promise<{id:string}>}){
 const user=await getCurrentUser();if(!user)return NextResponse.json({error:'unauthorized'},{status:401});
 try{const id=uuid.parse((await params).id);if(!await ownsEntity(user,'call',id))return NextResponse.json({error:'Not found'},{status:404});
 return NextResponse.json({error:'Manual verification now belongs to the assignment. Refresh and use the assignment controls.',code:'LEGACY_CALL_EDIT_RETIRED'},{status:409});
 }catch(error){return apiError(error);}
}
