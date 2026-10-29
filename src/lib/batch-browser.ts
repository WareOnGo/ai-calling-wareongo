import { categoryWhere, warehouseWhere } from "./filter-values";
import { warehouseIdsSql } from './warehouse-contacts';
import {z} from 'zod';
import {query} from './db';
import {ApiError,uuid} from './api';
import {TERMINAL_STATUSES} from './bolna';
import type {Viewer} from './scope';
import {contactTargets} from './scope';
import {CONNECTED_DISPOSITIONS} from './manual-dispositions';
import {ASSIGNMENT_SOURCE_JOIN,ASSIGNMENT_SUBJECT,ASSIGNMENT_CITY} from './assignment-context';
import type {ExportQuery} from './export';
export const batchListSchema=z.object({kind:z.enum(['ai','manual']).default('ai'),created_by:z.string().trim().max(1000).optional(),q:z.string().trim().max(1000).optional(),language:z.enum(['english','hindi']).optional(),date_from:z.string().date().optional(),date_to:z.string().date().optional(),caller:z.string().max(1000).optional(),agent:z.string().max(1000).optional(),origin:z.enum(['record','call']).optional(),state:z.union([z.string().max(100),z.array(z.string().max(100)).max(30)]).optional(),dispatch:z.string().uuid().optional()}).refine(f=>!f.date_from||!f.date_to||f.date_from<=f.date_to,'Start date cannot follow end date');
export type BatchListFilters=z.infer<typeof batchListSchema>;
export type BatchRow={id:string;kind:'ai'|'manual';created_at:string;created_by:string|null;scheduled_at:string|null;state:string;entity_type:string|null;agent_id:string|null;agent_language:string|null;dispatch_request_id:string|null;bolna_batch_id:string|null;assignees:string[]|null;selection:unknown;last_error:string|null;resolution_note:string|null};
export type BatchProgress={targeted:number;finished:number;attempts:number};
export async function batchProgress(rows:BatchRow[]):Promise<Record<string,BatchProgress>>{
 if(!rows.length)return {};
 const ids=rows.filter(b=>b.id!=='legacy').map(b=>b.id);
 if(!ids.length)return {};
 if(rows[0].kind==='manual'){
  const result=await query<BatchProgress&{id:string}>(`select b.id,count(i.entity_id)::int targeted,
   count(*) filter(where a.state='done' and bolna_assignment_quality(a.state,a.outcome,a.wh_id,a.remarks,a.disposition,a.closure_reason) is null)::int finished,
   coalesce(sum(events.n),0)::int attempts
   from bolna_assignment_batches b left join bolna_assignment_batch_items i on i.batch_id=b.id left join bolna_assignments a on a.id=i.assignment_id
   left join lateral(select count(*) n from bolna_effective_manual_attempts e where e.assignment_id=a.id) events on true
   where b.id=any($1::uuid[]) group by b.id`,[ids]);
  return Object.fromEntries(result.rows.map(r=>[r.id,r]));
 }
 const result=await query<BatchProgress&{id:string}>(`with targets as (
  select distinct batch_id,right(regexp_replace(contact_number,'\\D','','g'),10) phone from call_batch_items where batch_id=any($1::uuid[])
 ) select b.id,count(t.phone)::int targeted,count(*) filter(where latest.status=any($2::text[]))::int finished,
  coalesce(sum(evidence.n),0)::int attempts
  from call_batches b left join targets t on t.batch_id=b.id
  left join lateral(select status from bolna_call_logs c where c.batch_id=b.bolna_batch_id and c.phone_last10=t.phone order by c.call_created_at desc nulls last,c.id desc limit 1) latest on true
  left join lateral(select count(*) n from bolna_ai_attempts e where e.batch_id=b.bolna_batch_id and e.phone_last10=t.phone) evidence on true
  where b.id=any($1::uuid[]) group by b.id`,[ids,[...TERMINAL_STATUSES]]);
 return Object.fromEntries(result.rows.map(r=>[r.id,r]));
}
const adminOnly=(viewer:Viewer)=>{if(!viewer.isAdmin)throw new ApiError(403,'forbidden');};
function listQuery(f:BatchListFilters){
 const params:unknown[]=[],where:string[]=[];const kind=f.kind;
 const base=kind==='ai'?`select id,'ai'::text kind,created_at,created_by,scheduled_at,state,null::text entity_type,agent_id,agent_language,dispatch_request_id,bolna_batch_id,null::text[] assignees,filters selection,last_error,resolution_note from call_batches`:
 `select b.id,'manual'::text kind,b.created_at,b.created_by,null::timestamptz scheduled_at,
 case when exists(select 1 from bolna_assignments a where a.batch_id=b.id and a.state='open') then 'open' else 'closed' end state,
 entity_type,null::text agent_id,null::text agent_language,null::uuid dispatch_request_id,null::text bolna_batch_id,assignees,selection,null::text last_error,null::text resolution_note from bolna_assignment_batches b`;
 for(const [value,condition] of [[f.date_from,"created_at >= (?::date::timestamp at time zone 'Asia/Kolkata')"],[f.date_to,"created_at < ((?::date+interval '1 day') at time zone 'Asia/Kolkata')"],[f.origin,'entity_type=?'],[f.agent,'agent_id=?'],[f.dispatch,'dispatch_request_id=?::uuid']] as const)if(value){params.push(value);where.push(condition.replace('?',`$${params.length}`));}
 const status = categoryWhere('state', f.state, params); if (status) where.push(status);
 if (f.language) { params.push(f.language); where.push(`agent_language=$${params.length}`); }
 if (f.q) { params.push(f.q); where.push(`(id::text ilike '%'||$${params.length}||'%' or coalesce(created_by,'') ilike '%'||$${params.length}||'%' or coalesce(bolna_batch_id,'') ilike '%'||$${params.length}||'%')`); }
 if(f.created_by){params.push(f.created_by.toLowerCase());where.push(`lower(created_by)=$${params.length}`);}
 if(f.caller){params.push(f.caller.toLowerCase());where.push(kind==='manual'?`$${params.length}=any(assignees)`:`lower(created_by)=$${params.length}`);}
 return {base,params,where:where.length?'where '+where.join(' and '):''};
}
export async function listBatches(viewer:Viewer,filters:BatchListFilters,requested=1){
 adminOnly(viewer);const {base,params,where}=listQuery(filters);
 const legacyCount=filters.kind==='manual'?'(select count(*)::int from bolna_assignments where batch_id is null)':'0';
 const counts=(await query(`select count(*)::int n,${legacyCount} legacy from (${base}) batches ${where}`,params)).rows[0];
 const total=Number(counts.n);
 const pages=Math.max(1,Math.ceil(total/25)),page=Math.min(pages,Math.max(1,Math.floor(Number.isFinite(requested)?requested:1)));
 const rows=(await query<BatchRow>(`select * from (${base}) batches ${where} order by created_at desc,id limit 25 offset ${(page-1)*25}`,params)).rows;
 const legacy=Number(counts.legacy);
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
export type BatchMember={member_id:string;entity_type:'record'|'call'|null;entity_id:string|null;assignment_id:string|null;name:string|null;phone:string|null;city:string|null;assignee:string|null;current_owner:string|null;state:string;disposition:string|null;outcome:string|null;wh_id:string|null;onboarded:boolean;quality_issue:string|null;retry_due:boolean;connected:boolean;attempts:number;execution_id:string|null;status:string|null;available:boolean;assigned:boolean;attempted:boolean;pending:boolean;failure:boolean;blocked:boolean;dropped:boolean;done:boolean;open:boolean;unclear:boolean;unavailable:boolean;
 assignee_name:string|null;current_owner_name:string|null;assigned_by:string|null;assigned_by_name:string|null;assigned_at:string|null;completed_at:string|null;
 remarks:string|null;note:string|null;manual_disposition:string|null;closure_reason:string|null;next_due_at:string|null;last_attempt_at:string|null;added_to_db:boolean|null;warehouse_ids:number[];
};
export const MANUAL_CARDS=[
 ['all','Records in batch'],['assigned','Assignments recorded'],['open','Still open'],
 ['done','Done · checks passed'],['quality','Marked done · needs correction'],
 ['available','Available · WH ID recorded'],['onboarded','Added to DB · WH ID recorded'],
 ['connected','With a logged connected call'],['retry_due','Follow-up due or unscheduled'],['dropped','Unassigned / reassigned'],
] as const;
export const MANUAL_METRIC_DESCRIPTIONS:Record<string,string>={
 all:'Every record in the original batch selection, including records skipped during assignment.',
 assigned:'Batch records linked to an assignment, including assignments later completed, unassigned or reassigned.',
 open:'Assignments that are still open with their original caller.',
 done:'Marked done and passes the saved result, warehouse ID and closure checks. Historical assignments can pass without a logged call.',
 quality:'Marked done, but a saved result, warehouse ID, closure explanation or follow-up status needs correction. Each row shows the first rule that failed.',
 available:'The saved manual result is Available and a warehouse reference is recorded. The assignment may still be open.',
 onboarded:'Staff marked Added to DB and recorded a warehouse reference. This does not confirm that the record exists in the external warehouse database.',
 connected:'Assignments with at least one logged Connected, Call back later, Will check and get back, Leased out or No property for rent attempt. Unlogged calls are not counted.',
 retry_due:'Open assignments that need another call and have a follow-up time that is due or has not been set.',
 dropped:'The original assignment was unassigned or replaced during reassignment. The current owner is shown in the table.',
};
export const AI_CARDS=[['all','Targeted contacts'],['attempted','Contacts attempted'],['connected','Contacts with a conversation'],['available','Latest Available'],['unavailable','Latest Unavailable'],['unclear','Latest Unclear'],['pending','No final result'],['failure','Operational failures'],['blocked','Balance blocked']] as const;
const validWH="bolna_recorded_warehouse(a.wh_id)";
function membersBase(batch:BatchRow):{sql:string;params:unknown[]}{
 if(batch.kind==='manual'){
  const legacy=batch.id==='legacy';
  const source=legacy?`select a.id::text member_id,a.entity_type,a.entity_id,a.id assignment_id,a.assignee,'legacy'::text disposition from bolna_assignments a where a.batch_id is null`:
    `select i.entity_id::text member_id,b.entity_type,i.entity_id,i.assignment_id,i.assignee,i.disposition from bolna_assignment_batch_items i join bolna_assignment_batches b on b.id=i.batch_id where b.id=$1::uuid`;
  const params:unknown[]=legacy?[]:[batch.id];
  params.push(CONNECTED_DISPOSITIONS);
  return {params,sql:`select m.member_id,m.entity_type,m.entity_id::text,m.assignment_id::text,
   ${warehouseIdsSql('m.entity_type','m.entity_id')} as warehouse_ids,
   ${ASSIGNMENT_SUBJECT} name,
   coalesce(case when cl.call_type='inbound' then cl.from_number else cl.to_number end,rphone.phone) phone,
   ${ASSIGNMENT_CITY} city,m.assignee,caller.name assignee_name,
   current_assignment.assignee current_owner,current_assignment.name current_owner_name,
   a.assigned_by,assigner.name assigned_by_name,a.assigned_at::text,a.completed_at::text,
   a.remarks,a.note,a.disposition manual_disposition,a.closure_reason,a.next_due_at::text,a.last_attempt_at::text,a.added_to_db,
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
   left join bolna_app_users caller on caller.email=m.assignee
   left join bolna_app_users assigner on assigner.email=a.assigned_by
   left join lateral(select owner.assignee,owner_user.name from (${contactTargets('m.entity_type','m.entity_id')}) contacts
     join bolna_assignments owner using(entity_type,entity_id)
     left join bolna_app_users owner_user on owner_user.email=owner.assignee where owner.state='open'
     order by (owner.entity_type=m.entity_type and owner.entity_id=m.entity_id) desc,owner.assigned_at desc,owner.id desc limit 1) current_assignment on true
   left join raw_records r on m.entity_type='record' and r.id=m.entity_id
   left join bolna_call_logs cl on m.entity_type='call' and cl.id=m.entity_id
   ${ASSIGNMENT_SOURCE_JOIN}
   left join lateral(select p.phone from raw_phones rp join raw_phone_numbers p using(phone_id) where rp.master_id=r.id order by rp.is_primary desc,rp.id limit 1) rphone on true
   left join lateral(select count(*) attempts,bool_or(e.disposition=any($${params.length}::text[])) connected from bolna_effective_manual_attempts e where e.assignment_id=a.id) activity on true`};
 }
 return {params:[batch.id,batch.bolna_batch_id,[...TERMINAL_STATUSES]],sql:`select i.phone member_id,'record'::text entity_type,i.record_id entity_id,null::text assignment_id,i.name,i.phone,i.city,
  array(select warehouse_id from bolna_warehouse_contacts where phone_last10=i.phone order by warehouse_id) as warehouse_ids,
  null::text assignee,null::text assignee_name,null::text current_owner,null::text current_owner_name,
  null::text assigned_by,null::text assigned_by_name,null::text assigned_at,null::text completed_at,
  null::text remarks,null::text note,null::text manual_disposition,null::text closure_reason,null::text next_due_at,null::text last_attempt_at,null::boolean added_to_db,
  coalesce(cl.status,'No result') state,null::text disposition,
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
const memberValues = z.union([z.string().max(1000), z.array(z.string().max(1000)).max(100)]).optional();
export const batchMemberFiltersSchema = z.object({
 q: z.string().trim().max(1000).optional(), city: z.string().trim().max(1000).optional(),
 allocation:memberValues, outcome: memberValues, state: memberValues, assignee: memberValues, current_owner: memberValues,
 has_attempts: z.enum(['yes','no']).optional(), connected: z.enum(['yes','no']).optional(),
 onboarded: z.enum(['yes','no']).optional(), warehouse_match: z.enum(['yes','no']).optional(), wh_id: z.string().trim().max(1000).optional(),
});
export type BatchMemberFilters = z.infer<typeof batchMemberFiltersSchema>;
function memberWhere(batch: BatchRow, metric: string, f: BatchMemberFilters, params: unknown[]) {
 const selected = metricWhere(batch,metric).replace(/^where /, '');
 const where = selected ? [selected] : [];
 for (const [column, value] of [['disposition',f.allocation],['outcome',f.outcome],['state',f.state],['assignee',f.assignee],['current_owner',f.current_owner]] as const) {
  const clause = categoryWhere(column,value,params,'none'); if(clause)where.push(clause);
 }
 if(f.q){params.push(f.q);where.push(`(coalesce(name,'') ilike '%'||$${params.length}||'%' or coalesce(phone,'') ilike '%'||$${params.length}||'%')`);}
 if(f.city){params.push(f.city);where.push(`coalesce(city,'') ilike '%'||$${params.length}||'%'`);}
 if(f.has_attempts)where.push(f.has_attempts==='yes'?'attempts>0':'attempts=0');
 for(const key of ['connected','onboarded'] as const)if(f[key])where.push(`${key}=${f[key]==='yes'?'true':'false'}`);
 if(f.wh_id){const recorded=warehouseWhere('wh_id',f.wh_id,params);where.push(`(${recorded} or $${params.length}=any(warehouse_ids::text[]))`);}
 if(f.warehouse_match)where.push(`cardinality(warehouse_ids)${f.warehouse_match==='yes'?'>0':'=0'}`);
 return where.length ? 'where '+where.join(' and ') : '';
}
export function batchMembersExport(viewer:Viewer,batch:BatchRow,metric='all',filters:BatchMemberFilters={}):ExportQuery{
 adminOnly(viewer);const {sql,params}=membersBase(batch),where=memberWhere(batch,metric,filters,params);
 return {sql:`select * from (${sql}) members ${where} order by member_id`,countSql:`select count(*)::text n from (${sql}) members ${where}`,params,countParams:params};
}
export async function batchMembers(viewer:Viewer,batch:BatchRow,metric='all',requested=1,filters:BatchMemberFilters={}){
 const spec=batchMembersExport(viewer,batch,metric,filters),base=membersBase(batch);
 const fields=(batch.kind==='ai'?AI_CARDS:MANUAL_CARDS).filter(c=>c[0]!=='all').map(([key])=>`count(*) filter(${metricWhere(batch,key)})::int ${key}`);
 // Progress describes the whole batch; filtering members must not imply completion.
 const summary=(await query(`select count(*)::int "all",coalesce(sum(attempts),0)::int attempts,${fields.join(',')},
  array_agg(distinct state) states,array_agg(distinct assignee) callers,array_agg(distinct current_owner) owners
  from (${base.sql}) members`,base.params)).rows[0];
 const {states,callers,owners,...counts}=summary;
 const metrics=counts as Record<string,number>;
 const total=Object.values(filters).some(value=>Array.isArray(value)?value.length:!!value)
  ? Number((await query(spec.countSql,spec.countParams)).rows[0].n) : metrics[metric];
 const pages=Math.max(1,Math.ceil(total/50)),page=Math.min(pages,Math.max(1,Math.floor(Number.isFinite(requested)?requested:1)));
 const rows=(await query<BatchMember>(`${spec.sql} limit 50 offset ${(page-1)*50}`,spec.params)).rows;
 return {rows,total,page,pages,metrics,options:{states:(states||[]).filter(Boolean) as string[],callers:(callers||[]).filter(Boolean) as string[],owners:(owners||[]).filter(Boolean) as string[]}};
}
