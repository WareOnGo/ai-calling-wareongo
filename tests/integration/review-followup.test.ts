import {beforeEach,afterEach,afterAll,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {NextRequest} from 'next/server';
import {query,getPool} from '@/lib/db';
import {assignEntities,updateAssignment} from '@/lib/assignments';
import {previewAssignment} from '@/lib/assignment-allocation';
import {recordManualAttempt} from '@/lib/manual-attempts';
import {RETRY_DISPOSITIONS,type Disposition} from '@/lib/manual-dispositions';
import {getRawRecords,getRawRecordIds,getRawQueueRowsByIds} from '@/lib/raw';
import * as rawReaders from '@/lib/raw';
import {getCalls,callsExportQuery} from '@/lib/calls';
import {aiHistory} from '@/lib/ai-attempts';
import {dispatchBatch} from '@/lib/dispatch-service';
import {reconcileBatch} from '@/lib/batch-reconciliation';
import {teamSummary,parseTeamFilters,teamEvidenceSql,PRIMARY_TEAM_METRICS} from '@/lib/team-report';
import {seedLegacyAssignments} from './fixtures';
import {PATCH} from '@/app/api/assignments/[id]/route';
const admin={email:'admin@followup.test',name:null,isAdmin:true},caller={email:'caller@followup.test',name:null,isAdmin:false};
vi.mock('@/lib/auth',()=>({getCurrentUser:async()=>({email:'caller@followup.test',name:null,isAdmin:false})}));
beforeEach(async()=>{
 expect(new URL(process.env.TEST_DATABASE_URL!).hostname).toBe('127.0.0.1');
 await query('truncate bolna_ai_attempts,bolna_assignments,bolna_app_users,bolna_webhook_events,bolna_call_logs,raw_phones,raw_records,raw_phone_numbers,call_batches,bolna_dispatch_requests restart identity cascade');
 await query("insert into bolna_app_users(email,role) values($1,'admin'),($2,'employee')",[admin.email,caller.email]);
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});afterAll(()=>getPool().end());
async function listing(phone='9876543210',city='Delhi'){
 const id=randomUUID();await query("insert into raw_records(id,source,source_record_id,state,city) values($1::uuid,'followup',$1::text,'Delhi',$2)",[id,city]);
 const p=(await query('insert into raw_phone_numbers(phone_last10,phone) values($1,$2) on conflict(phone_last10) do update set phone=excluded.phone returning phone_id',[phone,'+91'+phone])).rows[0].phone_id;
 await query('insert into raw_phones(master_id,phone_id,is_primary) values($1,$2,true)',[id,p]);return id;
}
async function assigned(){const entity=await listing();await assignEntities({entity:'record',ids:[entity],assignee:caller.email,assignedBy:admin.email});return {entity,id:(await query('select id::text from bolna_assignments')).rows[0].id as string};}
const attempt=(revision:number,disposition:Disposition='connected',outcome?:'Available'|'Unavailable'|'Unclear')=>({id:randomUUID(),revision,occurred_at:new Date().toISOString(),disposition,...(outcome?{outcome}:{}),...(['callback','awaiting_confirmation'].includes(disposition)?{next_due_at:new Date(Date.now()+86400000).toISOString()}:{})});
const patch=async(id:string,body:object)=>PATCH(new NextRequest(`http://localhost/api/assignments/${id}`,{method:'PATCH',body:JSON.stringify(body)}),{params:Promise.resolve({id})});
const provider=(id:string,callId:string,time:string,status='completed')=>({id,status,initiated_at:time,updated_at:time,conversation_duration:30,transcript:'user: Available',telephony_data:{provider:'twilio',provider_call_id:callId,to_number:'+919876543210',call_type:'outbound',duration:30}});
const capture=(body:object)=>query("select bolna_record_ai_evidence($1,'retained')",[body]);

it('allows legacy Done notes/result/reference corrections through the real route without inventing calls',async()=>{
 const {id}=await assigned();await seedLegacyAssignments("update bolna_assignments set state='done',outcome='Available',wh_id='123',added_to_db=true where id=$1",[id]);
 for(const body of [{revision:0,remarks:'Confirmed the historical owner details',wh_id:'123'},{revision:1,outcome:'Unavailable'},{revision:2,wh_id:'123'}])expect((await patch(id,body)).status).toBe(200);
 expect((await query('select state,wh_id,remarks from bolna_assignments where id=$1',[id])).rows[0]).toMatchObject({state:'done',wh_id:'123',remarks:'Confirmed the historical owner details'});
 expect((await query('select count(*)::int n from bolna_manual_attempts')).rows[0].n).toBe(0);
 await query("update bolna_assignments set remarks='Direct SQL historical note edit' where id=$1",[id]);
 expect((await patch(id,{revision:3,wh_id:'WH-456'})).status).toBe(422);
 await updateAssignment(id,caller,{revision:3,state:'open'});
 await expect(updateAssignment(id,caller,{revision:4,state:'done'})).rejects.toMatchObject({code:'CALL_REQUIRED'});
});
it('keeps dropdown results on new Keep-existing calls and corrections to older attempts',async()=>{
 const {id}=await assigned(),old=attempt(0,'connected','Available');await recordManualAttempt(id,caller,old);
 await updateAssignment(id,caller,{revision:1,outcome:'Unavailable'});
 await recordManualAttempt(id,caller,attempt(2));
 expect((await query('select outcome,outcome_attempt_id from bolna_assignments where id=$1',[id])).rows[0]).toEqual({outcome:'Unavailable',outcome_attempt_id:null});
 await recordManualAttempt(id,caller,{...attempt(3,'connected','Unclear'),occurred_at:old.occurred_at,corrects_id:old.id,notes:'Correct the classification on the older logged call'});
 expect((await query('select outcome from bolna_assignments where id=$1',[id])).rows[0].outcome).toBe('Unavailable');
});
it('a correction can supply the previously unknown result of the latest call and permit completion',async()=>{
 const {id}=await assigned(),old=attempt(0,'no_answer');await recordManualAttempt(id,caller,old);
 const correction={...attempt(1,'connected','Unavailable'),occurred_at:old.occurred_at,corrects_id:old.id,notes:'Owner answered; no space remains available'};
 await recordManualAttempt(id,caller,correction);
 expect((await query('select outcome,outcome_attempt_id from bolna_assignments where id=$1',[id])).rows[0]).toEqual({outcome:'Unavailable',outcome_attempt_id:correction.id});
 expect((await patch(id,{revision:2,state:'done'})).status).toBe(200);
});
it('correcting the latest Keep-existing call can replace a result inherited from an earlier attempt',async()=>{
 const {id}=await assigned();
 const first={...attempt(0,'connected','Available'),occurred_at:new Date(Date.now()-60000).toISOString()};
 await recordManualAttempt(id,caller,first);
 const latest=attempt(1);await recordManualAttempt(id,caller,latest);
 const correction={...attempt(2,'connected','Unavailable'),occurred_at:latest.occurred_at,corrects_id:latest.id,notes:'The latest call confirmed the warehouse is no longer available'};
 await recordManualAttempt(id,caller,correction);
 expect((await query('select outcome,outcome_attempt_id from bolna_assignments where id=$1',[id])).rows[0]).toEqual({outcome:'Unavailable',outcome_attempt_id:correction.id});
 expect((await patch(id,{revision:3,state:'done'})).status).toBe(200);
});
it('correcting the latest call still preserves an independently selected dropdown result',async()=>{
 const {id}=await assigned();
 await recordManualAttempt(id,caller,{...attempt(0,'connected','Available'),occurred_at:new Date(Date.now()-60000).toISOString()});
 const latest=attempt(1);await recordManualAttempt(id,caller,latest);
 await updateAssignment(id,caller,{revision:2,outcome:'Unclear'});
 await recordManualAttempt(id,caller,{...attempt(3,'connected','Unavailable'),occurred_at:latest.occurred_at,corrects_id:latest.id,notes:'Correct the call history without replacing the independent verification'});
 expect((await query('select outcome,outcome_attempt_id from bolna_assignments where id=$1',[id])).rows[0]).toEqual({outcome:'Unclear',outcome_attempt_id:null});
});
it('a correction to an older unknown call does not supply the result of a later unknown call',async()=>{
 const {id}=await assigned(),old={...attempt(0),occurred_at:new Date(Date.now()-1000).toISOString()};await recordManualAttempt(id,caller,old);
 await recordManualAttempt(id,caller,attempt(1));
 await recordManualAttempt(id,caller,{...attempt(2,'connected','Unavailable'),occurred_at:old.occurred_at,corrects_id:old.id,notes:'Correct the classification of the earlier call'});
 expect((await query('select outcome,outcome_attempt_id from bolna_assignments where id=$1',[id])).rows[0]).toEqual({outcome:null,outcome_attempt_id:null});
});
it.each(RETRY_DISPOSITIONS)('supports explicit Exhausted closure after %s with a substantive reason and no cap',async disposition=>{
 const {id}=await assigned();await recordManualAttempt(id,caller,attempt(0,disposition as Disposition));
 await expect(updateAssignment(id,caller,{revision:1,state:'done',closure_reason:'exhausted',remarks:'RNR'})).rejects.toMatchObject({code:'EXHAUSTION_REASON_REQUIRED'});
 expect((await patch(id,{revision:1,state:'done',closure_reason:'exhausted',remarks:'Unable to reach the contact; further follow-up is exhausted.'})).status).toBe(200);
 expect((await query('select state,closure_reason from bolna_assignments where id=$1',[id])).rows[0]).toEqual({state:'done',closure_reason:'exhausted'});
});
it('Exhausted cannot bypass logged evidence or close a connected call',async()=>{
 const {id}=await assigned();await expect(updateAssignment(id,caller,{revision:0,state:'done',closure_reason:'exhausted',remarks:'Further attempts are not useful for this contact'})).rejects.toMatchObject({code:'CALL_REQUIRED'});
 await recordManualAttempt(id,caller,attempt(0));
 await expect(updateAssignment(id,caller,{revision:1,state:'done',closure_reason:'exhausted',remarks:'Further attempts are not useful for this contact'})).rejects.toMatchObject({code:'EXHAUSTION_ATTEMPT_REQUIRED'});
});
it('completion does not wait behind the global allocation lock',async()=>{
 const {id}=await assigned();await recordManualAttempt(id,caller,attempt(0,'connected','Unavailable'));const client=await getPool().connect();let save:Promise<unknown>|undefined;
 try{await client.query('begin');await client.query('select pg_advisory_xact_lock(81620404)');save=updateAssignment(id,caller,{revision:1,state:'done'});
 expect(await Promise.race([save.then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),750))])).toBe(true);
 }finally{await client.query('rollback');client.release();await save;}
});
it('timezone-less dials use UTC and show ordered intervals across midnight',async()=>{
 const entity=await listing(),id=randomUUID();
 for(const [callId,time] of [['later','2026-10-11T00:05:00'],['earlier','2026-10-10T23:59:00']])await capture(provider(id,callId,time));
 const h=await aiHistory(admin,'record',entity);expect(h.rows.map(r=>r.provider_call_id)).toEqual(['later','earlier']);
 expect(h.rows[0]).toMatchObject({initiated_at:'2026-10-11 00:05:00+00',provider_initiated_at:'2026-10-11T00:05:00',interval_seconds:'360.000000'});
 expect(h.rows[1].interval_seconds).toBeNull();
});
it('uses the same UTC convention across explicit offsets and provider timestamps',async()=>{
 const entity=await listing(),id=randomUUID();await capture(provider(id,'zoned','2026-10-10T03:00:00Z'));
 await capture(provider(id,'local','2026-10-10T04:00:00'));
 const other=provider(id,'other-provider','2026-10-10T05:00:00');other.telephony_data.provider='plivo';await capture(other);
 expect((await aiHistory(admin,'record',entity)).rows.map(r=>r.interval_seconds)).toEqual(['3600.000000','3600.000000',null]);
});
it('unqualified update clocks finalize sparse provider data monotonically without delivery-ledger growth',async()=>{
 const entity=await listing(),id=randomUUID();const old=provider(id,'same','2026-10-10T03:00:00');await capture(old);
 await capture({id,status:'completed',updated_at:'2026-10-10T03:01:00',answered_by_voice_mail:true,telephony_data:{provider_call_id:'same'}});await capture(old);
 const h=await aiHistory(admin,'record',entity);expect(h.rows).toHaveLength(1);expect(h.rows[0].confirmed_conversation).toBe(false);
 expect((await query("select to_regclass('bolna_execution_evidence') evidence,to_regclass('bolna_provider_cache') wallet,to_regclass('bolna_assignment_contact_claims') claims")).rows[0]).toEqual({evidence:null,wallet:null,claims:null});
});
it('completed contact history and Never assigned agree across shared listings and channels',async()=>{
 const {id,entity}=await assigned(),shared=await listing();await recordManualAttempt(id,caller,attempt(0,'connected','Unavailable'));await updateAssignment(id,caller,{revision:1,state:'done'});
 const preview=await previewAssignment({entity:'record',ids:[shared],assignee:caller.email,assignedBy:admin.email});expect(preview.items[0].completed_by[0]).toMatchObject({assignee:caller.email,count:1,outcome:'Unavailable'});
 expect((await getRawRecordIds(admin,{assignment_state:'never'},100)).ids).toEqual([]);
 await query("update bolna_assignments set state='dropped' where id=$1",[id]);expect((await getRawRecordIds(admin,{assignment_state:'unassigned'},100)).ids.sort()).toEqual([entity,shared].sort());expect((await getRawRecordIds(admin,{assignment_state:'never'},100)).ids).toEqual([]);
});
it('Raw history, Last status and Already called ignore balance-low consistently',async()=>{
 const entity=await listing(),id=randomUUID();const phone=(await query('select phone_id from raw_phones where master_id=$1',[entity])).rows[0].phone_id;
 await query("insert into bolna_call_logs(id,phone_id,call_type,to_number,status,call_created_at) values($1,$2,'outbound','+919876543210','balance-low',now())",[id,phone]);
 expect((await getRawRecords(admin,{called:'yes'})).total).toBe(0);expect((await getRawRecords(admin,{called:'no'})).rows[0]).toMatchObject({call_count:'0',last_status:null,last_called_at:null});
 const row=(await getRawQueueRowsByIds(admin,[entity]))[0];expect(row.aiCalls).toBe(0);expect(row.cat).toBe('');
 await query("insert into bolna_call_logs(id,phone_id,call_type,to_number,status,call_created_at) values($1,$2,'outbound','+919876543210','no-answer',now()-interval '1 day')",[randomUUID(),phone]);
 expect((await getRawRecords(admin,{called:'yes'})).rows[0].last_status).toBe('no-answer');
});
it.each([['Bangalore Urban','Bengaluru'],['Bengaluru district',' Bangalore '],['Calcutta','Kolkata'],['Madras','Chennai'],['Poona','Pune'],['Baroda','Vadodara'],['Mysore','Mysuru'],['Calicut','Kozhikode']])('matches city alias %s using %s without broad substring matches',async(city,filter)=>{
 const id=await listing('9876543210',city);await listing('9876543211','New '+city);
 expect((await getRawRecords(admin,{city:filter})).rows.map(r=>r.id)).toEqual([id]);
});
it('keeps exact transcript/note search but never fuzzy-matches their misspellings',async()=>{
 const id=randomUUID();await query("insert into bolna_call_logs(id,status,transcript,notes) values($1,'completed','quartzite','xylophone')",[id]);
 expect((await getCalls(admin,{q:'quartzite'})).rows.map(r=>r.id)).toEqual([id]);expect((await getCalls(admin,{q:'xylophone'})).total).toBe(1);
 expect((await getCalls(admin,{q:'quartzitte'})).total).toBe(0);expect((await getCalls(admin,{q:'xylophonne'})).total).toBe(0);
 await query("update bolna_call_logs set context_details=$2 where id=$1",[id,{recipient_data:{name:"Raghav Sharma"}}]);expect((await getCalls(admin,{q:'Raghv'})).total).toBe(1);
});
it('retains legacy warehouse references in onboarding filters and dated Team history',async()=>{
 const {id,entity}=await assigned();await seedLegacyAssignments("update bolna_assignments set state='done',outcome='Available',wh_id='WH-123',added_to_db=true,completed_at=now() where id=$1",[id]);
 expect((await getRawRecords(admin,{onboarded:'yes'})).rows.map(r=>r.id)).toEqual([entity]);
 const report=(await teamSummary(admin,parseTeamFilters({}))).find(p=>p.email===caller.email)!;expect(report.counts.onboarded).toBe(1);expect((await query('select count(*)::int n from bolna_assignment_quality_review')).rows[0].n).toBe(1);
});
it('shows and exports unmatched legacy call-row onboarding without fabricating an owner',async()=>{
 const id=randomUUID();await query("insert into bolna_call_logs(id,status,added_to_db,wh_id) values($1,'completed',true,'WH-123')",[id]);
 const row=(await getCalls(admin,{onboarded:'yes'})).rows[0];expect(row).toMatchObject({id,assignment_id:null,assignment_added_to_db:true,assignment_wh_id:'WH-123'});
 const spec=callsExportQuery(admin,{onboarded:'yes'});expect((await query(spec.sql,spec.params)).rows[0]).toMatchObject({wh_id:'WH-123',assignment_wh_id:'WH-123'});
});
it('the default Team query contains only five measures; individual evidence avoids unrelated CTEs',async()=>{
 const sql=teamEvidenceSql(PRIMARY_TEAM_METRICS);expect(sql).not.toMatch(/current_quality|comparisons|reopened as|first_done/);
 expect(teamEvidenceSql(['attempts'])).not.toMatch(/snapshots|first_change|first_onboarded|first_available/);
 const five=await teamSummary(admin,parseTeamFilters({}),new Date());expect(five).toHaveLength(2);
});
it('application and database retry policy agree',async()=>{
 expect((await query('select bolna_retry_dispositions() values')).rows[0].values).toEqual(RETRY_DISPOSITIONS);
});
it('dispatch loads expensive metadata before locking and rechecks ownership after that load',async()=>{
 const entity=await listing();const original=rawReaders.getRawQueueRowsByIds;let loaded=false;
 vi.spyOn(rawReaders,'getRawQueueRowsByIds').mockImplementation(async(...args)=>{const rows=await original(...args);loaded=true;return rows;});
 const client=await getPool().connect();let dispatch:Promise<unknown>|undefined;const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 try{await client.query('begin');await client.query('select pg_advisory_xact_lock(81620404)');
 dispatch=dispatchBatch(admin,{ids:[entity],intentKey:randomUUID(),confirm:true,routingMode:'hindi',excludeCats:[]}).catch(e=>e);
 for(let i=0;i<50&&!loaded;i++)await new Promise(r=>setTimeout(r,10));expect(loaded).toBe(true);
 await client.query("insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by) values('record',$1,$2,$3)",[entity,caller.email,admin.email]);await client.query('commit');
 expect(await dispatch).toMatchObject({status:409});expect(fetcher).not.toHaveBeenCalled();
 }finally{await client.query('rollback');client.release();await dispatch;}
});
it('reconciliation tolerates null/string metadata, commits bounded pages and retries a failed page safely',async()=>{
 const batch=randomUUID();await query("insert into call_batches(id,created_by,agent_id,scheduled_at,state,total,callable,bolna_batch_id) values($1,$2,gen_random_uuid(),now(),'scheduled',1,1,'provider-batch')",[batch,admin.email]);
 await query("insert into call_batch_items(batch_id,record_id,name,contact_number,area,cat) values($1,'fixture','Fixture','+919876543210','Delhi','')",[batch]);
 await query("insert into bolna_dispatch_reservations(phone_last10,batch_id) values('9876543210',$1)",[batch]);
 const executions=Array.from({length:501},(_,i)=>({...provider('00000000-0000-4000-8000-'+String(i).padStart(12,'0'),'dial-'+i,'2026-10-10T03:00:00'),retry_count:i%2?null:'0',batch_run_details:{retried:i%2?'2':null}}));
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>Response.json(url.endsWith('/executions')?executions:{batch_id:'provider-batch',status:'executed',valid_contacts:1})));
 await query("create function fail_reconcile_page() returns trigger language plpgsql as $$ begin if NEW.provider_call_id='dial-250' then raise exception 'injected page failure'; end if;return NEW;end $$; create trigger fail_reconcile_page before insert on bolna_ai_attempts for each row execute function fail_reconcile_page()");
 try{await expect(reconcileBatch(batch)).rejects.toThrow('injected page failure');expect((await query('select count(*)::int n from bolna_ai_attempts')).rows[0].n).toBe(250);expect((await query('select count(*)::int n from bolna_dispatch_reservations')).rows[0].n).toBe(1);expect((await query('select reconciliation_offset from call_batches where id=$1',[batch])).rows[0].reconciliation_offset).toBe(250);
 }finally{await query('drop function fail_reconcile_page() cascade');}
 await query("create function fail_replayed_page() returns trigger language plpgsql as $$ begin if NEW.provider_call_id='dial-0' then raise exception 'must not replay committed page'; end if;return NEW;end $$; create trigger fail_replayed_page before insert on bolna_ai_attempts for each row execute function fail_replayed_page()");
 try{expect((await reconcileBatch(batch)).state).toBe('completed');}finally{await query('drop function fail_replayed_page() cascade');}expect((await query('select count(*)::int n from bolna_ai_attempts')).rows[0].n).toBe(501);expect((await query('select count(*)::int n from bolna_dispatch_reservations')).rows[0].n).toBe(0);
});
