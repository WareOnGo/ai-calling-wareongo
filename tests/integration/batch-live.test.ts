import {beforeEach,afterEach,afterAll,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {NextRequest} from 'next/server';
import {query,getPool} from '@/lib/db';
import {syncVisibleBatches,reconcileBatch} from '@/lib/batch-reconciliation';
import {batchProgress,getBatch} from '@/lib/batch-browser';
import {POST} from '@/app/api/batches/sync/route';
const auth=vi.hoisted(()=>({admin:true}));
vi.mock('@/lib/auth',()=>({getCurrentAdmin:async()=>auth.admin?{email:'admin@live.test',isAdmin:true}:null}));
const viewer={email:'admin@live.test',name:null,isAdmin:true};
beforeEach(async()=>{
 expect(new URL(process.env.TEST_DATABASE_URL!).hostname).toBe('127.0.0.1');
 await query('truncate bolna_ai_attempts,bolna_assignments,bolna_assignment_batches,bolna_app_users,bolna_call_logs,raw_phones,raw_records,raw_phone_numbers,call_batches,bolna_dispatch_requests restart identity cascade');
 auth.admin=true;vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('Unexpected provider request');}));
});
afterEach(()=>vi.unstubAllGlobals());afterAll(()=>getPool().end());
async function batch(phones=['9876543210']){
 const id=randomUUID(),provider='live-'+id;
 await query("insert into call_batches(id,state,bolna_batch_id,updated_at,scheduled_at) values($1,'scheduled',$2,now()-interval '5 minutes',now()-interval '1 hour')",[id,provider]);
 for(const phone of phones)await query('insert into call_batch_items(batch_id,record_id,name,contact_number) values($1,$2,$3,$4)',[id,randomUUID(),'Test contact',phone]);
 await query("insert into bolna_dispatch_reservations(phone_last10,batch_id) values($1,$2)",[phones[0],id]);
 return {id,provider};
}
const request=(ids:unknown)=>POST(new NextRequest('http://localhost/api/batches/sync',{method:'POST',body:JSON.stringify({ids})}));

it('automatically completes only after all target results and retries are confirmed',async()=>{
 const b=await batch(['9876543210','9876543211']);
 const execution=(phone:string,status:string,retry_count?:number)=>({id:randomUUID(),batch_id:b.provider,status,retry_count,telephony_data:{to_number:'+91'+phone,call_type:'outbound',provider_call_id:randomUUID()}});
 let executions=[execution('9876543210','completed')];
 const fetcher=vi.fn(async(url:string)=>new Response(JSON.stringify(url.endsWith('/executions')?executions:{batch_id:b.provider,status:'executed',valid_contacts:2})));
 vi.stubGlobal('fetch',fetcher);
 expect((await syncVisibleBatches([b.id])).completed).toBe(0);
 executions.push(execution('9876543211','no-answer',1));
 await query("update call_batches set updated_at=now()-interval '2 minutes' where id=$1",[b.id]);
 expect((await syncVisibleBatches([b.id])).completed).toBe(0);
 expect((await query('select count(*)::int n from bolna_dispatch_reservations')).rows[0].n).toBe(1);
 executions.push(execution('9876543211','no-answer',3));
 await query("update call_batches set updated_at=now()-interval '2 minutes' where id=$1",[b.id]);
 expect(await syncVisibleBatches([b.id])).toEqual({checked:1,completed:1,failed:0});
 expect((await query('select state,completed_at from call_batches where id=$1',[b.id])).rows[0]).toMatchObject({state:'completed',completed_at:expect.any(Date)});
 expect((await query('select count(*)::int n from bolna_dispatch_reservations')).rows[0].n).toBe(0);
 expect((await syncVisibleBatches([b.id])).checked).toBe(0);
 expect(fetcher.mock.calls.every(([url])=>String(url).includes('/batches/'))).toBe(true);
});
it('throttles recent and future batches and bounds a page sync to three provider checks',async()=>{
 const rows=await Promise.all([0,1,2,3,4].map(i=>batch(['98765432'+String(i).padStart(2,'0')])));
 await query('update call_batches set updated_at=now() where id=$1',[rows[0].id]);
 await query("update call_batches set scheduled_at=now()+interval '1 day' where id=$1",[rows[1].id]);
 const fetcher=vi.fn(async()=>new Response('{}',{status:503}));vi.stubGlobal('fetch',fetcher);
 expect(await syncVisibleBatches(rows.map(b=>b.id))).toEqual({checked:3,completed:0,failed:3});
 expect(fetcher).toHaveBeenCalledTimes(3);
 expect((await syncVisibleBatches(rows.map(b=>b.id))).checked).toBe(0);
 expect((await query('select count(*)::int n from bolna_dispatch_reservations')).rows[0].n).toBe(5);
});
it('batch cards count unique target contacts separately from repeated provider attempts',async()=>{
 const b=await batch(['9876543210','+919876543210']);
 const id=randomUUID();
 await query("insert into bolna_call_logs(id,batch_id,status,call_type,to_number) values($1,$2,'completed','outbound','+919876543210')",[id,b.provider]);
 for(let i=0;i<2;i++)await query("select bolna_record_ai_evidence($1::jsonb,'webhook')",[{id,status:'completed',batch_id:b.provider,telephony_data:{to_number:'+919876543210',call_type:'outbound',provider_call_id:'attempt-'+i}}]);
 const row=await getBatch(viewer,'ai',b.id),progress=(await batchProgress([row]))[b.id];
 expect(progress).toMatchObject({targeted:1,finished:1,attempts:2});
 expect(row.state).toBe('scheduled');
});
it('requires admin access and validates the requested batch scope',async()=>{
 auth.admin=false;expect((await request([randomUUID()])).status).toBe(403);
 auth.admin=true;expect((await request(['invalid'])).status).toBe(400);
 expect((await request(Array.from({length:26},()=>randomUUID()))).status).toBe(400);
 const response=await request([randomUUID()]);expect(response.status).toBe(200);expect(await response.json()).toEqual({checked:0,completed:0,failed:0});
 expect(fetch).not.toHaveBeenCalled();
});

it('recognizes current provider completion, including batches with retries disabled',async()=>{
 const b=await batch(['9876543210','9876543211']);
 const executions=['9876543210','9876543211'].map((phone,index)=>({id:randomUUID(),batch_id:b.provider,status:index?'busy':'completed',retry_count:0,retry_config:null,batch_run_details:{status:'completed',retried:0},telephony_data:{to_number:'+91'+phone,call_type:'outbound',provider_call_id:randomUUID()}}));
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>Response.json(url.endsWith('/executions')?executions:{batch_id:b.provider,status:'completed',valid_contacts:2})));
 expect(await syncVisibleBatches([b.id])).toEqual({checked:1,completed:1,failed:0});
 expect((await query('select count(*)::int n from bolna_dispatch_reservations')).rows[0].n).toBe(0);
 expect((await query('select count(*)::int n from bolna_ai_attempts')).rows[0].n).toBe(2);
});

it('keeps reservations for incomplete or contradictory completed snapshots',async()=>{
 const b=await batch(['9876543210','9876543211']);
 let count=2;
 let executions:any[]=[{id:randomUUID(),batch_id:b.provider,status:'completed',telephony_data:{to_number:'+919876543210',provider_call_id:'safe-result'}}];
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>Response.json(url.endsWith('/executions')?executions:{batch_id:b.provider,status:'completed',valid_contacts:count})));
 expect((await reconcileBatch(b.id)).state).toBe('scheduled');
 const last={id:randomUUID(),batch_id:b.provider,status:'queued',telephony_data:{to_number:'+919876543211',provider_call_id:'second-result'}};
 for(const status of ['queued','call-disconnected','unknown']){
  executions=[executions[0],{...last,status}];expect((await reconcileBatch(b.id)).state).toBe('scheduled');
 }
 executions=[executions[0],{...last,status:'busy',batch_run_details:{status:'scheduled'}}];
 expect((await reconcileBatch(b.id)).state).toBe('scheduled');
 executions=[executions[0],{...last,status:'completed',batch_id:'wrong-batch'}];
 await expect(reconcileBatch(b.id)).rejects.toMatchObject({status:502});
 executions=[executions[0],{...last,status:'completed'}];count=3;
 expect((await reconcileBatch(b.id)).state).toBe('scheduled');
 expect((await query('select count(*)::int n from bolna_dispatch_reservations')).rows[0].n).toBe(1);
 count=2;expect((await reconcileBatch(b.id)).state).toBe('completed');
});

it('releases a provider-stopped batch only after its target executions are finished',async()=>{
 const b=await batch();
 let status='ringing';
 const execution={id:randomUUID(),batch_id:b.provider,batch_run_details:{status:'stopped',retried:0},telephony_data:{to_number:'+919876543210',provider_call_id:'stopped-dial'}};
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>Response.json(url.endsWith('/executions')?[{...execution,status}]:{batch_id:b.provider,status:'stopped',valid_contacts:1})));
 expect((await reconcileBatch(b.id)).state).toBe('uncertain');
 expect((await query('select count(*)::int n from bolna_dispatch_reservations')).rows[0].n).toBe(1);
 status='stopped';
 expect(await reconcileBatch(b.id)).toMatchObject({state:'canceled',resolution_note:'Stopped in Bolna; all target executions verified finished.'});
 expect((await query('select count(*)::int n from bolna_dispatch_reservations')).rows[0].n).toBe(0);
});
