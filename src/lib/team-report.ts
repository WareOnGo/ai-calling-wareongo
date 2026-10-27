import {z} from 'zod';
import {CONNECTED_DISPOSITIONS} from './manual-dispositions';
import {query} from './db';
import {ApiError} from './api';
import type {Viewer} from './scope';
import type {ExportQuery} from './export';

const connectedSql = CONNECTED_DISPOSITIONS.map(value => `'${value}'`).join(',');
export const TEAM_METRICS={attempts:'Recorded attempts',connected:'Connected attempts',duration:'Timed connected attempts',available:'First Available targets',onboarded:'Warehouse references onboarded'} as const;
export type TeamMetric=keyof typeof TEAM_METRICS;
const metricKeys=Object.keys(TEAM_METRICS) as [TeamMetric,...TeamMetric[]];
export const teamReportSchema=z.object({entity_type:z.enum(["record","call"]).optional(),has_duration:z.enum(["yes","no"]).optional(),person:z.string().email().max(320).optional(),access:z.enum(['active','removed']).optional(),q:z.string().trim().max(1000).optional(),state:z.enum(['open','done','dropped']).optional(),range:z.enum(['all']).optional(),date_from:z.string().date().optional(),date_to:z.string().date().optional(),caller:z.string().email().max(320).optional(),metric:z.enum(metricKeys).default('attempts'),page:z.coerce.number().int().min(1).max(1000000).default(1)})
 .refine(f=>f.range==='all'||!!f.date_from&&!!f.date_to,'Choose a date range or All time')
 .refine(f=>f.range==='all'||!f.date_from||!f.date_to||f.date_from<=f.date_to,'Start date cannot follow end date');
export type TeamFilters=z.infer<typeof teamReportSchema>;
export function teamDates(now=new Date()){
 const today=new Date(now.getTime()+330*60000).toISOString().slice(0,10);
 const before=(days:number)=>new Date(Date.parse(today+'T00:00:00Z')-days*86400000).toISOString().slice(0,10);
 return {today,yesterday:before(1),week:before(6),month:today.slice(0,8)+'01'};
}
export function parseTeamFilters(input:Record<string,unknown>,now=new Date()):TeamFilters {
 const dates=teamDates(now), values=Object.fromEntries(Object.entries(input).filter(([,v])=>v!==''&&v!==undefined));
 if(values.range==='all') {delete values.date_from; delete values.date_to; return teamReportSchema.parse(values);}
 return teamReportSchema.parse({date_from:dates.week,date_to:dates.today,...values});
}
function adminOnly(viewer:Viewer){if(!viewer.isAdmin)throw new ApiError(403,'forbidden');}

// All cards, row links and CSV use this same event relation. Date filters are
// applied AFTER first-evidence selection, so reopen/edit cycles cannot move a
// first discovery or onboarding into a new reporting period.
// Assemble only the CTEs required by the requested measures. The default page
// requests five metrics; a drill-down builds only its own dependency chain.
const REPORT_CTES={
 "bounds":`bounds as (select coalesce(($1::date::timestamp at time zone 'Asia/Kolkata'),'-infinity'::timestamptz) lo,
 coalesce((($2::date+interval '1 day') at time zone 'Asia/Kolkata'),'infinity'::timestamptz) hi, $1::date is null as all_time, $3::timestamptz as_of)`,
 "first_change":`first_change as materialized (select distinct on(assignment_id) assignment_id,before_values from bolna_assignment_changes order by assignment_id,id)`,
 "snapshots":`snapshots as materialized (
  select a.id assignment_id,coalesce(c.before_values,to_jsonb(a)) v,null::timestamptz at,'Retained legacy state'::text provenance
   from bolna_assignments a left join first_change c on c.assignment_id=a.id where c.before_values is distinct from '{}'::jsonb
  union all select assignment_id,after_values,changed_at,'Assignment audit'
   from bolna_assignment_changes
  union all select id,jsonb_build_object('wh_id',wh_id,'added_to_db',added_to_db),null,'Imported legacy onboarding'
   from bolna_assignments where legacy_onboarding
 )`,
 "states":`states as materialized (select s.*,a.assignee,a.entity_type,a.entity_id,
  s.v->>'outcome' outcome,s.v->>'wh_id' wh_id,bolna_recorded_warehouse(s.v->>'wh_id') valid_wh
  from snapshots s join bolna_assignments a on a.id=s.assignment_id)`,
 "first_onboarded":`first_onboarded as (select distinct on(lower(trim(wh_id))) * from states where valid_wh and (v->>'added_to_db')::boolean
  order by lower(trim(wh_id)),at nulls first,assignment_id)`,
 "attempts":`attempts as materialized (select e.*,a.entity_type,a.entity_id from bolna_effective_manual_attempts e join bolna_assignments a on a.id=e.assignment_id)`,
 "available_observations":`available_observations as (
  -- Attempt-derived snapshots are projections, not independent discoveries.
  -- Read their evidence from effective attempts so a correction removes the old result.
  select assignment_id,assignee,entity_type,entity_id,at,provenance from states
   where outcome='Available' and nullif(v->>'outcome_attempt_id','') is null
  union all select assignment_id,assignee,entity_type,entity_id,occurred_at,'Recorded manual attempt' from attempts where outcome='Available'
 )`,
 "first_available":`first_available as (select distinct on(assignee,entity_type,entity_id) * from available_observations
  order by assignee,entity_type,entity_id,at nulls first,assignment_id,provenance)`,
 "period_attempts":`period_attempts as (select e.* from attempts e,bounds b where e.occurred_at>=b.lo and e.occurred_at<b.hi)`,
};
const REPORT_EVENTS:Record<TeamMetric,string>={
 "available":`select 'available',assignee,assignment_id,assignment_id::text,at,provenance||' · Available found (onboarding counted separately)',null from first_available,bounds where (at>=lo and at<hi) or (all_time and at is null)`,
 "onboarded":`select 'onboarded',assignee,assignment_id,assignment_id::text,at,'Staff-recorded · '||wh_id,null from first_onboarded,bounds where (at>=lo and at<hi) or (all_time and at is null)`,
 "attempts":`select 'attempts',assignee,assignment_id,id::text,occurred_at,disposition||' · '||coalesce(outcome,'No new result')||' · Recorded by '||actor,duration_seconds from period_attempts`,
 "connected":`select 'connected',assignee,assignment_id,id::text,occurred_at,disposition,duration_seconds from period_attempts where disposition in (${connectedSql})`,
 "duration":`select 'duration',assignee,assignment_id,id::text,occurred_at,'Self-reported seconds',duration_seconds from period_attempts where disposition in (${connectedSql}) and duration_seconds is not null`,
};
export const PRIMARY_TEAM_METRICS:TeamMetric[]=['attempts','connected','available','onboarded','duration'];
const attemptCtes=['attempts','period_attempts'] as const;
const stateCtes=['first_change','snapshots','states'] as const;
// Explicit, typed dependencies avoid inferring a query graph from SQL text.
const METRIC_CTES:Record<TeamMetric,readonly (keyof typeof REPORT_CTES)[]>={
 attempts:attemptCtes,connected:attemptCtes,duration:attemptCtes,
 available:[...stateCtes,'attempts','available_observations','first_available'],
 onboarded:[...stateCtes,'first_onboarded'],
};
export function teamEvidenceSql(metrics:TeamMetric[]){
 const events=metrics.map(metric=>REPORT_EVENTS[metric]).join(' union all ');
 const needed=new Set<string>(['bounds',...metrics.flatMap(metric=>METRIC_CTES[metric])]);
 return 'with '+Object.entries(REPORT_CTES).filter(([name])=>needed.has(name)).map(([,sql])=>sql).join(',')+',events(metric,assignee,assignment_id,event_id,occurred_at,detail,duration_seconds) as ('+events+')';
}
export type TeamSummary={email:string;name:string|null;active:boolean;counts:Partial<Record<TeamMetric,number>>;average_seconds:number|null;duration_coverage:number};
function rosterWhere(f:TeamFilters,params:unknown[],userAlias='u') {
 const where:string[]=[`${userAlias}.role='employee'`];
 if(f.person){params.push(f.person.toLowerCase());where.push(`${userAlias}.email=$${params.length}`);}
 if(f.access)where.push(`${userAlias}.active=${f.access==='active'?'true':'false'}`);
 return where;
}
export async function teamSummary(viewer:Viewer,f:TeamFilters,now=new Date()):Promise<TeamSummary[]>{
 adminOnly(viewer);const params:unknown[]=[f.range==='all'?null:f.date_from,f.range==='all'?null:f.date_to,now.toISOString()];const evidence=teamEvidenceSql(PRIMARY_TEAM_METRICS);const where=rosterWhere(f,params);
 return (await query<TeamSummary>(`${evidence},totals as(select assignee,metric,count(*)::int n,avg(duration_seconds) average_seconds from events  group by assignee,metric),
 grouped as(select assignee,jsonb_object_agg(metric,n) counts,max(average_seconds) filter(where metric='duration')::float8 average_seconds,max(n) filter(where metric='duration') duration_coverage from totals group by assignee)
 select u.email,u.name,u.active,coalesce(g.counts,'{}'::jsonb) counts,g.average_seconds,coalesce(g.duration_coverage,0)::int duration_coverage
 from bolna_app_users u left join grouped g on g.assignee=u.email ${where.length?'where '+where.join(' and '):''} order by coalesce(nullif(u.name,''),u.email)`,params)).rows;
}
export type TeamDetail={metric:TeamMetric;assignee:string;assignment_id:string;event_id:string;occurred_at:string|null;detail:string;duration_seconds:number|null;entity_type:'record'|'call';entity_id:string;subject:string|null;phone:string|null;current_state:string};
export function teamDetailExport(viewer:Viewer,f:TeamFilters,now=new Date()):ExportQuery{
 adminOnly(viewer);const evidence=teamEvidenceSql([f.metric]);const params:unknown[]=[f.range==='all'?null:f.date_from,f.range==='all'?null:f.date_to,now.toISOString(),f.metric],where=['e.metric=$4'];
 if(f.caller){params.push(f.caller.toLowerCase());where.push(`e.assignee=$${params.length}`);}
 where.push(...rosterWhere(f,params));
 if(f.state){params.push(f.state);where.push(`a.state=$${params.length}`);}
 if(f.entity_type){params.push(f.entity_type);where.push(`a.entity_type=$${params.length}`);}
 if(f.has_duration)where.push(`e.duration_seconds is ${f.has_duration==='yes'?'not ':''}null`);
 if(f.q){params.push(f.q);where.push(`(coalesce(r.owner_name,c.context_details#>>'{recipient_data,name}',a.entity_id::text) ilike '%'||$${params.length}||'%' or e.detail ilike '%'||$${params.length}||'%' or coalesce(rphone.phone,case when c.call_type='inbound' then c.from_number else c.to_number end,'') ilike '%'||$${params.length}||'%')`);}
 const from=`from events e join bolna_assignments a on a.id=e.assignment_id
 left join bolna_app_users u on u.email=e.assignee
 left join raw_records r on a.entity_type='record' and r.id=a.entity_id left join bolna_call_logs c on a.entity_type='call' and c.id=a.entity_id
 left join lateral (select pn.phone from raw_phones rp join raw_phone_numbers pn on pn.phone_id=rp.phone_id
   where rp.master_id=r.id and nullif(trim(pn.phone),'') is not null order by rp.is_primary desc,pn.phone limit 1) rphone on true
 where ${where.join(' and ')}`;
 const selected=`${evidence} select e.*,e.occurred_at::text as occurred_at,a.entity_type,a.entity_id,a.state current_state,
 coalesce(r.owner_name,c.context_details#>>'{recipient_data,name}',a.entity_id::text) subject,
 coalesce(rphone.phone,case when c.call_type='inbound' then c.from_number else c.to_number end) phone ${from}`;
 return {sql:`${selected} order by e.occurred_at desc nulls last,e.assignee,e.event_id`,countSql:`${evidence} select count(*)::text n ${from}`,params,countParams:params};
}
export async function teamDetails(viewer:Viewer,f:TeamFilters,now=new Date()){
 const spec=teamDetailExport(viewer,f,now),total=Number((await query(spec.countSql,spec.countParams)).rows[0].n),pages=Math.max(1,Math.ceil(total/50)),page=Math.min(f.page,pages);
 const rows=(await query<TeamDetail>(`${spec.sql} limit 50 offset ${(page-1)*50}`,spec.params)).rows;
 return {rows,total,pages,page};
}
