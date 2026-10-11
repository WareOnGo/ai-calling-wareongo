import {beforeEach,afterEach,afterAll,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {NextRequest} from 'next/server';
import {query,getPool,transaction} from '@/lib/db';
import {assignEntities,updateAssignment} from '@/lib/assignments';
import {recordManualAttempt} from '@/lib/manual-attempts';
import {getRawRecords,rawExportQuery} from '@/lib/raw';
import {getCalls} from '@/lib/calls';
import {aiHistory} from '@/lib/ai-attempts';
import {getBatch,batchMembers,batchMembersExport} from '@/lib/batch-browser';
import {TERMINAL_STATUSES} from '@/lib/bolna';
import {reconcileBatch,reconcileBatches} from '@/lib/batch-reconciliation';
import {PATCH} from '@/app/api/assignments/[id]/route';
import {seedLegacyAssignments} from './fixtures';
const admin={email:'admin@final.test',name:null,isAdmin:true},caller={email:'caller@final.test',name:null,isAdmin:false};
vi.mock('@/lib/auth',()=>({getCurrentUser:async()=>({email:'caller@final.test',name:null,isAdmin:false})}));
beforeEach(async()=>{
 expect(new URL(process.env.TEST_DATABASE_URL!).hostname).toBe('127.0.0.1');
 await query('truncate bolna_ai_attempts,bolna_assignments,bolna_assignment_batches,bolna_app_users,bolna_call_logs,raw_phones,raw_records,raw_phone_numbers,call_batches,bolna_dispatch_requests restart identity cascade');
 await query("insert into bolna_app_users(email,role) values($1,'admin'),($2,'employee')",[admin.email,caller.email]);
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});afterAll(()=>getPool().end());
async function listing(){
 const id=randomUUID();await query("insert into raw_records(id,source,source_record_id) values($1::uuid,'final-review',$1::text)",[id]);
 const p=(await query("insert into raw_phone_numbers(phone_last10,phone) values('9876543210','+919876543210') on conflict(phone_last10) do update set phone=excluded.phone returning phone_id")).rows[0].phone_id;
 await query('insert into raw_phones(master_id,phone_id,is_primary) values($1,$2,true)',[id,p]);return id;
}
async function assigned(){const entity=await listing();await assignEntities({entity:'record',ids:[entity],assignee:caller.email,assignedBy:admin.email});return {entity,id:(await query('select id::text from bolna_assignments order by id desc limit 1')).rows[0].id as string};}
const attempt=(revision:number,outcome?:'Available'|'Unavailable'|'Unclear')=>({id:randomUUID(),revision,occurred_at:new Date().toISOString(),disposition:'connected' as const,...(outcome?{outcome}:{})});
const patch=(id:string,body:object)=>PATCH(new NextRequest(`http://localhost/api/assignments/${id}`,{method:'PATCH',body:JSON.stringify(body)}),{params:Promise.resolve({id})});
const done=async(available=false)=>{const row=await assigned();await recordManualAttempt(row.id,caller,attempt(0,available?'Available':'Unavailable'));await updateAssignment(row.id,caller,{revision:1,state:'done',...(available?{whId:'123'}:{})});return row;};

it.each(['api','sql'])('revalidates every Done result/reference/explanation edit through %s',async channel=>{
 const {id}=await done();
 const invalid=[{outcome:'Available'},{outcome:'Unclear'},{outcome:null}];
 for(const change of invalid){
  if(channel==='api')expect((await patch(id,{revision:2,...change})).status).toBe(422);
  else await expect(query('update bolna_assignments set outcome=$2 where id=$1',[id,change.outcome])).rejects.toMatchObject({code:'23514'});
 }
 await updateAssignment(id,caller,{revision:2,outcome:'Available',whId:'123'});
 if(channel==='api')expect((await patch(id,{revision:3,wh_id:null})).status).toBe(422);
 else await expect(query('update bolna_assignments set wh_id=null where id=$1',[id])).rejects.toMatchObject({code:'23514'});
 await updateAssignment(id,caller,{revision:3,outcome:'Unclear',closure_reason:'escalated',remarks:'Two owners disagree about the available warehouse area.'});
 for(const change of [{remarks:null},{remarks:'Call back later'},{closure_reason:null}]){
  if(channel==='api')expect((await patch(id,{revision:4,...change})).status).toBe(422);
  else {const [column,value]=Object.entries(change)[0];await expect(query(`update bolna_assignments set ${column}=$2 where id=$1`,[id,value])).rejects.toMatchObject({code:'23514'});}
 }
 expect((await query('select state,outcome,wh_id,revision from bolna_assignments where id=$1',[id])).rows[0]).toMatchObject({state:'done',outcome:'Unclear',wh_id:'123',revision:4});
});
it('requires repairing an invalid legacy Done result without requiring an invented call',async()=>{
 const {id}=await assigned();await seedLegacyAssignments("update bolna_assignments set state='done',outcome='Available',wh_id='WH-123' where id=$1",[id]);
 expect((await patch(id,{revision:0,remarks:'Update owner notes without fixing the reference'})).status).toBe(422);
 await expect(query("update bolna_assignments set remarks='Direct historical note edit' where id=$1",[id])).rejects.toMatchObject({code:'23514'});
 expect((await patch(id,{revision:0,wh_id:'123',remarks:'Reference corrected from the retained warehouse record'})).status).toBe(200);
 expect((await patch(id,{revision:1,remarks:'Owner details reviewed after the correction'})).status).toBe(200);
 expect((await query('select count(*)::int n from bolna_manual_attempts')).rows[0].n).toBe(0);
 await updateAssignment(id,caller,{revision:2,state:'open'});await expect(updateAssignment(id,caller,{revision:3,state:'done'})).rejects.toMatchObject({code:'CALL_REQUIRED'});
});
it.each(['api','sql'])('Exhausted never bypasses Available/WH or Unclear/explanation rules through %s',async channel=>{
 const {id}=await assigned();await recordManualAttempt(id,caller,{...attempt(0,'Available'),disposition:'no_answer'});
 const reason='No response after follow-up; the caller deliberately ended further attempts.';
 if(channel==='api')expect((await patch(id,{revision:1,state:'done',closure_reason:'exhausted',remarks:reason})).status).toBe(422);
 else await expect(query("update bolna_assignments set state='done',closure_reason='exhausted',remarks=$2 where id=$1",[id,reason])).rejects.toMatchObject({code:'23514'});
 expect((await patch(id,{revision:1,state:'done',closure_reason:'exhausted',remarks:reason,wh_id:'123'})).status).toBe(200);
 expect((await patch(id,{revision:2,outcome:'Unclear',remarks:'Call back later'})).status).toBe(422);
 expect((await patch(id,{revision:2,outcome:'Unclear',remarks:reason})).status).toBe(200);
});
it('Keep existing result preserves the supplier through a correction chain',async()=>{
 const {id}=await assigned(),first=attempt(0,'Available');await recordManualAttempt(id,caller,first);
 const keep={...attempt(1),occurred_at:first.occurred_at,corrects_id:first.id,notes:'Correct only the duration of the logged conversation',duration_seconds:42};
 await recordManualAttempt(id,caller,keep);
 expect((await query('select outcome,outcome_attempt_id from bolna_assignments where id=$1',[id])).rows[0]).toEqual({outcome:'Available',outcome_attempt_id:keep.id});
 expect((await query('select outcome from bolna_effective_manual_attempts where id=$1',[keep.id])).rows[0].outcome).toBe('Available');
 const changed={...attempt(2,'Unavailable'),occurred_at:first.occurred_at,corrects_id:keep.id,notes:'Correct the result after checking the original recording'};
 await recordManualAttempt(id,caller,changed);expect((await query('select outcome,outcome_attempt_id from bolna_assignments where id=$1',[id])).rows[0]).toEqual({outcome:'Unavailable',outcome_attempt_id:changed.id});
});
it('completed-contact ownership filters include shared Raw listings and Calls with caller scope',async()=>{
 const {entity}=await done(),shared=await listing(),call=randomUUID();
 await query("insert into bolna_call_logs(id,status,call_type,to_number) values($1,'completed','outbound','+919876543210')",[call]);
 const filters={assignment_state:'done',assignee:caller.email};
 expect((await getRawRecords(admin,filters)).rows.map(r=>r.id).sort()).toEqual([entity,shared].sort());
 expect((await getCalls(admin,filters)).rows.map(r=>r.id)).toEqual([call]);
 expect((await getRawRecords(admin,{...filters,assignee:admin.email})).total).toBe(0);
 const spec=rawExportQuery(admin,filters);expect((await query(spec.sql,spec.params)).rows).toHaveLength(2);
 for(const state of ['unassigned','never','open'])expect((await getRawRecords(admin,{assignment_state:state})).total).toBe(0);
});
it('all canonical final statuses leave the AI No final result card and CSV',async()=>{
 const batch=randomUUID();await query("insert into call_batches(id,state,bolna_batch_id) values($1,'scheduled','final-card')",[batch]);
 const statuses=[...TERMINAL_STATUSES,'ringing','in-progress','future-provider-status',null];
 for(const [i,status] of statuses.entries()){
  const phone='98765'+String(i).padStart(5,'0');await query('insert into call_batch_items(batch_id,record_id,name,contact_number) values($1,$2,$3,$4)',[batch,randomUUID(),status??'Unknown',phone]);
  await query("insert into bolna_call_logs(id,batch_id,status,call_type,to_number,call_created_at) values($1,'final-card',$2,'outbound',$3,now())",[randomUUID(),status,phone]);
 }
 const row=await getBatch(admin,'ai',batch),members=await batchMembers(admin,row,'pending');
 expect(members.total).toBe(4);expect(members.rows.some(r=>r.status==='call-disconnected')).toBe(false);
 const spec=batchMembersExport(admin,row,'pending');expect((await query(spec.sql,spec.params)).rows).toHaveLength(4);
});
it('SQL timestamp parsing and stored attempts use UTC even with a non-UTC database session',async()=>{
 const entity=await listing(),execution=randomUUID();
 await transaction(async client=>{
  await client.query("set local timezone='America/New_York'");
  for(const [call,time] of [['earlier','2026-07-08T08:30:12'],['later','2026-07-09T14:00:12+05:30']])await client.query("select bolna_record_ai_evidence($1,'retained')",[{id:execution,status:'no-answer',initiated_at:time,telephony_data:{provider_call_id:call,call_type:'outbound',to_number:'+919876543210'}}]);
  const parsed=(await client.query("select bolna_provider_time('2026-07-08T08:30:12') time,bolna_provider_time('2026-02-30T01:00:00') invalid")).rows[0];expect(parsed.time.toISOString()).toBe('2026-07-08T08:30:12.000Z');expect(parsed.invalid).toBeNull();
 });
 const history=await aiHistory(admin,'record',entity);expect(Number(history.rows[0].interval_seconds)).toBe(86400);expect(new Date(history.rows[1].initiated_at!).toISOString()).toBe('2026-07-08T08:30:12.000Z');
});
async function largeBatch(count=1001){
 const id=randomUUID();await query("insert into call_batches(id,state,bolna_batch_id,updated_at) values($1,'scheduled',$2,now()-interval '1 day')",[id,id]);
 await query("insert into call_batch_items(batch_id,record_id,name,contact_number) values($1,'fixture','Fixture','9876543210')",[id]);
 await query("insert into bolna_dispatch_reservations(phone_last10,batch_id) values('9876543210',$1)",[id]);
 const executions=Array.from({length:count},(_,i)=>({id:'00000000-0000-4000-8000-'+String(i).padStart(12,'0'),status:'completed',initiated_at:'2026-07-08T08:30:12',telephony_data:{provider_call_id:'dial-'+i,to_number:'9876543210',call_type:'outbound'}}));
 return {id,executions};
}
it('large reconciliation yields, resumes reordered snapshots, and retains reservations until every page commits',async()=>{
 const {id,executions}=await largeBatch();let order=executions;
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>Response.json(url.endsWith('/executions')?order:{batch_id:id,status:'executed',valid_contacts:1})));
 expect((await reconcileBatch(id)).state).toBe('scheduled');expect((await query('select reconciliation_offset from call_batches where id=$1',[id])).rows[0].reconciliation_offset).toBe(1000);
 expect((await query('select count(*)::int n from bolna_dispatch_reservations')).rows[0].n).toBe(1);
 order=[...executions].reverse();await query("create function reject_replayed_final_page() returns trigger language plpgsql as $$ begin if NEW.provider_call_id='dial-0' then raise exception 'replayed committed page';end if;return NEW;end $$;create trigger reject_replayed_final_page before insert on bolna_ai_attempts for each row execute function reject_replayed_final_page()");
 try{expect((await reconcileBatch(id)).state).toBe('completed');}finally{await query('drop function reject_replayed_final_page() cascade');}
 expect((await query('select count(*)::int n from bolna_ai_attempts')).rows[0].n).toBe(1001);expect((await query('select count(*)::int n from bolna_dispatch_reservations')).rows[0].n).toBe(0);
});
it('a changed provider snapshot restarts safely and an expired worker lease can resume',async()=>{
 const {id,executions}=await largeBatch();let snapshot=executions;
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>Response.json(url.endsWith('/executions')?snapshot:{batch_id:id,status:'executed',valid_contacts:1})));
 await reconcileBatch(id);await query("update call_batches set reconciliation_token=gen_random_uuid(),reconciliation_lease_until=now()+interval '1 minute' where id=$1",[id]);
 await expect(reconcileBatch(id)).rejects.toMatchObject({status:409});
 snapshot=executions.map((e,i)=>i===0?{...e,status:'call-disconnected'}:e);
 await query("update call_batches set reconciliation_lease_until=now()-interval '1 second' where id=$1",[id]);
 expect((await reconcileBatch(id)).state).toBe('scheduled');expect((await query('select reconciliation_offset from call_batches where id=$1',[id])).rows[0].reconciliation_offset).toBe(1000);
 expect((await reconcileBatch(id)).state).toBe('completed');expect((await query('select count(*)::int n from bolna_ai_attempts')).rows[0].n).toBe(1001);
});
it('cron visits other batches while a large batch waits for its next reconciliation page',async()=>{
 const {id,executions}=await largeBatch();const other=randomUUID();await query("insert into call_batches(id,state,bolna_batch_id,updated_at) values($1::uuid,'scheduled',$1::text,now()-interval '12 hours')",[other]);
 const visited:string[]=[];vi.stubGlobal('fetch',vi.fn(async(url:string)=>{const batch=url.split('/batches/')[1].split('/')[0];visited.push(batch);return Response.json(url.endsWith('/executions')?executions:{batch_id:batch,status:batch===id?'executed':'scheduled',valid_contacts:1});}));
 expect((await reconcileBatches()).checked).toBe(2);expect(visited).toContain(other);expect((await query('select state,reconciliation_offset from call_batches where id=$1',[id])).rows[0]).toMatchObject({state:'scheduled',reconciliation_offset:1000});
});
