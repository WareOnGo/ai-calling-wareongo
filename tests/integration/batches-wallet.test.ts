import {seedLegacyAssignments,seedConnectedCalls} from './fixtures';
import {beforeAll,beforeEach,afterAll,afterEach,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {query,getPool} from '@/lib/db';
import {assignEntities} from '@/lib/assignments';
import {getBatch,listBatches,batchMembers,batchMembersExport,batchListExport,batchListSchema,AI_CARDS,MANUAL_CARDS} from '@/lib/batch-browser';
import {createWalletReader} from '@/lib/wallet';
const admin={email:'admin@test.example',isAdmin:true},employee={email:'employee@test.example',isAdmin:false};
let records:string[];
let getWallet=createWalletReader();
beforeAll(()=>{if(!process.env.TEST_DATABASE_URL||!['127.0.0.1','localhost','[::1]'].includes(new URL(process.env.TEST_DATABASE_URL).hostname))throw Error('Disposable DB required');});
beforeEach(async()=>{
 getWallet=createWalletReader();
 await query('truncate bolna_ai_attempts,bolna_assignment_batches,bolna_assignments,bolna_app_users,bolna_webhook_events,bolna_call_logs,raw_phones,raw_records,raw_phone_numbers,call_batches,bolna_dispatch_requests restart identity cascade');
 await query("insert into bolna_app_users(email,role) values ($1,'admin'),($2,'employee')",[admin.email,employee.email]);
 records=[];for(let i=0;i<4;i++){
  const id=randomUUID();records.push(id);await query("insert into raw_records(id,source,source_record_id,owner_name) values ($1::uuid,'batch',$1::text,$2)",[id,`Person ${i}`]);
  const p=(await query('insert into raw_phone_numbers(phone_last10,phone) values ($1,$2) returning phone_id',[`987654321${i}`,`+91987654321${i}`])).rows[0].phone_id;
  await query('insert into raw_phones(master_id,phone_id,is_primary) values ($1,$2,true)',[id,p]);
  await query("insert into bolna_call_logs(id,status,call_type,to_number,phone_id,call_created_at,llm_availability) values ($1,$2,'outbound',$3,$4,now(),$5)",[id,['completed','completed','balance-low','ringing'][i],`+91987654321${i}`,p,i===0?'Available':i===1?'Unavailable':null]);
 }
 vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('Unexpected provider request');}));
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.useRealTimers();vi.restoreAllMocks();});afterAll(async()=>{await getPool().end();});
const manual=async(entity:'record'|'call'='record')=>{const r=await assignEntities({entity,ids:records,assignee:employee.email,assignedBy:admin.email});return getBatch(admin,'manual',r.batchId);};
async function ai(){
 const id=randomUUID();await query("insert into call_batches(id,created_by,agent_id,agent_language,state,bolna_batch_id,callable) values ($1,$2,'agent-a','hindi','scheduled','provider-batch',4)",[id,admin.email]);
 for(let i=0;i<4;i++)await query('insert into call_batch_items(batch_id,record_id,name,contact_number) values ($1,$2,$3,$4)',[id,records[i],`Person ${i}`,`+91987654321${i}`]);
 await query("update bolna_call_logs set batch_id='provider-batch'");
 return getBatch(admin,'ai',id);
}
it('manual runs from both origins are discoverable, with explicit legacy membership',async()=>{
 const first=await manual();expect((await listBatches(admin,{kind:'manual',origin:'record',caller:employee.email,state:'open'})).rows[0].id).toBe(first.id);
 await query("update bolna_assignments set state='dropped'");await manual('call');
 expect((await listBatches(admin,{kind:'manual',origin:'call'})).total).toBe(1);
 expect((await listBatches(admin,{kind:'ai'})).total).toBe(0);
 await seedLegacyAssignments("insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state,outcome) values ('record',$1,$2,$3,'done','Unavailable')",[records[0],employee.email,admin.email]);
 const legacy=await getBatch(admin,'manual','legacy');expect((await batchMembers(admin,legacy)).total).toBe(1);
});
it('manual cards reconcile with row counts and exports; membership survives transfer of ownership',async()=>{
 const batch=await manual();
 await query("insert into bolna_manual_attempts(id,assignment_id,actor,assignee,occurred_at,disposition,request_hash) select $1,id,$2,assignee,now(),'connected','fixture' from bolna_assignments where entity_id=$3",[randomUUID(),employee.email,records[0]]);
 await query("update bolna_assignments set state='done',outcome='Available',added_to_db=true,wh_id='1007' where entity_id=$1",[records[0]]);
 await query("update bolna_assignments set disposition='busy',next_due_at=now()-interval '1 hour' where entity_id=$1",[records[1]]);
 await assignEntities({entity:'record',ids:[records[2]],assignee:admin.email,assignedBy:admin.email,reassign:true});
 const data=await batchMembers(admin,batch);expect(data.metrics).toMatchObject({all:4,assigned:4,open:2,done:1,dropped:1,retry_due:1,connected:1,available:1,onboarded:1,attempts:1});
 const moved=data.rows.find(r=>r.entity_id===records[2])!;expect(moved.assignee).toBe(employee.email);expect(moved.current_owner).toBe(admin.email);expect(moved.state).toBe('dropped');
 for(const [metric] of MANUAL_CARDS){const filtered=await batchMembers(admin,batch,metric),spec=batchMembersExport(admin,batch,metric);expect(filtered.total).toBe(data.metrics[metric]);expect((await query(spec.sql,spec.params)).rows).toHaveLength(filtered.total);}
});

it('AI metrics count unique targets separately from attempts and expose balance failures',async()=>{
 const batch=await ai();await query("insert into call_batch_items(batch_id,record_id,name,contact_number) values ($1,$2,'Duplicate format','9876543210')",[batch.id,records[0]]);
 for(let i=0;i<2;i++)await query("select bolna_record_ai_evidence($1::jsonb,'retained')",[{id:records[0],status:'completed',batch_id:'provider-batch',conversation_duration:20,transcript:'user: yes',telephony_data:{provider_call_id:`p${i}`,to_number:'+919876543210',call_type:'outbound',duration:20}}]);
 const data=await batchMembers(admin,batch);expect(data.metrics).toMatchObject({all:4,attempted:1,attempts:2,connected:1,available:1,unavailable:1,blocked:1,failure:1,pending:1});
 for(const [metric] of AI_CARDS){const filtered=await batchMembers(admin,batch,metric),spec=batchMembersExport(admin,batch,metric);expect(filtered.total).toBe(data.metrics[metric]);expect((await query(spec.sql,spec.params)).rows).toHaveLength(filtered.total);}
});
it('batch current owners follow shared contacts across channels and retain ownerless-phone legacy work',async()=>{
 const batch=await manual();
 await assignEntities({entity:'call',ids:[records[0]],assignee:admin.email,assignedBy:admin.email,reassign:true});
 await query('delete from raw_phones where master_id=$1',[records[1]]);
 const rows=(await batchMembers(admin,batch)).rows;
 expect(rows.find(r=>r.entity_id===records[0])).toMatchObject({assignee:employee.email,current_owner:admin.email,state:'dropped'});
 expect(rows.find(r=>r.entity_id===records[1])).toMatchObject({current_owner:employee.email,state:'open'});
});
it('list filters preserve parent dispatch grouping, IST range, state and agent; exports cover all pages',async()=>{
 const batch=await ai(),dispatch=randomUUID();await query("insert into bolna_dispatch_requests(id,created_by,request_hash,routing_mode,scheduled_at,total,callable,excluded_by_cat,held_region,already_queued,skipped_no_number) values ($1,$2,'fixture','auto',now(),4,4,0,0,0,0)",[dispatch,admin.email]);
 await query("update call_batches set dispatch_request_id=$1,created_at='2026-10-09T18:30:00Z' where id=$2",[dispatch,batch.id]);
 const f=batchListSchema.parse({kind:'ai',dispatch,agent:'agent-a',date_from:'2026-10-10',date_to:'2026-10-10',state:'scheduled'});expect((await listBatches(admin,f)).total).toBe(1);
 expect((await listBatches(admin,{...f,date_to:'2026-10-09'})).total).toBe(0);
 const spec=batchListExport(admin,f);expect((await query(spec.sql,spec.params)).rows).toHaveLength(1);
 expect(()=>batchListSchema.parse({date_from:'2026-10-11',date_to:'2026-10-09'})).toThrow();
});
it('paginates beyond the previous latest-20 limit and rejects unauthorized batch reads and exports',async()=>{
 for(let i=0;i<27;i++)await query("insert into call_batches(created_by,state) values ($1,'completed')",[admin.email]);
 const page=await listBatches(admin,{kind:'ai'},2);expect(page.total).toBe(27);expect(page.rows).toHaveLength(2);
 await expect(listBatches(employee,{kind:'ai'})).rejects.toMatchObject({status:403});
 const batch=await manual();expect(()=>batchMembersExport(employee,batch)).toThrow('forbidden');await expect(getBatch(employee,'manual',batch.id)).rejects.toMatchObject({status:403});
 await expect(batchMembers(admin,batch,"all;drop table raw_records")).rejects.toMatchObject({status:400});
});
it.each([0,42.42,-5])('wallet returns numeric %s without exposing identity or credentials',async(wallet)=>{
 const fetch=vi.fn(async()=>new Response(JSON.stringify({wallet,email:'private@example.com',name:'Secret',api_key:'NEVER-EXPOSE'})));vi.stubGlobal('fetch',fetch);
 const value=await getWallet(admin);expect(value.balance).toBe(wallet);expect(value.state).toBe('fresh');expect(value.low).toBe(wallet<=0);expect(JSON.stringify(value)).not.toMatch(/private|Secret|NEVER|Bearer/);expect(value.unit).toBe('provider units');
});
it('serializes concurrent wallet refreshes, caches successes and honors the manual-refresh cooldown',async()=>{
 const fetch=vi.fn(async()=>new Response('{"wallet":7}'));vi.stubGlobal('fetch',fetch);
 const values=await Promise.all(Array.from({length:10},()=>getWallet(admin,true)));expect(values.every(v=>v.balance===7)).toBe(true);expect(fetch).toHaveBeenCalledTimes(1);
 const clock=vi.spyOn(Date,'now').mockReturnValue(Date.now()+15000);await getWallet(admin);expect(fetch).toHaveBeenCalledTimes(1);await getWallet(admin,true);expect(fetch).toHaveBeenCalledTimes(2);clock.mockRestore();
});
it('provider failures preserve stale success and never turn an unavailable balance into zero',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('{"wallet":25}')));await getWallet(admin);
 vi.spyOn(Date,'now').mockReturnValue(Date.now()+120000);
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('sensitive error text',{status:401})));
 const stale=await getWallet(admin);expect(stale).toMatchObject({balance:25,state:'stale',message:'Provider authentication failed.'});
 getWallet=createWalletReader();expect(await getWallet(admin)).toMatchObject({balance:null,state:'unavailable',low:false});
});
it.each(['{}','{"wallet":"42"}','{"wallet":null}'])('rejects malformed wallet response %s',async(body)=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(body)));expect(await getWallet(admin)).toMatchObject({balance:null,state:'unavailable'});
});
it('wallet timeout is bounded and unauthorized users never contact the provider',async()=>{
 const fetch=vi.fn((_url:unknown,init:RequestInit)=>new Promise<Response>((_,reject)=>{init.signal!.addEventListener('abort',()=>reject(new Error('timeout')));}));vi.stubGlobal('fetch',fetch);
 await expect(getWallet(employee)).rejects.toMatchObject({status:403});expect(fetch).not.toHaveBeenCalled();
 const start=Date.now();expect(await getWallet(admin)).toMatchObject({balance:null,state:'unavailable',message:'Balance request timed out or failed.'});expect(Date.now()-start).toBeLessThan(6000);
});

it('batch list search, language and repeated statuses share the export predicate',async()=>{
 const batch=await ai(),f=batchListSchema.parse({kind:'ai',q:batch.id.slice(0,8),language:'hindi',state:['scheduled','completed']});
 expect((await listBatches(admin,f)).total).toBe(1);
 const spec=batchListExport(admin,f);expect((await query(spec.sql,spec.params)).rows[0].id).toBe(batch.id);
 expect((await listBatches(admin,{...f,language:'english'})).total).toBe(0);
});

it('member filters narrow rows and exports without changing whole-batch progress',async()=>{
 const batch=await ai(),filters={q:'Person 0',outcome:['Available','Unavailable'],has_attempts:'no' as const};
 const data=await batchMembers(admin,batch,'all',999,filters);
 expect(data).toMatchObject({total:1,page:1,metrics:{all:4}});expect(data.rows[0].name).toBe('Person 0');
 const spec=batchMembersExport(admin,batch,'all',filters);expect((await query(spec.sql,spec.params)).rows).toHaveLength(1);
 expect(Number((await query(spec.countSql,spec.countParams)).rows[0].n)).toBe(1);
 expect((await batchMembers(admin,batch,'unavailable',1,filters)).total).toBe(0);
 expect(data.options.states).toContain('completed');
});

it('manual batch filters distinguish original caller from current owner',async()=>{
 const batch=await manual();
 await assignEntities({entity:'record',ids:[records[0]],assignee:admin.email,assignedBy:admin.email,reassign:true});
 const filters={assignee:employee.email,current_owner:admin.email,state:'dropped'};
 const data=await batchMembers(admin,batch,'all',1,filters);
 expect(data.total).toBe(1);expect(data.rows[0]).toMatchObject({entity_id:records[0],assignee:employee.email,current_owner:admin.email});
 const spec=batchMembersExport(admin,batch,'all',filters);expect((await query(spec.sql,spec.params)).rows).toHaveLength(1);
});
