import {beforeEach,afterAll,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {query,getPool} from '@/lib/db';
import {assignEntities,updateAssignment} from '@/lib/assignments';
import {previewAssignment} from '@/lib/assignment-allocation';
import {recordManualAttempt} from '@/lib/manual-attempts';
import {executionSchema} from '@/lib/bolna';
vi.mock('@/lib/auth',()=>({getCurrentUser:async()=>({email:'admin@review.test',name:null,isAdmin:true})}));
const admin={email:'admin@review.test',name:null,isAdmin:true};
const a={email:'a@review.test',name:null,isAdmin:false},b={email:'b@review.test',name:null,isAdmin:false};
beforeEach(async()=>{
 if(!['127.0.0.1','localhost'].includes(new URL(process.env.TEST_DATABASE_URL!).hostname))throw new Error('Dedicated fixture DB required');
 await query('truncate bolna_ai_attempts,bolna_assignments,bolna_app_users,bolna_webhook_events,bolna_call_logs,raw_phones,raw_records,raw_phone_numbers,call_batch_items,call_batches,bolna_dispatch_requests restart identity cascade');
 await query("insert into bolna_app_users(email,role) values($1,'admin'),($2,'employee'),($3,'employee')",[admin.email,a.email,b.email]);
});
afterAll(()=>getPool().end());
async function listing(phone='9876543210'){
 const id=randomUUID();await query("insert into raw_records(id,source,source_record_id,state) values($1::uuid,'review',$1::text,'Delhi')",[id]);
 const p=(await query('insert into raw_phone_numbers(phone_last10,phone) values($1,$2) returning phone_id',[phone,'+91'+phone])).rows[0].phone_id;
 await query('insert into raw_phones(master_id,phone_id,is_primary) values($1,$2,true)',[id,p]);return id;
}
async function assigned(){const entity=await listing();await assignEntities({entity:'record',ids:[entity],assignee:a.email,assignedBy:admin.email});return {entity,id:(await query('select id::text from bolna_assignments')).rows[0].id};}
const attempt=(revision:number,outcome?:'Available'|'Unavailable'|'Unclear',at=Date.now())=>({id:randomUUID(),revision,occurred_at:new Date(at).toISOString(),disposition:'connected' as const,...(outcome?{outcome}:{})});
it('rejects Done from the old Result/notes path without a logged call',async()=>{
 const {id}=await assigned();await expect(updateAssignment(id,a,{revision:0,state:'done',outcome:'Unavailable',remarks:'RNR; call back later'})).rejects.toMatchObject({status:422});
 expect((await query('select state from bolna_assignments where id=$1',[id])).rows[0].state).toBe('open');
});
it('direct SQL cannot mark a new assignment Done without a call',async()=>{
 const {id}=await assigned();await expect(query("update bolna_assignments set state='done',outcome='Unavailable' where id=$1",[id])).rejects.toMatchObject({code:'23514'});
});
it.each(['yes','0','done','false','true','WH-123','1.5','-5','1e3'])('rejects placeholder warehouse reference %s',async whId=>{
 const {id}=await assigned();await recordManualAttempt(id,a,attempt(0,'Available'));
 await expect(updateAssignment(id,a,{revision:1,state:'done',whId})).rejects.toMatchObject({status:422});
});
it('does not treat a promise to call back as an Unclear closure explanation',async()=>{
 const {id}=await assigned();await recordManualAttempt(id,a,attempt(0,'Unclear'));
 await expect(updateAssignment(id,a,{revision:1,state:'done',remarks:'call back later',closure_reason:'resolved'})).rejects.toMatchObject({status:422});
});
it.each(['preview','notes','attempt'] as const)('%s does not wait for the unrelated allocation lock',async kind=>{
 const {id,entity}=await assigned();const client=await getPool().connect();let pending:Promise<unknown>|undefined;
 try{await client.query('begin');await client.query('select pg_advisory_xact_lock(81620404)');
 pending=kind==='preview'?previewAssignment({entity:'record',ids:[entity],assignee:b.email,assignedBy:admin.email}):kind==='notes'?updateAssignment(id,a,{revision:0,remarks:'No ownership change'}):recordManualAttempt(id,a,attempt(0));
 const result=await Promise.race([pending.then(()=>true),new Promise<boolean>(resolve=>setTimeout(()=>resolve(false),600))]);expect(result).toBe(true);
 }finally{await client.query('rollback');client.release();await pending;}
});
it('preview remains valid after an unrelated owner remark edit',async()=>{
 const {id,entity}=await assigned();const options={entity:'record' as const,ids:[entity],assignee:b.email,assignedBy:admin.email,reassign:true};
 const before=await previewAssignment(options);await updateAssignment(id,a,{revision:0,remarks:'A routine note'});
 expect((await previewAssignment(options)).previewHash).toBe(before.previewHash);
});
it('round robin retains work already owned by any selected caller',async()=>{
 const {id,entity}=await assigned();const other=await listing('9876543211');await assignEntities({entity:'record',ids:[other],assignee:b.email,assignedBy:admin.email});
 const result=await assignEntities({entity:'record',ids:[entity,other],assignees:[a.email,b.email],assignedBy:admin.email,reassign:true});
 expect(result.assigned).toBe(0);expect(result.retained).toBe(2);expect((await query('select state from bolna_assignments where id=$1',[id])).rows[0].state).toBe('open');
});
it('successive one-row round robin batches rotate the first caller',async()=>{
 const first=await listing(),second=await listing('9876543211');
 for(const id of [first,second])await assignEntities({entity:'record',ids:[id],assignees:[a.email,b.email],assignedBy:admin.email});
 const rows=(await query('select assignee from bolna_assignments order by id')).rows;expect(new Set(rows.map(r=>r.assignee)).size).toBe(2);
});
it('correcting an older result recomputes the effective result when a later call kept it',async()=>{
 const {id}=await assigned(),now=Date.now();const old=attempt(0,'Available',now-2000);await recordManualAttempt(id,a,old);await recordManualAttempt(id,a,attempt(1,undefined,now));
 await recordManualAttempt(id,a,{...attempt(2,'Unavailable',now-2000),corrects_id:old.id,notes:'Correct the earlier availability classification'});
 const row=(await query('select outcome,last_attempt_at from bolna_assignments where id=$1',[id])).rows[0];expect(row.outcome).toBe('Unavailable');expect(new Date(row.last_attempt_at).getTime()).toBe(now);
});
it('correcting an older call preserves a newer explicit manual result',async()=>{
 const {id}=await assigned(),now=Date.now();const old=attempt(0,'Available',now-2000);await recordManualAttempt(id,a,old);await recordManualAttempt(id,a,attempt(1,'Unclear',now));
 await recordManualAttempt(id,a,{...attempt(2,'Unavailable',now-2000),corrects_id:old.id,notes:'Correct the earlier availability classification'});
 expect((await query('select outcome from bolna_assignments where id=$1',[id])).rows[0].outcome).toBe('Unclear');
});
it.each([{conversation_duration:'45',batch_run_details:{retried:null}},{conversation_duration:null,batch_run_details:{retried:'2'}},{conversation_duration:'',batch_run_details:{retried:null}}])('retains documented/provider-compatible optional webhook metadata %#',fields=>{
 expect(executionSchema.safeParse({id:randomUUID(),status:'completed',...fields}).success).toBe(true);
});

it('completed alternate-phone ownership is excluded from Unassigned, while dropped-only contacts return',async()=>{
 const {entity,id}=await assigned(),linked=await listing('9876543212');
 await query('insert into raw_phones(master_id,phone_id) select $1,phone_id from raw_phones where master_id=$2',[linked,entity]);
 await recordManualAttempt(id,a,attempt(0,'Unavailable'));await updateAssignment(id,a,{revision:1,state:'done'});
 const {getRawRecordIds,rawExportQuery}=await import('@/lib/raw');
 expect((await getRawRecordIds(admin,{assignee:'none'},100)).ids).toEqual([]);
 expect((await query(rawExportQuery(admin,{assignment_state:'unassigned'}).sql,rawExportQuery(admin,{assignment_state:'unassigned'}).params)).rows).toHaveLength(0);
 await query("update bolna_assignments set state='dropped' where id=$1",[id]);
 expect((await getRawRecordIds(admin,{assignment_state:'unassigned'},100)).ids.sort()).toEqual([entity,linked].sort());
});
it('city aliases and integer onboarding use the same record as Calls edits',async()=>{
 const entity=await listing();await query("update raw_records set city='Bengaluru' where id=$1",[entity]);
 const call=randomUUID();await query("insert into bolna_call_logs(id,status,call_type,to_number) values($1,'completed','outbound','+919876543210')",[call]);
 await assignEntities({entity:'call',ids:[call],assignee:a.email,assignedBy:admin.email});
 const id=(await query('select id::text from bolna_assignments')).rows[0].id;
 await updateAssignment(id,a,{revision:0,addedToDb:true,whId:'12345'});
 const {getCalls,callsExportQuery}=await import('@/lib/calls');const {getRawRecords}=await import('@/lib/raw');
 expect((await getCalls(admin,{city:'Bangalore',onboarded:'yes'})).rows.map(r=>r.id)).toEqual([call]);
 expect((await getRawRecords(admin,{city:' Bangalore '})).rows.map(r=>r.id)).toEqual([entity]);
 const spec=callsExportQuery(admin,{city:'Bangalore',onboarded:'yes'});expect((await query(spec.sql,spec.params)).rows).toHaveLength(1);
 expect((await query('select added_to_db,wh_id from bolna_call_logs where id=$1',[call])).rows[0]).toMatchObject({added_to_db:false,wh_id:null});
 const {GET}=await import('@/app/api/calls/export/route');const {NextRequest}=await import('next/server');
 const response=await GET(new NextRequest('http://localhost/api/calls/export?city=Bangalore&onboarded=yes'));expect(response.status).toBe(200);
 const [header,row]=(await response.text()).trim().split(/\r?\n/).map(line=>line.split(','));
 expect(row[header.indexOf('WH ID')]).toBe('12345');expect(row[header.indexOf('Added to DB')]).toBe('yes');expect(header).toContain('Legacy Called By');

});
it('Bolna preview deduplicates alternate phones and exposes current human ownership',async()=>{
 const {entity}=await assigned(),linked=await listing('9876543212');
 await query('insert into raw_phones(master_id,phone_id) select $1,phone_id from raw_phones where master_id=$2',[linked,entity]);
 const {getRawQueueRowsByIds}=await import('@/lib/raw');const {assembleBatch}=await import('@/lib/dispatch-plan');
 const rows=await getRawQueueRowsByIds(admin,[entity,linked]);expect(rows.find(r=>r.id===linked)?.owners?.[0].email).toBe(a.email);
 const plan=assembleBatch(rows,[],{availableLanguages:['hindi']});expect(plan.total).toBe(1);expect(plan.humanOwned).toBe(1);expect(plan.callable).toHaveLength(0);
});
it('dispatch rechecks human ownership on alternate numbers after a preview and never calls the provider',async()=>{
 const entity=await listing(),linked=await listing('9876543212');
 await query('insert into raw_phones(master_id,phone_id) select $1,phone_id from raw_phones where master_id=$2',[linked,entity]);
 const {getRawQueueRowsByIds}=await import('@/lib/raw');expect((await getRawQueueRowsByIds(admin,[linked]))[0].owners).toEqual([]);
 await assignEntities({entity:'record',ids:[entity],assignee:a.email,assignedBy:admin.email});
 const {dispatchBatch}=await import('@/lib/dispatch-service');const {vi}=await import('vitest');
 vi.stubEnv('BOLNA_API_KEY','fixture');vi.stubEnv('BOLNA_AGENT_ID',randomUUID());const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 try{await expect(dispatchBatch(admin,{ids:[linked],intentKey:randomUUID(),confirm:true,routingMode:'hindi',excludeCats:[]})).rejects.toMatchObject({status:409});expect(fetcher).not.toHaveBeenCalled();}
 finally{vi.unstubAllEnvs();vi.unstubAllGlobals();}
});
it('string duration and nullable retry metadata survive the actual webhook transaction',async()=>{
 const {POST}=await import('@/app/api/bolna-webhook/route');const {NextRequest}=await import('next/server');const {vi}=await import('vitest');
 vi.stubEnv('BOLNA_WEBHOOK_SECRET','fixture');vi.stubEnv('ENFORCE_BOLNA_IP','false');
 try{const id=randomUUID(),body={id,status:'completed',conversation_duration:'45',initiated_at:'2026-10-10T10:30:00',batch_run_details:{retried:null},transcript:'user: Available',telephony_data:{provider_call_id:'review-provider',call_type:'outbound',to_number:'+919876543210'}};
 const response=await POST(new NextRequest('http://localhost/api/bolna-webhook',{method:'POST',headers:{'x-webhook-secret':'fixture'},body:JSON.stringify(body)}));expect(response.status).toBe(200);
 expect((await query('select raw from bolna_webhook_events where id=$1',[id])).rows[0].raw).toEqual(body);
 expect((await query('select conversation_seconds::int,initiated_at from bolna_ai_attempts where execution_id=$1',[id])).rows[0]).toEqual({conversation_seconds:45,initiated_at:new Date('2026-10-10T10:30:00Z')});
 }finally{vi.unstubAllEnvs();}
});

it('phone searches never fuzzy-match neighboring phone numbers',async()=>{
 const first=await listing('9876543210');await listing('9876543211');
 const {getRawRecords}=await import('@/lib/raw');expect((await getRawRecords(admin,{q:'9876543210'})).rows.map(r=>r.id)).toEqual([first]);
 const id=randomUUID();await query("insert into bolna_call_logs(id,status,to_number) values($1,'completed','+919876543210'),($2,'completed','+919876543211')",[id,randomUUID()]);
 const {getCalls}=await import('@/lib/calls');expect((await getCalls(admin,{q:'9876543210'})).rows.map(r=>r.id)).toEqual([id]);
});
