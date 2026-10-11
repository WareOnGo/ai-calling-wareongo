import { query } from './db';
import { assignmentScope,type Viewer } from './scope';
import { ApiError } from './api';
export type AiAttempt={execution_id:string;provider_call_id:string;phone_last10:string|null;direction:string|null;status:string|null;provider:string|null;agent_id:string|null;batch_id:string|null;initiated_at:string|null;provider_initiated_at:string|null;execution_created_at:string|null;first_observed_at:string;duration_seconds:string|null;conversation_seconds:string|null;confirmed_conversation:boolean;interval_seconds:string|null};
export type AiHistory={rows:AiAttempt[];total:number;page:number;pages:number;outbound:number;inbound:number;conversations:number;contacts:number;unknownExecutions:number;scope:'contact'|'execution';batch:string|null};
export async function aiHistory(viewer:Viewer,entity:'call'|'record',id:string,options:{page?:number;scope?:'contact'|'execution';batch?:string}={}):Promise<AiHistory>{
 const permission:unknown[]=[id],allowed=assignmentScope(viewer,entity,'seed.id',permission);
 const seed=await query(`select seed.id from ${entity==='call'?'bolna_call_logs':'raw_records'} seed where seed.id=$1::uuid${allowed?` and ${allowed}`:''}`,permission);
 if(!seed.rowCount)throw new ApiError(404,'Not found');
 // Employees following up one execution cannot expand into other callers' tasks.
 const scope=entity==='record'||viewer.isAdmin&&options.scope==='contact'?'contact':'execution';
 const params:unknown[]=[id],batch=options.batch?.trim()||null;
 const contact=`in (select phone_last10 from bolna_assignment_contacts where entity_type='${entity}' and entity_id=$1::uuid)`;
 let where=scope==='execution'?'a.execution_id=$1::uuid':`a.phone_last10 ${contact}`;
 let unknown=scope==='execution'?'cl.id=$1::uuid':`cl.phone_last10 ${contact}`;
 if(batch){if(batch.length>1000)throw new ApiError(400,'Invalid batch');params.push(batch);where+=' and a.batch_id=$2';unknown+=' and cl.batch_id=$2';}
 const summary=(await query(`select count(*)::int total,count(*) filter(where direction='outbound')::int outbound,
  count(*) filter(where direction='inbound')::int inbound,count(*) filter(where confirmed_conversation)::int conversations,
  count(distinct phone_last10)::int contacts from bolna_ai_attempts a where ${where}`,params)).rows[0];
 const unknownExecutions=Number((await query(`select count(*)::int n from bolna_call_logs cl where ${unknown} and cl.status is distinct from 'balance-low'
  and not exists(select 1 from bolna_ai_attempts a where a.execution_id=cl.id)`,params)).rows[0].n);
 const pages=Math.max(1,Math.ceil(summary.total/50)),page=Math.min(pages,Math.max(1,Math.floor(Number.isFinite(options.page)?options.page!:1)));
 const rows=(await query<AiAttempt>(`select execution_id::text,provider_call_id,phone_last10,direction,status,provider,agent_id,batch_id,
  initiated_at::text,raw->>'initiated_at' as provider_initiated_at,execution_created_at::text,first_observed_at::text,duration_seconds::text,conversation_seconds::text,confirmed_conversation,
  extract(epoch from (initiated_at-lag(initiated_at) over(partition by phone_last10,direction
   order by initiated_at nulls last,execution_id,provider_call_id)))::text as interval_seconds
  from bolna_ai_attempts a where ${where} order by initiated_at desc nulls last,first_observed_at desc,execution_id,provider_call_id limit 50 offset ${(page-1)*50}`,params)).rows;
 return {rows,total:summary.total,page,pages,outbound:summary.outbound,inbound:summary.inbound,conversations:summary.conversations,contacts:summary.contacts,unknownExecutions,scope,batch};
}
