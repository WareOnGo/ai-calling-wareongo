import {z} from 'zod';
import {query} from './db';
import {ApiError,uuid} from './api';
import {TERMINAL_STATUSES} from './bolna';
import type {Viewer} from './scope';
import {contactTargets} from './scope';
import type {ExportQuery} from './export';
export const batchListSchema=z.object({kind:z.enum(['ai','manual']).default('ai'),date_from:z.string().date().optional(),date_to:z.string().date().optional(),caller:z.string().max(1000).optional(),agent:z.string().max(1000).optional(),origin:z.enum(['record','call']).optional(),state:z.string().max(100).optional(),dispatch:z.string().uuid().optional()}).refine(f=>!f.date_from||!f.date_to||f.date_from<=f.date_to,'Start date cannot follow end date');
export type BatchListFilters=z.infer<typeof batchListSchema>;
export type BatchRow={id:string;kind:'ai'|'manual';created_at:string;created_by:string|null;scheduled_at:string|null;state:string;entity_type:string|null;agent_id:string|null;agent_language:string|null;dispatch_request_id:string|null;bolna_batch_id:string|null;assignees:string[]|null;selection:unknown;last_error:string|null;resolution_note:string|null};
const adminOnly=(viewer:Viewer)=>{if(!viewer.isAdmin)throw new ApiError(403,'forbidden');};
function listQuery(f:BatchListFilters){
 const params:unknown[]=[],where:string[]=[];const kind=f.kind;
 const base=kind==='ai'?`select id,'ai'::text kind,created_at,created_by,scheduled_at,state,null::text entity_type,agent_id,agent_language,dispatch_request_id,bolna_batch_id,null::text[] assignees,filters selection,last_error,resolution_note from call_batches`:
 `select b.id,'manual'::text kind,b.created_at,b.created_by,null::timestamptz scheduled_at,
 case when exists(select 1 from bolna_assignments a where a.batch_id=b.id and a.state='open') then 'open' else 'closed' end state,
 entity_type,null::text agent_id,null::text agent_language,null::uuid dispatch_request_id,null::text bolna_batch_id,assignees,selection,null::text last_error,null::text resolution_note from bolna_assignment_batches b`;
 for(const [value,condition] of [[f.date_from,"created_at >= (?::date::timestamp at time zone 'Asia/Kolkata')"],[f.date_to,"created_at < ((?::date+interval '1 day') at time zone 'Asia/Kolkata')"],[f.state,'state=?'],[f.origin,'entity_type=?'],[f.agent,'agent_id=?'],[f.dispatch,'dispatch_request_id=?::uuid']] as const)if(value){params.push(value);where.push(condition.replace('?',`$${params.length}`));}
 if(f.caller){params.push(f.caller.toLowerCase());where.push(kind==='manual'?`$${params.length}=any(assignees)`:`lower(created_by)=$${params.length}`);}
 return {base,params,where:where.length?'where '+where.join(' and '):''};
}
export async function listBatches(viewer:Viewer,filters:BatchListFilters,requested=1){
 adminOnly(viewer);const {base,params,where}=listQuery(filters),total=Number((await query(`select count(*)::int n from (${base}) batches ${where}`,params)).rows[0].n);
 const pages=Math.max(1,Math.ceil(total/25)),page=Math.min(pages,Math.max(1,Math.floor(Number.isFinite(requested)?requested:1)));
 const rows=(await query<BatchRow>(`select * from (${base}) batches ${where} order by created_at desc,id limit 25 offset ${(page-1)*25}`,params)).rows;
 const legacy=Number((await query('select count(*)::int n from bolna_assignments where batch_id is null')).rows[0].n);
 return {rows,total,page,pages,legacy};
}
export function batchListExport(viewer:Viewer,filters:BatchListFilters):ExportQuery{
 adminOnly(viewer);const {base,params,where}=listQuery(filters);return {sql:`select * from (${base}) batches ${where} order by created_at desc,id`,countSql:`select count(*)::text n from (${base}) batches ${where}`,params,countParams:params};
}
export async function getBatch(viewer:Viewer,kind:'ai'|'manual',id:string):Promise<BatchRow>{
 adminOnly(viewer);
 if(id==='legacy'&&kind==='manual')return {id,kind,created_at:'',created_by:null,scheduled_at:null,state:'legacy',entity_type:null,agent_id:null,agent_language:null,dispatch_request_id:null,bolna_batch_id:null,assignees:null,selection:null,last_error:null,resolution_note:null};
 uuid.parse(id);const {base}=listQuery({kind});const row=(await query<BatchRow>(`select * from (${base}) batches where id=$1::uuid`,[id])).rows[0];if(!row)throw new ApiError(404,'Batch not found');return row;
}
export type BatchMember={member_id:string;entity_type:'record'|'call'|null;entity_id:string|null;assignment_id:string|null;name:string|null;phone:string|null;city:string|null;assignee:string|null;current_owner:string|null;state:string;disposition:string|null;outcome:string|null;wh_id:string|null;onboarded:boolean;quality_issue:string|null;retry_due:boolean;connected:boolean;attempts:number;execution_id:string|null;status:string|null;available:boolean;assigned:boolean;attempted:boolean;pending:boolean;failure:boolean;blocked:boolean;dropped:boolean;done:boolean;open:boolean;unclear:boolean;unavailable:boolean};
export const MANUAL_CARDS=[['all','Targeted records'],['assigned','Assignments created'],['open','Open'],['done','Valid done'],['dropped','Dropped / reassigned'],['retry_due','Follow-ups due'],['connected','Tasks with a connection'],['available','Available with WH ID'],['onboarded','Staff onboarded'],['quality','Completion issues']] as const;
export const AI_CARDS=[['all','Targeted contacts'],['attempted','Contacts attempted'],['connected','Contacts with a conversation'],['available','Latest Available'],['unavailable','Latest Unavailable'],['unclear','Latest Unclear'],['pending','No final result'],['failure','Operational failures'],['blocked','Balance blocked']] as const;
const validWH="bolna_recorded_warehouse(a.wh_id)";
function membersBase(batch:BatchRow):{sql:string;params:unknown[]}{
 if(batch.kind==='manual'){
  const legacy=batch.id==='legacy';
  const source=legacy?`select a.id::text member_id,a.entity_type,a.entity_id,a.id assignment_id,a.assignee,'legacy'::text disposition from bolna_assignments a where a.batch_id is null`:
    `select i.entity_id::text member_id,b.entity_type,i.entity_id,i.assignment_id,i.assignee,i.disposition from bolna_assignment_batch_items i join bolna_assignment_batches b on b.id=i.batch_id where b.id=$1::uuid`;
  return {params:legacy?[]:[batch.id],sql:`select m.member_id,m.entity_type,m.entity_id::text,m.assignment_id::text,
   coalesce(r.owner_name,cl.context_details#>>'{recipient_data,name}') name,
   coalesce(case when cl.call_type='inbound' then cl.from_number else cl.to_number end,rphone.phone) phone,
   coalesce(r.city,cl.context_details#>>'{recipient_data,area}') city,m.assignee,
   (select owner.assignee from (${contactTargets('m.entity_type','m.entity_id')}) contacts
     join bolna_assignments owner using(entity_type,entity_id) where owner.state='open'
     order by (owner.entity_type=m.entity_type and owner.entity_id=m.entity_id) desc,owner.assigned_at desc,owner.id desc limit 1) current_owner,
   coalesce(a.state,'unallocated') state,m.disposition,a.outcome,a.wh_id,
   coalesce(a.added_to_db and ${validWH},false) onboarded,
   case when a.state='done' then bolna_assignment_quality(a.state,a.outcome,a.wh_id,a.remarks,a.disposition,a.closure_reason) end quality_issue,
   coalesce(a.state='open' and a.disposition=any(bolna_retry_dispositions()) and (a.next_due_at is null or a.next_due_at<=now()),false) retry_due,
   coalesce(activity.connected,false) connected,coalesce(activity.attempts,0)::int attempts,
   null::text execution_id,null::text status,coalesce(a.outcome='Available' and ${validWH},false) available,
   a.id is not null assigned,coalesce(activity.attempts>0,false) attempted,false pending,false failure,false blocked,
   coalesce(a.state='dropped',false) dropped,coalesce(a.state='done' and bolna_assignment_quality(a.state,a.outcome,a.wh_id,a.remarks,a.disposition,a.closure_reason) is null,false) done,
   coalesce(a.state='open',false) open,coalesce(a.outcome='Unclear',false) unclear,coalesce(a.outcome='Unavailable',false) unavailable
   from (${source}) m left join bolna_assignments a on a.id=m.assignment_id
   left join raw_records r on m.entity_type='record' and r.id=m.entity_id
   left join bolna_call_logs cl on m.entity_type='call' and cl.id=m.entity_id
   left join lateral(select p.phone from raw_phones rp join raw_phone_numbers p using(phone_id) where rp.master_id=r.id order by rp.is_primary desc,rp.id limit 1) rphone on true
   left join lateral(select count(*) attempts,bool_or(e.disposition in ('connected','callback','awaiting_confirmation')) connected from bolna_effective_manual_attempts e where e.assignment_id=a.id) activity on true`};
 }
 return {params:[batch.id,batch.bolna_batch_id,[...TERMINAL_STATUSES]],sql:`select i.phone member_id,'record'::text entity_type,i.record_id entity_id,null::text assignment_id,i.name,i.phone,i.city,
  null::text assignee,null::text current_owner,coalesce(cl.status,'No result') state,null::text disposition,
  case when cl.id is not null and cl.status is distinct from 'balance-low' then bolna_availability(cl.status,cl.llm_availability) end outcome,
  null::text wh_id,false onboarded,null::text quality_issue,false retry_due,coalesce(activity.connected,false) connected,coalesce(activity.attempts,0)::int attempts,
  cl.id::text execution_id,cl.status,coalesce(cl.status is distinct from 'balance-low' and bolna_availability(cl.status,cl.llm_availability)='Available',false) available,
  false assigned,coalesce(activity.attempts>0,false) attempted,
  cl.id is null or coalesce(not (cl.status=any($3::text[])),true) pending,
  coalesce(cl.status in ('failed','error','balance-low','canceled','stopped'),false) failure,coalesce(cl.status='balance-low',false) blocked,
  false dropped,false done,false open,
  cl.id is not null and cl.status is distinct from 'balance-low' and bolna_availability(cl.status,cl.llm_availability)='Unclear' unclear,
  coalesce(cl.status is distinct from 'balance-low' and bolna_availability(cl.status,cl.llm_availability)='Unavailable',false) unavailable
  from (select right(regexp_replace(contact_number,'\\D','','g'),10) phone,min(record_id) record_id,
   string_agg(distinct name,', ') name,string_agg(distinct area,', ') city from call_batch_items where batch_id=$1::uuid group by 1) i
  left join lateral(select c.* from bolna_call_logs c where c.batch_id=$2 and c.phone_last10=i.phone order by c.call_created_at desc nulls last,c.id desc limit 1) cl on true
  left join lateral(select count(*) attempts,bool_or(confirmed_conversation) connected from bolna_ai_attempts a where a.batch_id=$2 and a.phone_last10=i.phone) activity on true`};
}
function metricWhere(batch:BatchRow,metric:string){
 const allowed=(batch.kind==='ai'?AI_CARDS:MANUAL_CARDS).map(c=>c[0]);if(!(allowed as readonly string[]).includes(metric))throw new ApiError(400,'Unknown batch metric');
 return metric==='all'?'':metric==='quality'?'where quality_issue is not null':`where ${metric}=true`;
}
export function batchMembersExport(viewer:Viewer,batch:BatchRow,metric='all'):ExportQuery{
 adminOnly(viewer);const {sql,params}=membersBase(batch),where=metricWhere(batch,metric);
 return {sql:`select * from (${sql}) members ${where} order by member_id`,countSql:`select count(*)::text n from (${sql}) members ${where}`,params,countParams:params};
}
export async function batchMembers(viewer:Viewer,batch:BatchRow,metric='all',requested=1){
 const spec=batchMembersExport(viewer,batch,metric),base=membersBase(batch);
 const fields=(batch.kind==='ai'?AI_CARDS:MANUAL_CARDS).filter(c=>c[0]!=='all').map(([key])=>`count(*) filter(${metricWhere(batch,key)})::int ${key}`);
 const metrics=(await query(`select count(*)::int "all",coalesce(sum(attempts),0)::int attempts,${fields.join(',')} from (${base.sql}) members`,base.params)).rows[0] as Record<string,number>;
 const total=metrics[metric],pages=Math.max(1,Math.ceil(total/50)),page=Math.min(pages,Math.max(1,Math.floor(Number.isFinite(requested)?requested:1)));
 const rows=(await query<BatchMember>(`${spec.sql} limit 50 offset ${(page-1)*50}`,spec.params)).rows;
 return {rows,total,page,pages,metrics};
}
