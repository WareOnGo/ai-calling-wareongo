import {beforeAll,beforeEach,afterAll,afterEach,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {NextRequest} from 'next/server';
import {query,getPool} from '@/lib/db';
import {POST as webhook} from '@/app/api/bolna-webhook/route';
import {claimEvent,storeEvent} from '@/lib/process-events';
import {getCalls,getCallIds,countCalls,callsExportQuery,getCallDetailsByIds} from '@/lib/calls';
import {getRawRecords} from '@/lib/raw';
import {aiHistory} from '@/lib/ai-attempts';
import {listAssignments} from '@/lib/assignments';
import {deriveCat} from '@/lib/queue';
const admin={email:'admin@test.example',isAdmin:true},employee={email:'employee@test.example',isAdmin:false};
let id:string,record:string;
const payload=(extra:Record<string,unknown>={})=>({id,status:'completed',retry_count:0,created_at:'2026-10-10T03:00:00Z',initiated_at:'2026-10-10T03:01:00Z',updated_at:'2026-10-10T03:02:00Z',batch_id:'provider-batch',conversation_duration:30,transcript:'assistant: Hello\nuser: Warehouse available',telephony_data:{provider:'twilio',provider_call_id:'provider-1',to_number:'+919876543210',call_type:'outbound',duration:30},...extra});
const deliver=async(body:unknown)=>(await webhook(new NextRequest('http://localhost/api/bolna-webhook',{method:'POST',headers:{'x-webhook-secret':'test-evidence-secret'},body:JSON.stringify(body)}))).status;
const capture=async(body:unknown)=>query("select bolna_record_ai_evidence($1::jsonb,'retained')",[body]);
beforeAll(()=>{if(!process.env.TEST_DATABASE_URL||!['127.0.0.1','localhost','[::1]'].includes(new URL(process.env.TEST_DATABASE_URL).hostname))throw Error('Disposable DB required');});
beforeEach(async()=>{
 await query('truncate bolna_ai_attempts,bolna_assignments,bolna_app_users,bolna_webhook_events,bolna_call_logs,raw_phones,raw_records,raw_phone_numbers restart identity cascade');
 vi.stubEnv('BOLNA_WEBHOOK_SECRET','test-evidence-secret');vi.stubEnv('ENFORCE_BOLNA_IP','false');
 id=randomUUID();record=randomUUID();
 await query("insert into bolna_app_users(email,role) values ($1,'admin'),($2,'employee')",[admin.email,employee.email]);
 await query("insert into raw_records(id,source,source_record_id) values ($1,'fixture','ai')",[record]);
 const p=(await query("insert into raw_phone_numbers(phone_last10,phone) values ('9876543210','+919876543210') returning phone_id")).rows[0].phone_id;
 await query('insert into raw_phones(master_id,phone_id,is_primary) values ($1,$2,true)',[record,p]);
 await query("insert into bolna_call_logs(id,phone_id,status,call_type,to_number,call_created_at) values ($1,$2,'completed','outbound','+919876543210',now())",[id,p]);
});
afterEach(()=>vi.unstubAllEnvs());afterAll(async()=>{await getPool().end();});
it('deduplicates repeated and concurrent deliveries including JSON key order',async()=>{
 const e=payload();expect(await Promise.all(Array.from({length:8},()=>deliver(e)))).toEqual(Array(8).fill(200));
 await deliver(Object.fromEntries(Object.entries(e).reverse()));
 expect((await query('select count(*) n from bolna_ai_attempts')).rows[0].n).toBe('1');
 const h=await aiHistory(admin,'call',id);expect(h.total).toBe(1);expect(h.conversations).toBe(1);expect(h.outbound).toBe(1);
});
it('captures nonterminal evidence and finalizes one provider attempt without adding a dial',async()=>{
 expect(await deliver(payload({status:'ringing',updated_at:'2026-10-10T03:01:10Z',conversation_duration:0,transcript:''}))).toBe(200);
 expect((await query('select count(*) n from bolna_webhook_events')).rows[0].n).toBe('0');
 await deliver(payload({status:'call-disconnected',updated_at:'2026-10-10T03:01:30Z',conversation_duration:0}));
 const old=(await claimEvent())!;await deliver(payload());expect(await storeEvent(old)).toBe(false);
 const latest=(await claimEvent())!;expect(await storeEvent(latest)).toBe(true);
 const h=await aiHistory(admin,'call',id);expect(h.total).toBe(1);expect(h.rows[0].status).toBe('completed');expect(h.conversations).toBe(1);
 expect((await query('select status from bolna_call_logs where id=$1',[id])).rows[0].status).toBe('completed');
});
it('later provider calls preserve earlier attempts; out-of-order events do not rewind the latest snapshot',async()=>{
 const old=payload({status:'no-answer',conversation_duration:0,transcript:''});await deliver(old);
 const newer=payload({retry_count:1,initiated_at:'2026-10-10T04:01:00Z',updated_at:'2026-10-10T04:02:00Z',telephony_data:{...payload().telephony_data,provider_call_id:'provider-2'}});
 await deliver(newer);await deliver(old);
 const h=await aiHistory(admin,'record',record);expect(h.total).toBe(2);expect(h.rows[0].provider_call_id).toBe('provider-2');expect(Number(h.rows[0].interval_seconds)).toBe(3600);
 expect((await query('select retry_count,raw from bolna_webhook_events')).rows[0].retry_count).toBe(1);
});
it('batch retry metadata is supported, but reported retry numbers never create unobserved attempts',async()=>{
 const e=payload({retry_count:undefined,batch_run_details:{retried:7}});await deliver(e);
 expect((await query('select retry_count from bolna_webhook_events')).rows[0].retry_count).toBe(7);expect((await aiHistory(admin,'call',id)).total).toBe(1);
});
it('missing provider identity stays unknown even when retry_count and durations are present',async()=>{
 await deliver(payload({retry_count:20,telephony_data:{duration:40,to_number:'+919876543210',call_type:'outbound'}}));
 const h=await aiHistory(admin,'call',id);expect(h.total).toBe(0);expect(h.unknownExecutions).toBe(1);
 expect((await query('select count(*) n from bolna_ai_attempts')).rows[0].n).toBe('0');
});
it.each(['garbage','2026-99-99T03:01:00Z',null])('rejects invalid or missing dial timestamps %s',async(time)=>{
 await capture(payload({initiated_at:time}));const h=await aiHistory(admin,'call',id);expect(h.rows[0].initiated_at).toBeNull();expect(h.rows[0].interval_seconds).toBeNull();expect(h.rows[0].execution_created_at).not.toBeNull();
});
it('keeps inbound counts and phone identity separate from outbound attempts',async()=>{
 await capture(payload({telephony_data:{provider_call_id:'inbound',from_number:'+919876543210',to_number:'+918000000000',call_type:'inbound',duration:30}}));
 const h=await aiHistory(admin,'record',record);expect(h.inbound).toBe(1);expect(h.outbound).toBe(0);expect(h.rows[0].phone_last10).toBe('9876543210');
});
it('a sparse inbound update without direction retains the customer contact instead of the agent number',async()=>{
 await deliver(payload({telephony_data:{provider_call_id:'inbound',from_number:'+919876543210',to_number:'+918000000000',call_type:'inbound',duration:30}}));
 await deliver({id,status:'completed',updated_at:'2026-10-10T03:03:00Z',telephony_data:{provider_call_id:'inbound',to_number:'+918000000000',recording_url:'https://example.test/inbound'}});
 const h=await aiHistory(admin,'record',record);
 expect(h.inbound).toBe(1);expect(h.rows[0].phone_last10).toBe('9876543210');
 expect((await query('select raw from bolna_ai_attempts')).rows[0].raw.telephony_data.call_type).toBe('inbound');
});
it('a direction correction derives the contact from the retained numbers for that dial',async()=>{
 await capture(payload({telephony_data:{provider_call_id:'direction-correction',from_number:'+919876543210',to_number:'+918000000000',call_type:'outbound',duration:30}}));
 await capture({id,status:'completed',updated_at:'2026-10-10T03:03:00Z',telephony_data:{provider_call_id:'direction-correction',call_type:'inbound'}});
 const h=await aiHistory(admin,'record',record);
 expect(h.inbound).toBe(1);expect(h.outbound).toBe(0);expect(h.rows[0].phone_last10).toBe('9876543210');
});
it.each([{conversation_duration:0},{transcript:'assistant: Are you there?'},{answered_by_voice_mail:true},{status:'call-disconnected'}])('requires finalized duration and caller speech to count a conversation: %j',async(extra)=>{
 await capture(payload(extra));expect((await aiHistory(admin,'call',id)).conversations).toBe(0);
});
it('balance blocks are not dials and default rows/count/IDs/export exclude them; explicit status and details retain them',async()=>{
 await deliver(payload({status:'balance-low'}));await storeEvent((await claimEvent())!);
 expect((await aiHistory(admin,'call',id)).total).toBe(0);expect((await getCalls(admin,{})).total).toBe(0);expect(await countCalls(admin,{})).toBe(0);expect((await getCallIds(admin,{},100)).ids).toEqual([]);
 const exp=callsExportQuery(admin,{});expect((await query(exp.sql,exp.params)).rows).toHaveLength(0);
 expect((await getCalls(admin,{status:['balance-low','completed']})).total).toBe(1);expect((await getCalls(admin,{include_blocked:true})).total).toBe(1);expect(await getCallDetailsByIds(admin,[id])).toHaveLength(1);
});
it('busy and no-answer remain retryable and are never labeled dead across Calls/Raw/queue',async()=>{
 for(const status of ['busy','no-answer']){
  await query('update bolna_call_logs set status=$2 where id=$1',[id,status]);
  expect((await getCalls(admin,{})).rows[0].availability).toBe('Unclear');
  const r=(await getRawRecords(admin,{})).rows[0];expect(r.last_availability).toBe('Unclear');expect(deriveCat(r.call_count,r.last_availability)).toBe('unclear');
 }
});
it('AI history colors use Available before Unavailable before Unclear across all saved calls',async()=>{
 expect((await getRawRecords(admin,{})).rows[0].ai_history_result).toBe('Unclear');
 const prior=randomUUID();
 await query("insert into bolna_call_logs(id,phone_id,status,call_type,to_number,llm_availability,call_created_at) select $1,phone_id,'completed','outbound','+919876543210','Unavailable',now()-interval '2 days' from raw_phone_numbers where phone_last10='9876543210'",[prior]);
 expect((await getRawRecords(admin,{})).rows[0]).toMatchObject({ai_history_result:'Unavailable',last_availability:'Unclear'});
 await query("update bolna_call_logs set llm_availability='Available' where id=$1",[prior]);
 // An older result must still count after it leaves the 20-call detail preview.
 await query("insert into bolna_call_logs(id,phone_id,status,call_type,to_number,call_created_at) select gen_random_uuid(),p.phone_id,'no-answer','outbound','+919876543210',now()-interval '1 hour' from generate_series(1,25) cross join raw_phone_numbers p where p.phone_last10='9876543210'");
 expect((await getRawRecords(admin,{})).rows[0]).toMatchObject({ai_history_result:'Available',last_availability:'Unclear'});
 await query("update bolna_call_logs set status='balance-low' where id=$1",[prior]);
 expect((await getRawRecords(admin,{})).rows[0].ai_history_result).toBe('Unclear');
});
it('AI history summary includes inbound calls on alternate phones without replacing the latest result',async()=>{
 const phone=(await query("insert into raw_phone_numbers(phone_last10,phone) values('9876543211','+919876543211') returning phone_id")).rows[0].phone_id;
 await query('insert into raw_phones(master_id,phone_id,is_primary) values($1,$2,false)',[record,phone]);
 await query("insert into bolna_call_logs(id,phone_id,status,call_type,from_number,to_number,llm_availability,call_created_at) values($1,$2,'completed','inbound','+919876543211','+918000000000','Available',now()-interval '1 day')",[randomUUID(),phone]);
 expect((await getRawRecords(admin,{})).rows[0]).toMatchObject({ai_history_result:'Available',last_availability:'Unclear',ai_attempt_count:0,ai_inbound_count:0});
 // No saved call result cannot be presented as an Unclear result.
 await query('delete from bolna_call_logs');
 expect((await getRawRecords(admin,{})).rows[0].ai_history_result).toBeNull();
});
it('AI cards share counts and result precedence across raw records, call analytics and both assignment channels',async()=>{
 const inboundId=randomUUID();
 const phone=(await query("insert into raw_phone_numbers(phone_last10,phone) values('9876543211','+919876543211') returning phone_id")).rows[0].phone_id;
 await query('insert into raw_phones(master_id,phone_id,is_primary) values($1,$2,false)',[record,phone]);
 await query("insert into bolna_call_logs(id,phone_id,status,call_type,from_number,to_number,llm_availability,call_created_at) values($1,$2,'completed','inbound','+919876543211','+918000000000','Available',now()-interval '1 day')",[inboundId,phone]);
 await capture(payload());
 await capture(payload({telephony_data:{...payload().telephony_data,provider_call_id:'provider-2'}}));
 await capture(payload({id:inboundId,telephony_data:{provider_call_id:'inbound',call_type:'inbound',from_number:'+919876543211',to_number:'+918000000000',duration:30}}));
 await query("insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by) values('record',$1,$3,$4),('call',$2,$3,$4)",[record,id,employee.email,admin.email]);
 const raw=(await getRawRecords(admin,{})).rows[0];
 const call=(await getCalls(employee,{})).rows[0];
 expect(raw.ai_summary).toEqual({total:3,outbound:2,inbound:1,conversations:3,result:'Available'});
 expect(raw.ai_history_result).toBe(raw.ai_summary.result);
 expect(call.ai_summary).toEqual({total:2,outbound:2,inbound:0,conversations:2,result:'Unclear'});
 for(const [entity,entityId,summary] of [['record',record,raw.ai_summary],['call',id,call.ai_summary]] as const){
  const history=await aiHistory(employee,entity,entityId);
  expect(history).toMatchObject({total:summary.total,outbound:summary.outbound,inbound:summary.inbound,conversations:summary.conversations});
  const assignment=(await listAssignments(employee,{entity_id:entityId})).rows[0];
  expect(assignment.ai_summary).toEqual(summary);
 }
 // Employee cards and exports stay on the assigned execution, even when the
 // same listing has another inbound call with a different verdict.
 expect((await getCalls(employee,{})).total).toBe(1);
 expect((await getCallDetailsByIds(employee,[id]))[0].ai_summary).toEqual(call.ai_summary);
 const exportQuery=callsExportQuery(employee,{});
 const exported=(await query(exportQuery.sql,exportQuery.params)).rows;
 expect(exported).toHaveLength(1);expect(exported[0].ai_summary).toEqual(call.ai_summary);
});
it('AI cards retain known attempts with unknown direction without inventing outbound calls',async()=>{
 await capture(payload({telephony_data:{provider_call_id:'unknown-direction',to_number:'+919876543210'}}));
 const summary=(await getCalls(admin,{})).rows[0].ai_summary;
 expect(summary).toMatchObject({total:1,outbound:0,inbound:0});
 expect((await getRawRecords(admin,{})).rows[0].ai_summary).toEqual(summary);
 const history=await aiHistory(admin,'call',id);expect(history.total).toBe(1);
});
it('timelines are scoped, paginated and filterable by batch, with intervals computed before pagination',async()=>{
 for(let i=0;i<55;i++)await capture(payload({initiated_at:new Date(Date.UTC(2026,9,10,0,i)).toISOString(),telephony_data:{...payload().telephony_data,provider_call_id:`p-${i}`}}));
 // The same dial retained under another execution cannot inflate totals or
 // push a duplicate onto a second page.
 await capture(payload({id:randomUUID(),initiated_at:new Date(Date.UTC(2026,9,10,0,54)).toISOString(),telephony_data:{...payload().telephony_data,provider_call_id:'p-54'}}));
 expect((await aiHistory(admin,'record',record,{page:2})).rows).toHaveLength(5);
 expect((await aiHistory(admin,'record',record,{batch:'missing'})).total).toBe(0);
 const h=await aiHistory(admin,'record',record,{batch:'provider-batch'});expect(h.total).toBe(55);expect(Number(h.rows[0].interval_seconds)).toBe(60);
 await expect(aiHistory(employee,'call',id)).rejects.toMatchObject({status:404});
 await query("insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by) values ('call',$1,$2,$3)",[id,employee.email,admin.email]);
 expect((await aiHistory(employee,'call',id,{scope:'contact'})).scope).toBe('execution');
});
it('groups shared listings by normalized number and keeps genuine repeat calls',async()=>{
 const duplicate=randomUUID(),listing=randomUUID();
 await query("insert into raw_records(id,source,source_record_id) values($1,'fixture','shared')",[listing]);
 await query('insert into raw_phones(master_id,phone_id,is_primary) select $1,phone_id,true from raw_phones where master_id=$2',[listing,record]);
 await capture(payload());
 await capture(payload({id:duplicate,telephony_data:{...payload().telephony_data,to_number:'98765 43210'}}));
 await capture(payload({initiated_at:'2026-10-10T04:01:00Z',telephony_data:{...payload().telephony_data,provider_call_id:'repeat-call'}}));
 for(const target of [record,listing]){
  const history=await aiHistory(admin,'record',target,{phone:'+91 98765 43210'});
  expect(history.total).toBe(2);expect(history.outbound).toBe(2);expect(history.phones).toEqual(['9876543210']);
  expect(history.rows.map(row=>row.provider_call_id)).toEqual(['repeat-call','provider-1']);
  expect(Number(history.rows[0].interval_seconds)).toBe(3600);
 }
 for(const row of (await getRawRecords(admin,{})).rows)expect(row.ai_summary.total).toBe(2);
});
it('filters one linked number without merging another number or widening employee visibility',async()=>{
 const other=randomUUID();
 const phone=(await query("insert into raw_phone_numbers(phone_last10,phone) values('9876543211','+919876543211') returning phone_id")).rows[0].phone_id;
 await query('insert into raw_phones(master_id,phone_id,is_primary) values($1,$2,false)',[record,phone]);
 await capture(payload());
 await capture(payload({id:other,telephony_data:{...payload().telephony_data,to_number:'+919876543211'}}));
 const all=await aiHistory(admin,'record',record);expect(all.total).toBe(2);expect(all.phones).toEqual(['9876543210','9876543211']);
 const selected=await aiHistory(admin,'record',record,{phone:'9876543211'});expect(selected.total).toBe(1);expect(selected.rows[0].phone_last10).toBe('9876543211');
 await expect(aiHistory(admin,'record',record,{phone:'0000000000'})).rejects.toMatchObject({status:400});
 await query("insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by) values('call',$1,$2,$3)",[id,employee.email,admin.email]);
 expect((await aiHistory(employee,'call',id,{scope:'contact',phone:'9876543210'})).rows).toHaveLength(1);
 await expect(aiHistory(employee,'call',id,{scope:'contact',phone:'9876543211'})).rejects.toMatchObject({status:400});
 await expect(aiHistory(employee,'record',record)).rejects.toMatchObject({status:404});
});
it('attaches recordings and transcripts to their own dial, never later enrichment to an earlier retry',async()=>{
 await capture(payload({transcript:'user: Earlier conversation',telephony_data:{...payload().telephony_data,recording_url:'https://example.test/first'}}));
 const later=payload({initiated_at:'2026-10-10T04:01:00Z',transcript:'user: Later conversation',telephony_data:{...payload().telephony_data,provider_call_id:'provider-2',recording_url:'https://example.test/second'}});
 await capture(later);
 await query("update bolna_call_logs set raw=$2::jsonb,llm_availability='Available',notes='Notes from the second call' where id=$1",[id,later]);
 const [latest,earlier]=(await aiHistory(admin,'record',record)).rows;
 expect(latest).toMatchObject({availability:'Available',notes:'Notes from the second call',transcript:'user: Later conversation',recording_url:'https://example.test/second'});
 expect(earlier).toMatchObject({availability:null,notes:null,transcript:'user: Earlier conversation',recording_url:'https://example.test/first'});
});
it('retains per-dial payloads without a second immutable delivery ledger',async()=>{
 await capture(payload());await capture(payload());expect((await aiHistory(admin,'call',id)).total).toBe(1);
 expect((await query('select raw from bolna_ai_attempts')).rows[0].raw).toEqual(payload());
 expect((await query("select to_regclass('public.bolna_execution_evidence') name")).rows[0].name).toBeNull();
});

it('retains known provider metadata and conversation evidence through sparse newer deliveries',async()=>{
 await capture(payload({retry_count:2}));await capture({id,status:'completed',updated_at:'2026-10-10T03:03:00Z',telephony_data:{provider_call_id:'provider-1'}});
 const row=(await query('select * from bolna_ai_attempts')).rows[0];expect(row.phone_last10).toBe('9876543210');expect(row.batch_id).toBe('provider-batch');expect(row.direction).toBe('outbound');expect(row.confirmed_conversation).toBe(true);expect(Number(row.duration_seconds)).toBe(30);
 expect(new Date(row.provider_updated_at).toISOString()).toBe('2026-10-10T03:03:00.000Z');
 await capture({id,status:'completed',updated_at:'2026-10-10T03:04:00Z',answered_by_voice_mail:true,telephony_data:{provider_call_id:'provider-1'}});
 expect((await query('select confirmed_conversation from bolna_ai_attempts')).rows[0].confirmed_conversation).toBe(false);
 expect((await query('select count(*) n from bolna_ai_attempts')).rows[0].n).toBe('1');
});
it('missing provider status cannot invent a conversation or fail capture',async()=>{
 await capture(payload({status:null}));expect((await query('select confirmed_conversation from bolna_ai_attempts')).rows[0].confirmed_conversation).toBe(false);
});
it.each([0,2])('preserves call-log facts when a sparse webhook updates the same provider dial at retry %s',async retry=>{
 await deliver(payload({retry_count:retry}));await storeEvent((await claimEvent())!);
 const sparse={id,status:'completed',updated_at:'2026-10-10T03:03:00Z',telephony_data:{provider_call_id:'provider-1',recording_url:'https://example.test/corrected-recording'}};
 expect(await deliver(sparse)).toBe(200);
 const event=await claimEvent();expect(event).toBeDefined();await storeEvent(event!);
 const log=(await query('select to_number,transcript,duration_secs,recording_url,raw from bolna_call_logs where id=$1',[id])).rows[0];
 expect(log.to_number).toBe('+919876543210');expect(log.transcript).toContain('user: Warehouse available');expect(log.duration_secs).toBe(30);
 expect(log.recording_url).toBe('https://example.test/corrected-recording');expect(log.raw.retry_count).toBe(retry);
 expect((await aiHistory(admin,'record',record)).total).toBe(1);
});
it.each([null,{retried:null},{run_label:'finalized'}])('retains nested retry identity during a sparse update with batch metadata %j',async batch_run_details=>{
 await deliver(payload({retry_count:undefined,batch_run_details:{retried:'2',run_label:'initial'}}));await storeEvent((await claimEvent())!);
 await deliver({id,status:'completed',updated_at:'2026-10-10T03:03:00Z',batch_run_details,telephony_data:{provider_call_id:'provider-1',recording_url:'https://example.test/nested-retry'}});
 const event=await claimEvent();expect(event).toBeDefined();await storeEvent(event!);
 const log=(await query('select recording_url,raw from bolna_call_logs where id=$1',[id])).rows[0];
 expect(log.recording_url).toBe('https://example.test/nested-retry');expect(log.raw.batch_run_details.retried).toBe('2');
 expect((await query('select count(*)::int n from bolna_ai_attempts')).rows[0].n).toBe(1);
});
it('does not carry speech or duration from one provider dial into a different retry',async()=>{
 await deliver(payload());await storeEvent((await claimEvent())!);
 await deliver({id,status:'no-answer',retry_count:1,initiated_at:'2026-10-10T04:00:00Z',updated_at:'2026-10-10T04:01:00Z',telephony_data:{provider_call_id:'provider-2',call_type:'outbound',to_number:'+919876543210'}});
 await storeEvent((await claimEvent())!);
 const log=(await query('select transcript,duration_secs,raw from bolna_call_logs where id=$1',[id])).rows[0];
 expect(log.transcript).toBeNull();expect(log.duration_secs).toBeNull();expect(log.raw.telephony_data.provider_call_id).toBe('provider-2');
 expect((await aiHistory(admin,'record',record)).total).toBe(2);
});
it('uses retained ringing metadata when the first terminal webhook is sparse',async()=>{
 await deliver(payload({status:'ringing',updated_at:'2026-10-10T03:01:10Z',conversation_duration:0,transcript:''}));
 await deliver({id,status:'completed',updated_at:'2026-10-10T03:03:00Z',conversation_duration:30,transcript:'user: Warehouse available',telephony_data:{provider_call_id:'provider-1',duration:30}});
 await storeEvent((await claimEvent())!);
 const log=(await query('select to_number,call_created_at,transcript,duration_secs from bolna_call_logs where id=$1',[id])).rows[0];
 expect(log.to_number).toBe('+919876543210');expect(log.call_created_at.toISOString()).toBe('2026-10-10T03:00:00.000Z');expect(log.transcript).toContain('user:');expect(log.duration_secs).toBe(30);
});
