import {ApiError} from './api';
import type {Viewer} from './scope';
export type WalletBalance={balance:number|null;unit:string;state:'fresh'|'stale'|'unavailable';refreshedAt:string|null;low:boolean;message:string|null};
type Cache={wallet:number|null;refreshed_at:Date|null;attempted_at:Date;error:string|null};
function response(cache:Cache|null):WalletBalance{
 const balance=cache?.wallet??null,refreshedAt=cache?.refreshed_at?.toISOString()??null;
 const configured=process.env.BOLNA_WALLET_LOW_THRESHOLD,threshold=configured?Number(configured):0;
 return {balance,unit:process.env.BOLNA_WALLET_UNIT?.trim().slice(0,40)||'provider units',
  state:balance===null?'unavailable':cache?.error||Date.now()-new Date(refreshedAt!).getTime()>60_000?'stale':'fresh',refreshedAt,
  low:balance!==null&&Number.isFinite(threshold)&&threshold>=0&&balance<=threshold,message:cache?.error??null};
}
/** A process-local cache and shared promise keep provider waits outside the DB. */
export function createWalletReader(){
 let cached:Cache|null=null,pending:Promise<WalletBalance>|null=null;
 return async function getWallet(viewer:Viewer,refresh=false):Promise<WalletBalance>{
  if(!viewer.isAdmin)throw new ApiError(403,'forbidden');
  if(pending)return pending;
  if(cached&&Date.now()-cached.attempted_at.getTime()<(refresh?10_000:60_000))return response(cached);
  pending=(async()=>{
   let error:string|null=null,balance:number|null=null;
   if(!process.env.BOLNA_API_KEY)error='Balance service is not configured.';
   else try{
    const result=await fetch('https://api.bolna.ai/user/me',{headers:{Authorization:`Bearer ${process.env.BOLNA_API_KEY}`},cache:'no-store',signal:AbortSignal.timeout(4000)});
    if(!result.ok)error=result.status===401||result.status===403?'Provider authentication failed.':'Balance service is temporarily unavailable.';
    else{const value:unknown=await result.json();const wallet=value&&typeof value==='object'&&'wallet' in value?value.wallet:null;
     if(typeof wallet==='number'&&Number.isFinite(wallet))balance=wallet;else error='Provider returned an invalid balance.';
    }
   }catch{error='Balance request timed out or failed.';}
   const now=new Date();
   cached={wallet:error?cached?.wallet??null:balance,refreshed_at:error?cached?.refreshed_at??null:now,attempted_at:now,error};
   return response(cached);
  })();
  try{return await pending;}finally{pending=null;}
 };
}
export const getWallet=createWalletReader();
