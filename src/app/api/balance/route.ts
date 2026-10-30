import {NextRequest,NextResponse} from 'next/server';
import {getCurrentAdmin} from '@/lib/auth';
import {getWallet} from '@/lib/wallet';
import {apiError} from '@/lib/api';
export async function GET(req:NextRequest){
 const user=await getCurrentAdmin();if(!user)return NextResponse.json({error:'forbidden'},{status:403});
 try{return NextResponse.json(await getWallet(user,req.nextUrl.searchParams.get('refresh')==='1'),{headers:{'cache-control':'no-store'}});}catch(error){return apiError(error);}
}
