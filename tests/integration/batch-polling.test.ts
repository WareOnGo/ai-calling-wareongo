import {beforeAll,beforeEach,afterEach,afterAll,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {NextRequest} from 'next/server';
import {getPool,query} from '@/lib/db';
import {reconcileBatch,reconcileBatches,syncVisibleBatches} from '@/lib/batch-reconciliation';
import {POST as worker} from '@/app/api/batches/reconcile/route';

const phone='9876543210',agent='00000000-0000-4000-8000-000000000001';
let batch:string,providerId:string;
const execution=(extra:Record<string,unknown>={})=>({id:randomUUID(),batch_id:providerId,agent_id:agent,status:'completed',
  retry_count:0,created_at:'2026-10-15T04:00:00Z',initiated_at:'2026-10-15T04:10:00Z',updated_at:'2026-10-15T04:11:00Z',
  transcript:'assistant: Hello\nuser: Available',conversation_duration:49,
  telephony_data:{provider_call_id:randomUUID(),call_type:'outbound',to_number:'+91'+phone,duration:49,recording_url:'https://recording.test/final'},...extra});
async function createBatch(provider=providerId){
  const id=randomUUID();
  await query(`insert into call_batches(id,agent_id,state,bolna_batch_id,updated_at,scheduled_at)
    values($1,$2,'scheduled',$3,now()-interval '1 day',now()-interval '1 hour')`,[id,agent,provider]);
  await query(`insert into call_batch_items(batch_id,record_id,name,contact_number) values($1,$2,'Test contact',$3)`,[id,randomUUID(),phone]);
  await query('insert into bolna_dispatch_reservations(phone_last10,batch_id) values($1,$2)',[phone,id]);
  return id;
}
function mockProvider(rows:unknown[]|(()=>unknown[]),status='running',valid_contacts=1){
  const mock=vi.fn(async(input:string|URL|Request,init?:RequestInit)=>{
    expect(init?.method).toBe('GET');
    const path=new URL(String(input)).pathname;
    expect(path).toMatch(/^\/batches\//);
    return Response.json(path.endsWith('/executions')?(typeof rows==='function'?rows():rows):{batch_id:providerId,status,valid_contacts});
  });vi.stubGlobal('fetch',mock);return mock;
}
const saved=async()=> (await query('select * from call_batches where id=$1',[batch])).rows[0];
const reservations=async()=>Number((await query('select count(*) n from bolna_dispatch_reservations where batch_id=$1',[batch])).rows[0].n);
beforeAll(()=>{expect(new URL(process.env.TEST_DATABASE_URL!).hostname).toBe('127.0.0.1');});
beforeEach(async()=>{
  await query('truncate bolna_ai_attempts,bolna_assignments,bolna_app_users,bolna_call_logs,bolna_webhook_events,raw_phones,raw_records,raw_phone_numbers,call_batches,bolna_dispatch_requests restart identity cascade');
  providerId='poll-'+randomUUID();batch=await createBatch();
  vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Unexpected provider request');}));
});
afterEach(()=>vi.unstubAllGlobals());afterAll(()=>getPool().end());

it('catches missed final updates while running, preserving earlier dials and manual annotations',async()=>{
  const final=execution(),old={...final,status:'call-disconnected',retry_count:0,telephony_data:{...final.telephony_data,provider_call_id:'earlier-dial',duration:0,recording_url:null}};
  const latest={...final,retry_count:1,updated_at:'2026-10-15T04:20:00Z'};
  await query(`insert into bolna_call_logs(id,batch_id,status,raw,added_to_db,wh_id,called_by,m_call_status)
    values($1,$2,'call-disconnected',$3,true,'123','caller@test.example','Available')`,[final.id,providerId,old]);
  mockProvider([latest]);
  expect((await reconcileBatch(batch)).state).toBe('scheduled');
  expect((await query('select status,duration_secs,recording_url,added_to_db,wh_id,called_by,m_call_status from bolna_call_logs')).rows[0])
    .toMatchObject({status:'completed',duration_secs:49,recording_url:'https://recording.test/final',added_to_db:true,wh_id:'123',called_by:'caller@test.example',m_call_status:'Available'});
  expect((await query('select count(*)::int n from bolna_ai_attempts')).rows[0].n).toBe(2);
  expect(await saved()).toMatchObject({reconciliation_provider_state:'running',reconciliation_checked_at:expect.any(Date)});
  expect(await reservations()).toBe(1);
  await reconcileBatch(batch);
  expect((await query('select count(*)::int n from bolna_ai_attempts')).rows[0].n).toBe(2);
  expect((await query("select count(*)::int n from bolna_webhook_events where status<>'processed'")).rows[0].n).toBe(0);
});
it('records balance-blocked results without inventing dials or calling scheduled contacts',async()=>{
  const scheduled=execution({status:'scheduled',telephony_data:null,user_number:'+91'+phone});
  mockProvider([scheduled,execution({status:'balance-low',telephony_data:null,user_number:'+91'+phone})]);
  await reconcileBatch(batch);
  expect((await query('select status from bolna_call_logs')).rows).toEqual([{status:'balance-low'}]);
  expect((await query('select count(*)::int n from bolna_ai_attempts')).rows[0].n).toBe(0);
  expect(await reservations()).toBe(1);
});
it.each(['completed','stopped'])('accepts current provider %s without requiring three retries',async status=>{
  mockProvider([execution({status:'busy',retry_count:0,batch_run_details:{status}})],status);
  expect((await reconcileBatch(batch)).state).toBe(status==='stopped'?'canceled':'completed');
  expect(await reservations()).toBe(0);
});
it('requires retry exhaustion for legacy executed snapshots',async()=>{
  let rows=[execution({status:'no-answer',retry_count:1})];mockProvider(()=>rows,'executed');
  expect((await reconcileBatch(batch)).state).toBe('scheduled');
  rows=[{...rows[0],retry_count:3}];
  expect((await reconcileBatch(batch)).state).toBe('completed');
});
it.each(['running','completed','executed'])('never finishes a %s batch from a disconnected call alone',async status=>{
  mockProvider([execution({status:'call-disconnected'})],status);
  expect((await reconcileBatch(batch)).state).toBe('scheduled');expect(await reservations()).toBe(1);
});
it('keeps reservations when provider completion is missing a target or has queued retries',async()=>{
  let rows=[execution({telephony_data:{...execution().telephony_data,to_number:'+919999999999'}})];
  mockProvider(()=>rows,'completed');expect((await reconcileBatch(batch)).state).toBe('scheduled');
  rows=[execution(),execution({status:'rescheduled'})];
  expect((await reconcileBatch(batch)).state).toBe('scheduled');expect(await reservations()).toBe(1);
});
it.each(['wrong batch','duplicate id','invalid id'])('rejects a %s snapshot before importing it',async fault=>{
  const one=execution();const rows=fault==='duplicate id'?[one,one]:[{...one,...(fault==='wrong batch'?{batch_id:'different'}:{id:'bad-id'})}];
  mockProvider(rows,'completed');await expect(reconcileBatch(batch)).rejects.toBeDefined();
  expect((await query('select count(*)::int n from bolna_call_logs')).rows[0].n).toBe(0);
  expect((await saved()).reconciliation_token).toBeNull();expect(await reservations()).toBe(1);
});
const many=()=>Array.from({length:1001},(_,i)=>execution({id:'00000000-0000-4000-8000-'+String(i).padStart(12,'0')}));
it('advances active batches despite changing earlier rows and wraps for the next catch-up sweep',async()=>{
  let rows=many();mockProvider(()=>rows);
  await reconcileBatch(batch);
  expect((await saved()).reconciliation_after_id).toBe(rows[999].id);
  rows=rows.map((r,i)=>i===0?{...r,updated_at:'2026-10-15T05:00:00Z',telephony_data:{...r.telephony_data,duration:70}}:r).reverse();
  await reconcileBatch(batch);
  expect((await query('select count(*)::int n from bolna_call_logs')).rows[0].n).toBe(1001);
  expect((await saved()).reconciliation_after_id).toBeNull();
  await reconcileBatch(batch);
  expect((await query('select duration_secs from bolna_call_logs where id=$1',[rows.at(-1)!.id])).rows[0].duration_secs).toBe(70);
  expect(await reservations()).toBe(1);
});
it('finishes a large completed batch only after every snapshot page is imported',async()=>{
  const rows=many();mockProvider(rows,'completed');
  expect((await reconcileBatch(batch)).state).toBe('scheduled');expect((await saved()).reconciliation_offset).toBe(1000);
  rows.reverse();expect((await reconcileBatch(batch)).state).toBe('completed');
  expect((await query('select count(*)::int n from bolna_call_logs')).rows[0].n).toBe(1001);expect(await reservations()).toBe(0);
});
it('defers an unchanged active event lease and finishes after it expires',async()=>{
  const row=execution();const lease=randomUUID();
  await query(`insert into bolna_webhook_events(id,raw,status,lease_token,lease_until) values($1,$2,'processing',$3,now()+interval '1 minute')`,[row.id,row,lease]);
  mockProvider([row],'completed');expect((await reconcileBatch(batch)).state).toBe('scheduled');
  expect((await query('select lease_token from bolna_webhook_events')).rows[0].lease_token).toBe(lease);
  expect((await saved()).reconciliation_offset).toBe(0);expect(await reservations()).toBe(1);
  await query("update bolna_webhook_events set lease_until=now()-interval '1 second'");
  expect((await reconcileBatch(batch)).state).toBe('completed');
});
it('fences concurrent pollers and lets an expired batch lease resume',async()=>{
  await query("update call_batches set reconciliation_token=gen_random_uuid(),reconciliation_lease_until=now()+interval '1 minute' where id=$1",[batch]);
  await expect(reconcileBatch(batch)).rejects.toMatchObject({status:409});expect(fetch).not.toHaveBeenCalled();
  await query("update call_batches set reconciliation_lease_until=now()-interval '1 second' where id=$1",[batch]);
  mockProvider([execution()]);await reconcileBatch(batch);expect((await saved()).reconciliation_token).toBeNull();
  expect(await syncVisibleBatches([batch])).toEqual({checked:0,completed:0,failed:0});
  expect(await reconcileBatches()).toEqual({checked:0,succeeded:0});
});
it('protects the scheduled endpoint and runs provider GETs under the worker credential',async()=>{
  expect((await worker(new NextRequest('http://localhost/api/batches/reconcile',{method:'POST'}))).status).toBe(401);
  expect(fetch).not.toHaveBeenCalled();mockProvider([execution()]);
  const response=await worker(new NextRequest('http://localhost/api/batches/reconcile',{method:'POST',headers:{authorization:'Bearer integration-worker-secret'}}));
  expect(await response.json()).toMatchObject({checked:1,succeeded:1});
});
it('does not skip every other cron tick because the preceding check finished after its tick',async()=>{
  await query("update call_batches set updated_at=date_bin(interval '5 minutes',now(),timestamptz '2000-01-01')-interval '1 second' where id=$1",[batch]);
  mockProvider([execution()]);
  expect(await reconcileBatches()).toEqual({checked:1,succeeded:1});
  expect(await syncVisibleBatches([batch])).toEqual({checked:0,completed:0,failed:0});
  expect(await reconcileBatches()).toEqual({checked:0,succeeded:0});
});
it('throttles failed checks and skips future batches without releasing reservations',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}',{status:503})));
  expect(await reconcileBatches()).toEqual({checked:1,succeeded:0});expect((await saved()).last_error).toContain('503');
  expect(await reconcileBatches()).toEqual({checked:0,succeeded:0});expect(fetch).toHaveBeenCalledTimes(1);
  await query("update call_batches set updated_at=now()-interval '1 day',scheduled_at=now()+interval '1 hour' where id=$1",[batch]);
  expect(await reconcileBatches()).toEqual({checked:0,succeeded:0});expect(await reservations()).toBe(1);
});
