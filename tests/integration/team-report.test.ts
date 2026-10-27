import {beforeAll,beforeEach,afterAll,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {NextRequest} from 'next/server';
import {query,getPool,transaction} from '@/lib/db';
import {parseTeamFilters,teamDates,teamSummary,teamDetails,teamDetailExport,TEAM_METRICS,type TeamMetric} from '@/lib/team-report';
import {GET as exportApi} from '@/app/api/team/export/route';
import {recordManualAttempt} from '@/lib/manual-attempts';
import {updateAssignment} from '@/lib/assignments';
const admin={email:'admin@team.test',name:null,isAdmin:true},employee={email:'caller@team.test',name:null,isAdmin:false},other='other@team.test';
const auth=vi.hoisted(()=>({admin:true}));vi.mock('@/lib/auth',()=>({getCurrentAdmin:async()=>auth.admin?{email:'admin@team.test',isAdmin:true}:null}));
const f=parseTeamFilters({date_from:'2026-08-02',date_to:'2026-08-02'}),asOf=new Date('2026-08-02T06:00:00Z');
type Task={id:string;entity_id:string;entity_type:'record'|'call';assignee:string};
async function task(kind:'record'|'call'='record',owner=employee.email,values:Record<string,unknown>={},legacy=false):Promise<Task>{
 const entity=randomUUID();if(kind==='record')await query("insert into raw_records(id,source,source_record_id,owner_name) values ($1::uuid,'team',$1::text,'Team warehouse')",[entity]);
 else await query("insert into bolna_call_logs(id,status,llm_availability,call_created_at) values ($1,'completed','Available','2026-08-01T00:00:00Z')",[entity]);
 return transaction(async client=>{if(legacy)await client.query('alter table bolna_assignments disable trigger bolna_assignment_initial_audit; alter table bolna_assignments disable trigger bolna_assignment_quality_guard');
  const row=(await client.query(`insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state,outcome,wh_id,added_to_db,completed_at,assigned_at)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,'2026-07-01T00:00:00Z') returning id::text,entity_id,entity_type,assignee`,[kind,entity,owner,admin.email,values.state||'open',values.outcome||null,values.wh_id||null,values.added_to_db||false,values.completed_at||null])).rows[0];
  if(legacy)await client.query('alter table bolna_assignments enable trigger bolna_assignment_initial_audit; alter table bolna_assignments enable trigger bolna_assignment_quality_guard');return row;});
}
async function audit(a:Task,at:string,after:Record<string,unknown>,before:Record<string,unknown>={state:'open',outcome:null}){
 await query('insert into bolna_assignment_changes(assignment_id,actor,changed_at,before_values,after_values) values($1,$2,$3,$4,$5)',[a.id,a.assignee,at,before,{state:'open',added_to_db:false,...after}]);
}
async function attempt(a:Task,at:string,disposition='connected',outcome:string|null=null,duration:number|null=null,corrects:string|null=null){const id=randomUUID();await query(`insert into bolna_manual_attempts(id,assignment_id,actor,assignee,occurred_at,disposition,outcome,duration_seconds,next_due_at,corrects_id,request_hash)
 values($1,$2,$3,$3,$4,$5,$6,$7,case when $5 in ('callback','awaiting_confirmation') then $4::timestamptz+interval '1 day' end,$8,'fixture')`,[id,a.id,a.assignee,at,disposition,outcome,duration,corrects]);return id;}
const summary=async()=> (await teamSummary(admin,f,asOf)).find(p=>p.email===employee.email)!;
beforeAll(()=>{if(!process.env.TEST_DATABASE_URL||!['127.0.0.1','localhost','[::1]'].includes(new URL(process.env.TEST_DATABASE_URL).hostname))throw Error('Disposable test DB only');});
beforeEach(async()=>{auth.admin=true;await query('truncate bolna_ai_attempts,bolna_assignments,bolna_app_users,bolna_call_logs,raw_phones,raw_records,raw_phone_numbers restart identity cascade');await query("insert into bolna_app_users(email,role) values($1,'admin'),($2,'employee'),($3,'employee')",[admin.email,employee.email,other]);});
afterAll(async()=>{await getPool().end();});
it('keeps admins out of caller performance, evidence and exports even when they have recorded work',async()=>{
 const callerTask=await task(),adminTask=await task('record',admin.email);
 await attempt(callerTask,'2026-08-02T01:00:00Z');
 await attempt(adminTask,'2026-08-02T01:00:00Z');
 expect((await teamSummary(admin,f,asOf)).map(p=>p.email)).toEqual([employee.email,other]);
 expect((await teamDetails(admin,f,asOf)).rows.map(r=>r.assignee)).toEqual([employee.email]);
 const spec=teamDetailExport(admin,f,asOf);
 expect((await query(spec.sql,spec.params)).rows.map(r=>r.assignee)).toEqual([employee.email]);
 expect((await teamDetails(admin,{...f,caller:admin.email},asOf)).total).toBe(0);
});
it('evidence contacts use the listing primary phone or the correct end of an AI call without multiplying rows',async()=>{
 const listing=await task(),outbound=await task('call'),inbound=await task('call'),missing=await task();
 await query("insert into raw_phone_numbers(phone_last10,phone) values ('9811100001','+919811100001'),('9811100002','+919811100002')");
 await query("insert into raw_phones(master_id,phone_id,is_primary) select $1,phone_id,phone_last10='9811100002' from raw_phone_numbers",[listing.entity_id]);
 await query("update bolna_call_logs set call_type='outbound',from_number='+918000000000',to_number='+919811100003' where id=$1",[outbound.entity_id]);
 await query("update bolna_call_logs set call_type='inbound',from_number='+919811100004',to_number='+918000000000' where id=$1",[inbound.entity_id]);
 for(const target of [listing,outbound,inbound,missing])await attempt(target,'2026-08-02T01:00:00Z');
 const data=await teamDetails(admin,{...f,metric:'attempts'},asOf);
 expect(data.total).toBe(4);
 expect((await teamDetails(admin,{...f,q:'9811100004'},asOf)).rows.map(row=>row.entity_id)).toEqual([inbound.entity_id]);
 expect(Object.fromEntries(data.rows.map(row=>[row.entity_id,row.phone]))).toEqual({[listing.entity_id]:'+919811100002',[outbound.entity_id]:'+919811100003',[inbound.entity_id]:'+919811100004',[missing.entity_id]:null});
});
it('removes corrected Available attempts from summary, evidence and export without replaying audit projections',async()=>{
 const a=await task(),id=randomUUID(),at='2026-08-02T04:00:00Z';
 await recordManualAttempt(a.id,employee,{id,revision:0,occurred_at:at,disposition:'connected',outcome:'Available'});
 // An unrelated save also copies the projected outcome into the audit trail.
 await updateAssignment(a.id,employee,{revision:1,remarks:'Checked the owner name against the source listing'});
 const period=parseTeamFilters({date_from:'2026-07-01',date_to:'2099-01-01'});
 expect((await teamSummary(admin,period)).find(p=>p.email===employee.email)?.counts.available).toBe(1);
 await recordManualAttempt(a.id,employee,{id:randomUUID(),revision:2,occurred_at:at,disposition:'connected',outcome:'Unavailable',corrects_id:id,notes:'Correct the mistaken result using the original recording'});
 expect((await teamSummary(admin,period)).find(p=>p.email===employee.email)?.counts.available??0).toBe(0);
 expect((await teamDetails(admin,{...period,metric:'available'})).total).toBe(0);
 const csv=teamDetailExport(admin,{...period,metric:'available'});expect((await query(csv.sql,csv.params)).rows).toHaveLength(0);
});
it('retains an independent dropdown discovery after a logged result is corrected',async()=>{
 const a=await task(),id=randomUUID(),at='2026-08-02T04:00:00Z';
 await updateAssignment(a.id,employee,{revision:0,outcome:'Available'});
 await recordManualAttempt(a.id,employee,{id,revision:1,occurred_at:at,disposition:'connected',outcome:'Available'});
 await recordManualAttempt(a.id,employee,{id:randomUUID(),revision:2,occurred_at:at,disposition:'connected',outcome:'Unavailable',corrects_id:id,notes:'Correct the attempt independently of the earlier verification'});
 const period=parseTeamFilters({date_from:'2026-07-01',date_to:'2099-01-01'});
 expect((await teamSummary(admin,period)).find(p=>p.email===employee.email)?.counts.available).toBe(1);
});
it('uses IST half-open boundaries, corrected events and known timing coverage',async()=>{
 const a=await task();await attempt(a,'2026-08-01T18:29:59Z');await attempt(a,'2026-08-01T18:30:00Z','connected',null,30);
 await attempt(a,'2026-08-02T18:29:59Z','callback');await attempt(a,'2026-08-02T18:30:00Z');
 const bad=await attempt(a,'2026-08-02T04:00:00Z','connected',null,999);await attempt(a,'2026-08-02T04:00:00Z','no_answer',null,null,bad);
 const s=await summary();expect(s.counts).toMatchObject({attempts:3,connected:2,duration:1});expect(s.average_seconds).toBe(30);expect(s.duration_coverage).toBe(1);
 const rows=await teamDetails(admin,{...f,metric:'attempts'},asOf);expect(rows.total).toBe(3);expect(rows.rows.map(r=>r.event_id)).not.toContain(bad);
});

it('evidence channel and duration filters preserve recorded zero and CSV count parity',async()=>{
 const listing=await task(),call=await task('call');
 await attempt(listing,'2026-08-02T01:00:00Z','connected',null,0);
 await attempt(listing,'2026-08-02T02:00:00Z','connected');
 await attempt(call,'2026-08-02T03:00:00Z','connected',null,20);
 const filters=parseTeamFilters({...f,entity_type:'record',has_duration:'yes'});
 const data=await teamDetails(admin,filters,asOf);expect(data.total).toBe(1);expect(data.rows[0].duration_seconds).toBe(0);
 const csv=teamDetailExport(admin,filters,asOf);expect((await query(csv.sql,csv.params)).rows).toHaveLength(1);expect(Number((await query(csv.countSql,csv.countParams)).rows[0].n)).toBe(1);
 expect((await teamDetails(admin,{...filters,has_duration:'no'},asOf)).total).toBe(1);
 expect((await summary()).counts.attempts).toBe(3);
});
it('does not invent dates for legacy discoveries or onboarding',async()=>{
 const a=await task('record',employee.email,{state:'done',outcome:'Available',wh_id:'1011',added_to_db:true,completed_at:'2026-08-02T02:00:00Z'},true);
 await audit(a,'2026-08-02T05:00:00Z',{state:'done',outcome:'Available',wh_id:'1011',added_to_db:true},{state:'done',outcome:'Available',wh_id:'1011',added_to_db:true,completed_at:'2026-08-02T02:00:00Z'});
 const s=await summary();expect(s.counts.available||0).toBe(0);expect(s.counts.onboarded||0).toBe(0);
});
it('keeps first Available discoveries distinct from explicit repeated attempts and mere edits',async()=>{
 const a=await task();await audit(a,'2026-08-02T00:00:00Z',{outcome:'Available',wh_id:'1005'});await audit(a,'2026-08-02T01:00:00Z',{outcome:'Available',wh_id:'1005',remarks:'A note edit'},{state:'open',outcome:'Available',wh_id:'1005'});
 await attempt(a,'2026-08-02T00:00:00Z','connected','Available');await attempt(a,'2026-08-02T02:00:00Z','connected','Available');
 expect((await summary()).counts).toMatchObject({available:1,attempts:2});
 const b=await task();await audit(b,'2026-08-02T00:00:00Z',{outcome:'Available',wh_id:'1006'});expect((await summary()).counts.available).toBe(2);
});
it('counts Available found before a warehouse reference exists, separately from completion and onboarding',async()=>{
 const a=await task();await audit(a,'2026-08-02T01:00:00Z',{outcome:'Available',wh_id:null});
 const s=await summary();expect(s.counts.available).toBe(1);expect(s.counts.onboarded||0).toBe(0);
 expect((await teamDetails(admin,{...f,metric:'available'},asOf)).rows[0].entity_id).toBe(a.entity_id);
 await audit(a,'2026-08-03T01:00:00Z',{outcome:'Available',wh_id:'1010',added_to_db:true},{state:'open',outcome:'Available'});
 const later=await teamSummary(admin,{...f,date_from:'2026-08-03',date_to:'2026-08-03'},asOf);
 expect(later.find(p=>p.email===employee.email)!.counts.available||0).toBe(0);expect(later.find(p=>p.email===employee.email)!.counts.onboarded).toBe(1);
});
it('dates Available discoveries by the recorded attempt, including a backdated attempt',async()=>{
 const a=await task();await attempt(a,'2026-08-02T01:00:00Z','connected','Available');
 await audit(a,'2026-08-03T01:00:00Z',{outcome:'Available',wh_id:null});
 expect((await summary()).counts.available).toBe(1);
 expect((await teamSummary(admin,{...f,date_from:'2026-08-03',date_to:'2026-08-03'},asOf)).find(p=>p.email===employee.email)!.counts.available||0).toBe(0);
});
it('average call duration excludes missing, unconnected and corrected-away durations while retaining reported zero',async()=>{
 const a=await task();await attempt(a,'2026-08-02T01:00:00Z','connected',null,30);await attempt(a,'2026-08-02T02:00:00Z','no_answer',null,10);
 await attempt(a,'2026-08-02T03:00:00Z','connected');await attempt(a,'2026-08-02T04:00:00Z','connected',null,0);
 const original=await attempt(a,'2026-08-02T05:00:00Z','connected',null,900);await attempt(a,'2026-08-02T05:00:00Z','no_answer',null,null,original);
 await attempt(a,'2026-08-03T01:00:00Z','connected',null,999);
 const s=await summary();expect(s.counts).toMatchObject({attempts:5,connected:3,duration:2});expect(s.average_seconds).toBe(15);expect(s.duration_coverage).toBe(2);
 const detail=await teamDetails(admin,{...f,metric:'duration'},asOf);expect(detail.total).toBe(2);expect(detail.rows.reduce((sum,row)=>sum+(row.duration_seconds||0),0)).toBe(30);
});
it('deduplicates onboarding references across callers and rejects placeholders and oversized IDs',async()=>{
 const a=await task(),b=await task('record',other),c=await task();
 await audit(a,'2026-08-02T00:00:00Z',{added_to_db:true,wh_id:' 1012 '});await audit(b,'2026-08-02T01:00:00Z',{added_to_db:true,wh_id:'1012'});
 await audit(c,'2026-08-02T02:00:00Z',{added_to_db:true,wh_id:'x'.repeat(101)});await audit(c,'2026-08-02T03:00:00Z',{added_to_db:true,wh_id:'unknown'});
 const all=await teamSummary(admin,f,asOf);expect(all.reduce((sum,p)=>sum+(p.counts.onboarded||0),0)).toBe(1);expect((await summary()).counts.onboarded).toBe(1);
});
it('all metric drill-downs and CSV counts reconcile and caller filters cannot expose other rows',async()=>{
 const a=await task(),b=await task('call',other);await attempt(a,'2026-08-02T01:00:00Z');await attempt(b,'2026-08-02T02:00:00Z','connected','Unavailable',50);
 const s=await summary();for(const metric of Object.keys(TEAM_METRICS) as TeamMetric[]){const filters={...f,metric,caller:employee.email},rows=await teamDetails(admin,filters,asOf),spec=teamDetailExport(admin,filters,asOf);
  expect(rows.total).toBe(s.counts[metric]||0);expect((await query(spec.sql,spec.params)).rows).toHaveLength(rows.total);expect(rows.rows.every(r=>r.assignee===employee.email)).toBe(true);}
});
it('paginates evidence without truncating totals and clamps a later page',async()=>{
 const a=await task();for(let i=0;i<53;i++)await attempt(a,`2026-08-02T03:00:${String(i).padStart(2,'0')}Z`);
 const result=await teamDetails(admin,{...f,page:999},asOf);expect(result.total).toBe(53);expect(result.page).toBe(2);expect(result.rows).toHaveLength(3);
});
it('validates ranges and selectors and enforces admin scope in readers and endpoints',async()=>{
 expect(()=>parseTeamFilters({date_from:'2026-02-30',date_to:'2026-08-02'})).toThrow();expect(()=>parseTeamFilters({date_from:'2026-08-03',date_to:'2026-08-02'})).toThrow();expect(()=>parseTeamFilters({...f,metric:'attempts;DROP TABLE'})).toThrow();
 expect(teamDates(new Date('2026-08-01T18:30:00Z')).today).toBe('2026-08-02');
 await expect(teamSummary(employee,f)).rejects.toMatchObject({status:403});expect(()=>teamDetailExport(employee,f)).toThrow('forbidden');auth.admin=false;
 expect((await exportApi(new NextRequest('http://localhost/api/team/export'))).status).toBe(403);
});
it('keeps revoked callers and zero-data members in the report with unknown duration',async()=>{
 await query('update bolna_app_users set active=false where email=$1',[employee.email]);const s=await summary();expect(s.active).toBe(false);expect(s.average_seconds).toBeNull();expect(s.counts).toEqual({});
});

it.each(['open','completed','repeat_available','quality','overdue','reopened','comparable','mismatch','legacy'])('rejects retired Team metric %s in pages and exports',async metric=>{
 expect(()=>parseTeamFilters({...f,metric})).toThrow();
 expect((await exportApi(new NextRequest('http://localhost/api/team/export?'+new URLSearchParams({...f,page:String(f.page),metric})))).status).toBe(400);
});

it('caller and access filters reconcile summaries, evidence and CSV; evidence criteria retain count parity',async()=>{
 const a=await task(),b=await task('record',other);await attempt(a,'2026-08-02T01:00:00Z','connected',null,30);await attempt(b,'2026-08-02T02:00:00Z','no_answer');
 await query('update bolna_app_users set active=false where email=$1',[other]);
 const filters=parseTeamFilters({...f,person:employee.email,access:'active'});
 expect((await teamSummary(admin,filters,asOf)).map(p=>p.email)).toEqual([employee.email]);
 expect((await teamDetails(admin,filters,asOf)).total).toBe(1);
 const detail={...filters,q:'Team warehouse',state:'open' as const};
 expect((await teamDetails(admin,detail,asOf)).total).toBe(1);
 const spec=teamDetailExport(admin,detail,asOf);expect((await query(spec.sql,spec.params)).rows).toHaveLength(1);
 expect(Number((await query(spec.countSql,spec.countParams)).rows[0].n)).toBe(1);
 expect((await teamDetails(admin,{...detail,state:'done'},asOf)).total).toBe(0);
 expect((await teamSummary(admin,{...f,access:'removed'},asOf)).map(p=>p.email)).toEqual([other]);
});
