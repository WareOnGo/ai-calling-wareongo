import {z} from 'zod';
import {query} from './db';
import {ApiError} from './api';
import type {Viewer} from './scope';
import type {ExportQuery} from './export';

export const TEAM_METRICS={open:'Open now',completed:'First valid completions',attempts:'Recorded attempts',connected:'Connected attempts',duration:'Timed connected attempts',available:'First Available targets',repeat_available:'Repeat Available attempts',onboarded:'Warehouse references onboarded',quality:'Quality review now',overdue:'Follow-ups due now',reopened:'Reopened targets',comparable:'Comparable AI executions',mismatch:'AI / manual disagreements',legacy:'Undated legacy verification'} as const;
export type TeamMetric=keyof typeof TEAM_METRICS;
const metricKeys=Object.keys(TEAM_METRICS) as [TeamMetric,...TeamMetric[]];
export const teamReportSchema=z.object({date_from:z.string().date(),date_to:z.string().date(),caller:z.string().email().max(320).optional(),metric:z.enum(metricKeys).default('attempts'),page:z.coerce.number().int().min(1).max(1000000).default(1)})
 .refine(f=>f.date_from<=f.date_to,'Start date cannot follow end date');
export type TeamFilters=z.infer<typeof teamReportSchema>;
export function teamDates(now=new Date()){
 const today=new Date(now.getTime()+330*60000).toISOString().slice(0,10);
 const before=(days:number)=>new Date(Date.parse(today+'T00:00:00Z')-days*86400000).toISOString().slice(0,10);
 return {today,yesterday:before(1),week:before(6),month:today.slice(0,8)+'01'};
}
export function parseTeamFilters(input:Record<string,unknown>,now=new Date()):TeamFilters {
 const dates=teamDates(now);return teamReportSchema.parse({date_from:dates.week,date_to:dates.today,...Object.fromEntries(Object.entries(input).filter(([,v])=>v!==''&&v!==undefined))});
}
function adminOnly(viewer:Viewer){if(!viewer.isAdmin)throw new ApiError(403,'forbidden');}

// All cards, row links and CSV use this same event relation. Date filters are
// applied AFTER first-evidence selection, so reopen/edit cycles cannot move a
// first completion or onboarding into a new reporting period.
// Assemble only the CTEs required by the requested measures. The default page
// requests five metrics; a drill-down builds only its own dependency chain.
const REPORT_CTES:Record<string,string>={
 "bounds":`bounds as (select ($1::date::timestamp at time zone 'Asia/Kolkata') lo,
 (($2::date+interval '1 day') at time zone 'Asia/Kolkata') hi,$3::timestamptz as_of)`,
 "first_change":`first_change as materialized (select distinct on(assignment_id) assignment_id,before_values from bolna_assignment_changes order by assignment_id,id)`,
 "snapshots":`snapshots as materialized (
  select a.id assignment_id,coalesce(c.before_values,to_jsonb(a)) v,null::timestamptz at,'Retained legacy state'::text provenance,true verification
   from bolna_assignments a left join first_change c on c.assignment_id=a.id where c.before_values is distinct from '{}'::jsonb
  union all select assignment_id,after_values,changed_at,'Assignment audit',before_values->>'outcome' is distinct from after_values->>'outcome'
   from bolna_assignment_changes
  union all select id,jsonb_build_object('wh_id',wh_id,'added_to_db',added_to_db),null,'Imported legacy onboarding',false
   from bolna_assignments where legacy_onboarding
 )`,
 "states":`states as materialized (select s.*,a.assignee,a.entity_type,a.entity_id,
  s.v->>'outcome' outcome,s.v->>'wh_id' wh_id,bolna_recorded_warehouse(s.v->>'wh_id') valid_wh,
  s.v->>'state'='done' and bolna_assignment_quality(s.v->>'state',s.v->>'outcome',case when bolna_recorded_warehouse(s.v->>'wh_id') then '1' else s.v->>'wh_id' end,s.v->>'remarks',s.v->>'disposition',s.v->>'closure_reason') is null valid_done
  from snapshots s join bolna_assignments a on a.id=s.assignment_id)`,
 "first_done":`first_done as (select distinct on(assignee,entity_type,entity_id) *,coalesce(at,(v->>'completed_at')::timestamptz) event_at
  from states where valid_done order by assignee,entity_type,entity_id,coalesce(at,(v->>'completed_at')::timestamptz) nulls first,assignment_id)`,
 "first_onboarded":`first_onboarded as (select distinct on(lower(trim(wh_id))) * from states where valid_wh and (v->>'added_to_db')::boolean
  order by lower(trim(wh_id)),at nulls first,assignment_id)`,
 "attempts":`attempts as materialized (select e.*,a.entity_type,a.entity_id from bolna_effective_manual_attempts e join bolna_assignments a on a.id=e.assignment_id)`,
 "available_observations":`available_observations as (
  select assignment_id,assignee,entity_type,entity_id,at,provenance from states where outcome='Available'
  union all select assignment_id,assignee,entity_type,entity_id,occurred_at,'Recorded manual attempt' from attempts where outcome='Available'
 )`,
 "first_available":`first_available as (select distinct on(assignee,entity_type,entity_id) * from available_observations
  order by assignee,entity_type,entity_id,at nulls first,assignment_id,provenance)`,
 "period_attempts":`period_attempts as (select e.* from attempts e,bounds b where e.occurred_at>=b.lo and e.occurred_at<b.hi)`,
 "reopened":`reopened as (select distinct on(a.assignee,a.entity_type,a.entity_id) a.*,c.changed_at from bolna_assignment_changes c join bolna_assignments a on a.id=c.assignment_id,bounds b
  where c.before_values->>'state'='done' and c.after_values->>'state'='open' and c.changed_at>=b.lo and c.changed_at<b.hi order by a.assignee,a.entity_type,a.entity_id,c.changed_at)`,
 "verifications":`verifications as (select assignment_id,assignee,entity_type,entity_id,at,outcome from states where verification and at is not null and outcome in ('Available','Unavailable','Unclear')
  union all select assignment_id,assignee,entity_type,entity_id,occurred_at,outcome from attempts where outcome is not null)`,
 "comparisons":`comparisons as materialized (select distinct on(v.assignee,v.entity_id) v.*,bolna_availability(c.status,c.llm_availability) ai_result from verifications v
  join bolna_call_logs c on v.entity_type='call' and c.id=v.entity_id,bounds b
  where v.at>=b.lo and v.at<b.hi and c.status in ('completed','call-disconnected') and c.llm_availability in ('Available','Unavailable','Unclear')
  order by v.assignee,v.entity_id,v.at desc)`,
 "reused_wh":`reused_wh as (select lower(trim(wh_id)) wh from bolna_assignments where state<>'dropped' and added_to_db and bolna_valid_warehouse(wh_id)
  group by 1 having count(distinct(entity_type,entity_id))>1)`,
 "current_quality":`current_quality as (select a.*,coalesce(bolna_assignment_quality(state,outcome,wh_id,remarks,disposition,closure_reason),
   case when (outcome='Available' or added_to_db) and not bolna_valid_warehouse(wh_id) then 'Missing or invalid warehouse reference'
    when added_to_db and lower(trim(wh_id)) in (select wh from reused_wh) then 'Warehouse reference reused across work targets; verify the property match' end) issue
  from bolna_assignments a where state<>'dropped')`,
};
const REPORT_EVENTS:Record<TeamMetric,string>={
 "open":`select 'open'::text metric,a.assignee,a.id assignment_id,a.id::text event_id,null::timestamptz occurred_at,'Current open workload'::text detail,null::integer duration_seconds from bolna_assignments a where state='open'`,
 "completed":`select 'completed',assignee,assignment_id,assignment_id::text,event_at,provenance||' · '||coalesce(outcome,'Verified closure'),null from first_done,bounds where event_at>=lo and event_at<hi`,
 "available":`select 'available',assignee,assignment_id,assignment_id::text,at,provenance||' · Available found (onboarding counted separately)',null from first_available,bounds where at>=lo and at<hi`,
 "onboarded":`select 'onboarded',assignee,assignment_id,assignment_id::text,at,'Staff-recorded · '||wh_id,null from first_onboarded,bounds where at>=lo and at<hi`,
 "attempts":`select 'attempts',assignee,assignment_id,id::text,occurred_at,disposition||' · '||coalesce(outcome,'No new result')||' · Recorded by '||actor,duration_seconds from period_attempts`,
 "connected":`select 'connected',assignee,assignment_id,id::text,occurred_at,disposition,duration_seconds from period_attempts where disposition in ('connected','callback','awaiting_confirmation')`,
 "duration":`select 'duration',assignee,assignment_id,id::text,occurred_at,'Self-reported seconds',duration_seconds from period_attempts where disposition in ('connected','callback','awaiting_confirmation') and duration_seconds is not null`,
 "repeat_available":`select 'repeat_available',e.assignee,e.assignment_id,e.id::text,e.occurred_at,'Repeated Available result in an explicit attempt',null from period_attempts e where e.outcome='Available'
   and exists(select 1 from attempts old where old.assignee=e.assignee and old.entity_type=e.entity_type and old.entity_id=e.entity_id and old.outcome='Available' and (old.occurred_at,old.created_at,old.id)<(e.occurred_at,e.created_at,e.id))`,
 "quality":`select 'quality',assignee,id,id::text,null,issue,null from current_quality where issue is not null`,
 "overdue":`select 'overdue',assignee,id,id::text,next_due_at,case when next_due_at is null then 'Follow-up needs a date' else 'Follow-up is due' end,null from bolna_assignments,bounds
   where state='open' and disposition=any(bolna_retry_dispositions()) and (next_due_at is null or next_due_at<=as_of)`,
 "reopened":`select 'reopened',assignee,id,id::text,changed_at,'Completion reopened',null from reopened`,
 "comparable":`select 'comparable',assignee,assignment_id,assignment_id::text,at,'Latest AI: '||ai_result||' · Manual: '||outcome,null from comparisons`,
 "mismatch":`select 'mismatch',assignee,assignment_id,assignment_id::text,at,'Latest AI: '||ai_result||' · Manual: '||outcome,null from comparisons where outcome<>ai_result`,
 "legacy":`select 'legacy',a.assignee,a.id,a.id::text,null,'First verification date is unknown; excluded from dated discoveries/onboarding/completions',null from bolna_assignments a where a.id in (
   select assignment_id from first_done where event_at is null union select assignment_id from first_available where at is null union select assignment_id from first_onboarded where at is null)`,
};
export const PRIMARY_TEAM_METRICS:TeamMetric[]=['attempts','connected','available','onboarded','duration'];
export function teamEvidenceSql(metrics:TeamMetric[]){
 const events=metrics.map(metric=>REPORT_EVENTS[metric]).join(' union all '),needed=new Set<string>(['bounds']);
 const include=(fragment:string)=>{for(const [name,definition] of Object.entries(REPORT_CTES)){
  if(!needed.has(name)&&new RegExp('\\b'+name+'\\b').test(fragment)){needed.add(name);include(definition);}
 }};include(events);
 return 'with '+Object.entries(REPORT_CTES).filter(([name])=>needed.has(name)).map(([,sql])=>sql).join(',')+',events(metric,assignee,assignment_id,event_id,occurred_at,detail,duration_seconds) as ('+events+')';
}
export type TeamSummary={email:string;name:string|null;active:boolean;counts:Partial<Record<TeamMetric,number>>;average_seconds:number|null;duration_coverage:number};
export async function teamSummary(viewer:Viewer,f:TeamFilters,now=new Date(),primaryOnly=false):Promise<TeamSummary[]>{
 adminOnly(viewer);const params=[f.date_from,f.date_to,now.toISOString()];const evidence=teamEvidenceSql(primaryOnly?PRIMARY_TEAM_METRICS:metricKeys);
 return (await query<TeamSummary>(`${evidence},totals as(select assignee,metric,count(*)::int n,avg(duration_seconds) average_seconds from events  group by assignee,metric),
 grouped as(select assignee,jsonb_object_agg(metric,n) counts,max(average_seconds) filter(where metric='duration')::float8 average_seconds,max(n) filter(where metric='duration') duration_coverage from totals group by assignee)
 select u.email,u.name,u.active,coalesce(g.counts,'{}'::jsonb) counts,g.average_seconds,coalesce(g.duration_coverage,0)::int duration_coverage
 from bolna_app_users u left join grouped g on g.assignee=u.email order by coalesce(nullif(u.name,''),u.email)`,params)).rows;
}
export type TeamDetail={metric:TeamMetric;assignee:string;assignment_id:string;event_id:string;occurred_at:string|null;detail:string;duration_seconds:number|null;entity_type:'record'|'call';entity_id:string;subject:string|null;current_state:string};
export function teamDetailExport(viewer:Viewer,f:TeamFilters,now=new Date()):ExportQuery{
 adminOnly(viewer);const evidence=teamEvidenceSql([f.metric]);const params:unknown[]=[f.date_from,f.date_to,now.toISOString(),f.metric],where=['e.metric=$4'];
 if(f.caller){params.push(f.caller.toLowerCase());where.push(`e.assignee=$${params.length}`);}
 const selected=`${evidence} select e.*,e.occurred_at::text as occurred_at,a.entity_type,a.entity_id,a.state current_state,
 coalesce(r.owner_name,c.context_details#>>'{recipient_data,name}',a.entity_id::text) subject from events e join bolna_assignments a on a.id=e.assignment_id
 left join raw_records r on a.entity_type='record' and r.id=a.entity_id left join bolna_call_logs c on a.entity_type='call' and c.id=a.entity_id where ${where.join(' and ')}`;
 return {sql:`${selected} order by e.occurred_at desc nulls last,e.assignee,e.event_id`,countSql:`${evidence} select count(*)::text n from events e where ${where.join(' and ')}`,params,countParams:params};
}
export async function teamDetails(viewer:Viewer,f:TeamFilters,now=new Date()){
 const spec=teamDetailExport(viewer,f,now),total=Number((await query(spec.countSql,spec.countParams)).rows[0].n),pages=Math.max(1,Math.ceil(total/50)),page=Math.min(f.page,pages);
 const rows=(await query<TeamDetail>(`${spec.sql} limit 50 offset ${(page-1)*50}`,spec.params)).rows;
 return {rows,total,pages,page};
}
