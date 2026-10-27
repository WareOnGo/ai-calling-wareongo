import {seedLegacyAssignments} from './fixtures';
import { beforeAll,beforeEach,afterAll,describe,it,expect,vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { query,getPool } from '@/lib/db';
import { assignEntities,updateAssignment,listAssignments } from '@/lib/assignments';
import { recordManualAttempt,manualHistory } from '@/lib/manual-attempts';
import { RETRY_DISPOSITIONS,type Disposition } from '@/lib/manual-dispositions';
import { PATCH } from '@/app/api/assignments/[id]/route';
import { POST as attemptPost } from '@/app/api/assignments/[id]/attempts/route';
const auth=vi.hoisted(()=>({user:{email:'a@test.example',name:null,isAdmin:false}}));
vi.mock('@/lib/auth',()=>({getCurrentUser:async()=>auth.user,getCurrentAdmin:async()=>auth.user.isAdmin?auth.user:null}));
const admin={email:'admin@test.example',name:null,isAdmin:true};
const a={email:'a@test.example',name:null,isAdmin:false},b={email:'b@test.example',name:null,isAdmin:false};
let id:string,entityId:string,callId:string;
beforeAll(()=>{if(!process.env.TEST_DATABASE_URL||new URL(process.env.TEST_DATABASE_URL).hostname!=='127.0.0.1')throw new Error('Local disposable DB required');});
beforeEach(async()=>{
  await query('truncate bolna_ai_attempts, bolna_assignments,bolna_app_users,bolna_call_logs,raw_phones,raw_records,raw_phone_numbers restart identity cascade');
  await query("insert into bolna_app_users(email,role) values($1,'admin'),($2,'employee'),($3,'employee')",[admin.email,a.email,b.email]);
  entityId=randomUUID();callId=randomUUID();
  const phone=(await query("insert into raw_phone_numbers(phone_last10,phone) values('9876543210','+919876543210') returning phone_id")).rows[0].phone_id;
  await query("insert into raw_records(id,source,source_record_id) values($1::uuid,'fixture',$1::text)",[entityId]);
  await query('insert into raw_phones(master_id,phone_id) values($1,$2)',[entityId,phone]);
  await query("insert into bolna_call_logs(id,phone_id,to_number,status,llm_availability) values($1,$2,'+919876543210','completed','Available')",[callId,phone]);
  await assignEntities({entity:'record',ids:[entityId],assignee:a.email,assignedBy:admin.email});
  id=(await query('select id::text from bolna_assignments')).rows[0].id;auth.user={...a};
});
afterAll(async()=>{await getPool().end();});
const patch=(body:unknown)=>PATCH(new NextRequest('http://localhost',{method:'PATCH',body:JSON.stringify(body)}),{params:Promise.resolve({id})});
const event=(disposition:Disposition='connected',revision=0)=>({id:randomUUID(),revision,occurred_at:new Date().toISOString(),disposition,next_due_at:RETRY_DISPOSITIONS.includes(disposition)?new Date(Date.now()+3600000).toISOString():null});
const row=async()=>(await query('select * from bolna_assignments where id=$1',[id])).rows[0];

describe('handoff C: completion gates and event history',()=>{
  it.each([null,'','   ','N/A','unknown','-','x'.repeat(101)])('Available cannot finish with Warehouse ID %s',async wh_id=>{
    const response=await patch({revision:0,state:'done',outcome:'Available',wh_id});expect(response.status).toBe(422);
    expect((await row()).state).toBe('open');expect((await row()).revision).toBe(0);
  });
  it('accepts atomic completion and preserves completion time on later edits',async()=>{
    await recordManualAttempt(id,a,event('connected'));
    expect((await patch({revision:1,state:'done',outcome:'Available',wh_id:'  1001  '})).status).toBe(200);
    const before=await row();expect(before.wh_id).toBe('1001');
    expect((await patch({revision:2,state:'done',remarks:'Confirmed available'})).status).toBe(200);
    expect((await row()).completed_at).toEqual(before.completed_at);
    expect((await patch({revision:3,wh_id:''})).status).toBe(422);
    expect((await row()).completed_at).toEqual(before.completed_at);
    expect((await patch({revision:3,state:'open',wh_id:''})).status).toBe(200);
  });
  it('combines already saved values with a state-only completion',async()=>{
    await recordManualAttempt(id,a,event('connected'));
    await updateAssignment(id,a,{revision:1,outcome:'Available',whId:'1004'});
    expect((await patch({revision:2,state:'done'})).status).toBe(200);
  });
  it.each([{remarks:'',closure_reason:'resolved'},{remarks:'short',closure_reason:'resolved'},{remarks:'aaaaaaaaaaaaaaaaaaaa',closure_reason:'resolved'},{remarks:'Reason provided in detail',closure_reason:null}])('Unclear validates the combined closure fields %#',async fields=>{
    expect((await patch({revision:0,state:'done',outcome:'Unclear',...fields})).status).toBe(422);
  });
  it('allows justified Unclear closure without changing the AI verdict',async()=>{
    await recordManualAttempt(id,a,event('connected'));
    expect((await patch({revision:1,state:'done',outcome:'Unclear',remarks:'Escalated conflicting property details to admin',closure_reason:'escalated'})).status).toBe(200);
    expect((await query('select llm_availability from bolna_call_logs where id=$1',[callId])).rows[0].llm_availability).toBe('Available');
    const audit=(await query('select actor,before_values,after_values from bolna_assignment_changes where assignment_id=$1 order by id desc limit 1',[id])).rows[0];
    expect(audit.actor).toBe(a.email);expect(audit.before_values.state).toBe('open');expect(audit.after_values.state).toBe('done');
  });
  it.each(RETRY_DISPOSITIONS)('%s remains open even with outcome and closure notes',async disposition=>{
    await recordManualAttempt(id,a,event(disposition as Disposition));
    expect((await patch({revision:1,state:'done',outcome:'Unavailable',remarks:'Attempting to close a retryable call',closure_reason:'resolved'})).status).toBe(422);
    expect((await listAssignments(a,{follow_up:'pending'})).total).toBe(1);
    expect((await listAssignments(a,{follow_up:'due'})).total).toBe(0);
    await query("update bolna_assignments set next_due_at=now()-interval '1 minute' where id=$1",[id]);
    expect((await listAssignments(a,{follow_up:'due'})).total).toBe(1);
  });
  it('new connected evidence resolves retry state and allows valid completion',async()=>{
    await recordManualAttempt(id,a,event('busy'));
    await recordManualAttempt(id,a,{...event('connected',1),outcome:'Unavailable'});
    expect((await row()).next_due_at).toBeNull();
    expect((await patch({revision:2,state:'done'})).status).toBe(200);
  });
  it('callback scheduling and observed time are validated in the direct API',async()=>{
    const send=(body:unknown)=>attemptPost(new NextRequest('http://localhost',{method:'POST',body:JSON.stringify(body)}),{params:Promise.resolve({id})});
    expect((await send({...event('callback'),next_due_at:null})).status).toBe(400);
    expect((await send({...event(),occurred_at:new Date(Date.now()+3600000).toISOString()})).status).toBe(400);
    expect((await send({...event(),duration_seconds:-1})).status).toBe(400);
    expect((await send({...event(),actor:b.email})).status).toBe(400);
  });
  it('deduplicates concurrent attempt retries and records one reported event',async()=>{
    const body={...event(),duration_seconds:45};
    await Promise.all([recordManualAttempt(id,a,body),recordManualAttempt(id,a,body)]);
    expect((await query('select count(*) n from bolna_manual_attempts')).rows[0].n).toBe('1');
    expect((await row()).revision).toBe(1);
    await expect(recordManualAttempt(id,a,{...body,notes:'different'})).rejects.toMatchObject({status:409});
  });
  it('preserves later activity when an older attempt is recorded',async()=>{
    const latest=event('connected');await recordManualAttempt(id,a,latest);
    await recordManualAttempt(id,a,{...event('busy',1),occurred_at:new Date(Date.now()-30000).toISOString()});
    expect((await row()).disposition).toBe('connected');
  });
  it('corrections retain the original, do not inflate effective attempts, and are append-only',async()=>{
    const original=event('busy');await recordManualAttempt(id,a,original);
    const correction={...event('connected',1),corrects_id:original.id,notes:'Corrected an accidental disposition selection'};
    await recordManualAttempt(id,a,correction);
    expect((await query('select count(*) n from bolna_effective_manual_attempts')).rows[0].n).toBe('1');
    expect((await manualHistory(a,'record',entityId)).rows.find(e=>e.id===original.id)?.superseded).toBe(true);
    await expect(query("update bolna_manual_attempts set notes='erase' where id=$1",[original.id])).rejects.toThrow('append-only');
    await expect(query('delete from bolna_manual_attempts where id=$1',[correction.id])).rejects.toThrow('append-only');
    await expect(recordManualAttempt(id,a,{...correction,id:randomUUID(),revision:2})).rejects.toMatchObject({status:409});
  });
  it('guards assignment scope, stale revisions, dropped work and history reads',async()=>{
    await expect(recordManualAttempt(id,b,event())).rejects.toMatchObject({status:409});
    await recordManualAttempt(id,a,event());
    await expect(recordManualAttempt(id,a,event())).rejects.toMatchObject({status:409});
    expect((await manualHistory(b,'record',entityId)).rows).toHaveLength(0);
    await query("update bolna_assignments set state='dropped' where id=$1",[id]);
    await expect(recordManualAttempt(id,a,event('connected',1))).rejects.toMatchObject({status:409});
    expect((await manualHistory(a,'record',entityId)).rows).toHaveLength(0);
    expect((await manualHistory(admin,'record',entityId)).rows).toHaveLength(1);
  });
  it('direct SQL cannot bypass completion validation',async()=>{
    await expect(query("update bolna_assignments set state='done',outcome='Available' where id=$1",[id])).rejects.toMatchObject({code:'23514'});
    expect((await row()).state).toBe('open');
  });
  it('verified invalid-number closure needs a specific reason and evidence',async()=>{
    await recordManualAttempt(id,a,event('invalid_number'));
    expect((await patch({revision:1,state:'done'})).status).toBe(422);
    expect((await patch({revision:1,state:'done',closure_reason:'invalid_number_verified',remarks:'Network operator confirmed number does not exist'})).status).toBe(200);
  });
  it('legacy invalid completion is listed for review and can be reopened without erasing history',async()=>{
    const client=await getPool().connect();
    try{await client.query('begin');await client.query('alter table bolna_assignments disable trigger bolna_assignment_quality_guard');
      await client.query("update bolna_assignments set state='done',outcome='Available',remarks='Call back later' where id=$1",[id]);
      await client.query('alter table bolna_assignments enable trigger bolna_assignment_quality_guard');await client.query('commit');
    }catch(e){await client.query('rollback');throw e;}finally{client.release();}
    expect((await listAssignments(admin,{quality_review:true})).total).toBe(1);
    expect((await patch({revision:0,added_to_db:false})).status).toBe(200);
    expect((await patch({revision:1,state:'open'})).status).toBe(200);
    expect((await query('select count(*) n from bolna_assignment_changes where assignment_id=$1',[id])).rows[0].n).toBe('4');
  });
  it('surfaces legacy Unavailable/RNR notes for review without inventing an attempt or silently reopening',async()=>{
    await seedLegacyAssignments("update bolna_assignments set state='done',outcome='Unavailable',remarks='RNR; call back later' where id=$1",[id]);
    expect((await listAssignments(admin,{quality_review:true})).rows[0].id).toBe(id);
    expect((await row()).state).toBe('done');
    expect((await manualHistory(admin,'record',entityId)).total).toBe(0);
  });
});
