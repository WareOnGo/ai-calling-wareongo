import {beforeAll,beforeEach,afterAll,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {NextRequest} from 'next/server';
import {query,getPool,transaction} from '@/lib/db';
import {parseTeamFilters,teamDates,teamSummary,teamDetails,teamDetailExport,TEAM_METRICS,type TeamMetric} from '@/lib/team-report';
import {GET as exportApi} from '@/app/api/team/export/route';
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
it('uses IST half-open boundaries, corrected events and known timing coverage',async()=>{
 const a=await task();await attempt(a,'2026-08-01T18:29:59Z');await attempt(a,'2026-08-01T18:30:00Z','connected',null,30);
 await attempt(a,'2026-08-02T18:29:59Z','callback');await attempt(a,'2026-08-02T18:30:00Z');
 const bad=await attempt(a,'2026-08-02T04:00:00Z','connected',null,999);await attempt(a,'2026-08-02T04:00:00Z','no_answer',null,null,bad);
 const s=await summary();expect(s.counts).toMatchObject({attempts:3,connected:2,duration:1});expect(s.average_seconds).toBe(30);expect(s.duration_coverage).toBe(1);
 const rows=await teamDetails(admin,{...f,metric:'attempts'},asOf);expect(rows.total).toBe(3);expect(rows.rows.map(r=>r.event_id)).not.toContain(bad);
});
it('counts first valid target completions once across reopen cycles and assignment episodes',async()=>{
 const a=await task();await audit(a,'2026-08-02T00:00:00Z',{state:'done',outcome:'Unavailable'});
 await audit(a,'2026-08-02T01:00:00Z',{state:'open',outcome:'Unavailable'},{state:'done',outcome:'Unavailable'});
 await audit(a,'2026-08-02T02:00:00Z',{state:'done',outcome:'Unavailable'});
 expect((await summary()).counts).toMatchObject({completed:1,reopened:1,open:1});
 const later=parseTeamFilters({date_from:'2026-08-03',date_to:'2026-08-03'});
 await query("update bolna_assignments set state='dropped' where id=$1",[a.id]);
 const next=(await query("insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by) values('record',$1,$2,$3) returning id::text,entity_id,entity_type,assignee",[a.entity_id,a.assignee,admin.email])).rows[0] as Task;
 await audit(next,'2026-08-03T02:00:00Z',{state:'done',outcome:'Unavailable'});
 expect((await teamSummary(admin,later,asOf)).find(p=>p.email===employee.email)!.counts.completed||0).toBe(0);
});
it('excludes invalid legacy Done and retryable closure snapshots from productivity',async()=>{
 const a=await task();await audit(a,'2026-08-02T00:00:00Z',{state:'done',outcome:'Available',wh_id:'N/A'});
 await audit(a,'2026-08-02T01:00:00Z',{state:'done',outcome:'Unavailable',disposition:'busy'});
 expect((await summary()).counts.completed||0).toBe(0);
 await audit(a,'2026-08-02T02:00:00Z',{state:'done',outcome:'Available',wh_id:'1013'});expect((await summary()).counts.completed).toBe(1);
});
it('preserves supported legacy completion timestamps and discloses undated discoveries',async()=>{
 const a=await task('record',employee.email,{state:'done',outcome:'Available',wh_id:'1011',added_to_db:true,completed_at:'2026-08-02T02:00:00Z'},true);
 await audit(a,'2026-08-02T05:00:00Z',{state:'done',outcome:'Available',wh_id:'1011',added_to_db:true},{state:'done',outcome:'Available',wh_id:'1011',added_to_db:true,completed_at:'2026-08-02T02:00:00Z'});
 const s=await summary();expect(s.counts.completed).toBe(1);expect(s.counts.available||0).toBe(0);expect(s.counts.onboarded||0).toBe(0);expect(s.counts.legacy).toBe(1);
});
it('keeps first Available discoveries distinct from explicit repeated attempts and mere edits',async()=>{
 const a=await task();await audit(a,'2026-08-02T00:00:00Z',{outcome:'Available',wh_id:'1005'});await audit(a,'2026-08-02T01:00:00Z',{outcome:'Available',wh_id:'1005',remarks:'A note edit'},{state:'open',outcome:'Available',wh_id:'1005'});
 await attempt(a,'2026-08-02T00:00:00Z','connected','Available');await attempt(a,'2026-08-02T02:00:00Z','connected','Available');
 expect((await summary()).counts).toMatchObject({available:1,repeat_available:1,attempts:2});
 const b=await task();await audit(b,'2026-08-02T00:00:00Z',{outcome:'Available',wh_id:'1006'});expect((await summary()).counts.available).toBe(2);
});
it('counts Available found before a warehouse reference exists, separately from completion and onboarding',async()=>{
 const a=await task();await audit(a,'2026-08-02T01:00:00Z',{outcome:'Available',wh_id:null});
 const s=await summary();expect(s.counts.available).toBe(1);expect(s.counts.completed||0).toBe(0);expect(s.counts.onboarded||0).toBe(0);
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
it('reports current quality and due work independently from selected activity dates',async()=>{
 const a=await task('record',employee.email,{outcome:'Available'}),b=await task();
 await query("update bolna_assignments set disposition='busy',next_due_at='2026-08-01T00:00:00Z' where id=$1",[b.id]);
 const s=await summary();expect(s.counts).toMatchObject({open:2,quality:1,overdue:1});
 const old=await teamSummary(admin,parseTeamFilters({date_from:'2001-01-01',date_to:'2001-01-02'}),asOf);expect(old.find(p=>p.email===employee.email)!.counts).toMatchObject({quality:1,overdue:1});
 expect((await teamDetails(admin,{...f,metric:'quality'},asOf)).rows[0].assignment_id).toBe(a.id);
});
it('compares only exact execution targets with usable AI results and exposes its denominator',async()=>{
 const raw=await task(),call=await task('call'),blocked=await task('call');
 await query("update bolna_call_logs set status='balance-low' where id=$1",[blocked.entity_id]);
 for(const a of [raw,call,blocked])await attempt(a,'2026-08-02T03:00:00Z','connected','Unavailable');
 expect((await summary()).counts).toMatchObject({comparable:1,mismatch:1});
 expect((await teamDetails(admin,{...f,metric:'mismatch'},asOf)).rows[0].entity_id).toBe(call.entity_id);
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
