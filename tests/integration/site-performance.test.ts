import { beforeAll, beforeEach, afterAll, afterEach, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import * as db from '@/lib/db';
import { ownershipFilter } from '@/lib/scope';
import { CONTACT_PHONES_SQL } from '@/lib/assignment-contacts';
import { personalWork } from '@/lib/employee-work';
import { listAssignments, assignEntities } from '@/lib/assignments';
import { getRawRecordsByIds } from '@/lib/raw';
import { getCallDetailsByIds } from '@/lib/calls';
import { area, rent } from '@/lib/employee-display';
import { seedLegacyAssignments } from './fixtures';
import { GET as details } from '@/app/api/details/[entity]/[id]/route';
import { GET as aiDetails } from '@/app/api/details/[entity]/[id]/ai/route';
import { POST as preview } from '@/app/api/assignments/preview/route';
import { POST as sync } from '@/app/api/batches/sync/route';
import { GET as versionEndpoint } from '@/app/api/batches/version/route';
import { batchCatalogVersion, batchDetailVersion } from '@/lib/batch-version';
import { batchMembers, batchMembersExport, batchProgress, getBatch, listBatches } from '@/lib/batch-browser';
import { listUsers } from '@/lib/users';
import { aiHistory, aiTranscript } from '@/lib/ai-attempts';

const admin={email:'admin@performance.test',name:null,isAdmin:true};
const employee={email:'employee@performance.test',name:null,isAdmin:false};
const other={email:'other@performance.test',name:null,isAdmin:false};
const state=vi.hoisted(()=>({user:null as {email:string;name:null;isAdmin:boolean}|null,after:[] as (()=>Promise<void>)[]}));
vi.mock('@/lib/auth',()=>({getCurrentUser:async()=>state.user,getCurrentAdmin:async()=>state.user?.isAdmin?state.user:null}));
vi.mock('next/server',async original=>({...await original<typeof import('next/server')>(),after:(callback:()=>Promise<void>)=>state.after.push(callback)}));
const {query,getPool}=db;
let record:string,alias:string,unowned:string,call:string,secondCall:string;
beforeAll(()=>{if(!process.env.TEST_DATABASE_URL||!['localhost','127.0.0.1','[::1]'].includes(new URL(process.env.TEST_DATABASE_URL).hostname))throw Error('Disposable database required');});
beforeEach(async()=>{
  await query('truncate bolna_warehouse_imports,bolna_assignments,bolna_assignment_batches,bolna_app_users,bolna_call_logs,raw_records,raw_phones,raw_phone_numbers,call_batches restart identity cascade');
  await query("insert into bolna_app_users(email,role) values ($1,'admin'),($2,'employee'),($3,'employee')",[admin.email,employee.email,other.email]);
  [record,alias,unowned,call,secondCall]=Array.from({length:5},()=>randomUUID());
  await query(`insert into raw_records(id,source,source_record_id,owner_name,city,area_sqft,metadata,ingested_at)
    values ($1,'performance','one','Asha','Pune',9000,'{"rent":"42000"}',now()),
     ($2,'performance','alias','Zoya','Mumbai',4000,'{}',now()-interval '1 day'),
     ($3,'performance','unowned',null,null,null,'{}',now())`,[record,alias,unowned]);
  const phone=(await query("insert into raw_phone_numbers(phone_last10,phone) values ('9811550001','+919811550001') returning phone_id")).rows[0].phone_id;
  await query('insert into raw_phones(master_id,phone_id,is_primary) values($1,$3,true),($2,$3,true)',[record,alias,phone]);
  await query(`insert into bolna_call_logs(id,phone_id,to_number,status,call_type,call_created_at,context_details,carpet_area_sqft,expected_rent,llm_availability,transcript)
    values ($1,$3,'+919811550001','completed','outbound',now(),'{"recipient_data":{"area":"bengaluru"}}',2500,'45000','Available',repeat('Large transcript ',1000)),
     ($2,$3,null,'balance-low','outbound',now()-interval '1 day','{}',null,null,null,null)`,[call,secondCall,phone]);
  state.user=admin;state.after=[];
});
afterEach(()=>vi.restoreAllMocks());
afterAll(()=>getPool().end());

it('preserves negative ownership semantics for shared numbers, retained phone IDs, direct assignments and dropped history',async()=>{
  await seedLegacyAssignments(`insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state)
    values ('call',$1,$4,$4,'done'),('record',$2,$4,$4,'dropped'),('record',$3,$4,$4,'open')`,[secondCall,unowned,record,employee.email]);
  for(const entity of ['record','call'] as const)for(const mode of ['unassigned','never','none'] as const){
    const states=mode==='never'?'true':"a.state in ('open','done')";
    const owned=`select a.entity_id from bolna_assignments a where ${states} and a.entity_type='${entity}'
      union select target.entity_id from bolna_assignments a join (${CONTACT_PHONES_SQL}) owned using(entity_type,entity_id)
      join (${CONTACT_PHONES_SQL}) target using(phone_last10) where ${states} and target.entity_type='${entity}'`;
    const table=entity==='record'?'raw_records':'bolna_call_logs';
    const expected=(await query(`select r.id from ${table} r where not (r.id in (${owned})) order by r.id`)).rows;
    const params:unknown[]=[],where=ownershipFilter(entity,'r.id',mode==='none'?{assignee:['none']}:{assignment_state:mode},params).join(' and ');
    expect((await query(`select r.id from ${table} r where ${where} order by r.id`,params)).rows).toEqual(expected);
  }
});

it('mixed Unassigned/caller filters preserve OR semantics without a correlated ownership subplan',async()=>{
  await seedLegacyAssignments(`insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state)
    values ('call',$1,$3,$3,'done'),('record',$2,$4,$4,'open')`,[call,unowned,employee.email,other.email]);
  for(const entity of ['record','call'] as const)for(const assignment_state of [undefined,'done','open','unassigned']) {
    const table=entity==='record'?'raw_records':'bolna_call_logs';
    const read=async(assignee:string[])=>{
      const params:unknown[]=[],where=ownershipFilter(entity,'r.id',{assignee,assignment_state},params).join(' and ');
      return (await query(`select r.id from ${table} r where ${where} order by r.id`,params)).rows.map(row=>row.id);
    };
    const expected=[...new Set([...await read(['none']),...await read([employee.email])])].sort();
    expect(await read(['none',employee.email])).toEqual(expected);
  }
});

it('returns identical employee list fields with two reads, including blocked calls and legacy execution counts',async()=>{
  await seedLegacyAssignments(`insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,state,outcome,remarks)
    values ('record',$1,$4,$5,'done','Available','Retained notes'),('call',$2,$4,$5,'done','Unclear',null),('call',$3,$4,$5,'done',null,null),('call',$6,$4,$5,'done',null,null)`,[record,call,secondCall,employee.email,admin.email,randomUUID()]);
  for(const entity of ['record','call'] as const){
    const assignments=await listAssignments(employee,{entity_type:entity,assignee:employee.email,activeOnly:true,pageSize:25});
    const ids=assignments.rows.map(row=>row.entity_id);
    const records=entity==='record'?await getRawRecordsByIds(employee,ids):[];
    const calls=entity==='call'?await getCallDetailsByIds(employee,ids):[];
    const expected=assignments.rows.map(a=>{
      const r=records.find(row=>row.id===a.entity_id),c=calls.find(row=>row.id===a.entity_id);
      return {revision:a.revision,id:a.id,entityId:a.entity_id,entity,who:a.subject||c?.raw_owner_name||'Unnamed owner',phone:a.phone,
        context:{city:r?.city||c?.db_area||c?.raw_city||a.city,area:c?.carpet_area_sqft?`${area(c.carpet_area_sqft)} carpet`:c?.built_up_area_sqft?`${area(c.built_up_area_sqft)} built-up`:area(r?.area_sqft||c?.raw_area_sqft||null),rent:rent(r?.rent||c?.expected_rent||null)},
        ai:r?.last_availability||c?.availability||null,aiCount:Number(r?.call_count||(c?1:0)),brief:a.note,
        assignedBy:a.assigned_by,assignedByName:a.assigned_by_name,assignedAt:a.assigned_at,state:a.state,outcome:a.outcome,remarks:a.remarks,addedToDb:a.added_to_db,whId:a.wh_id,warehouseIds:a.warehouse_ids};
    });
    const reads=vi.spyOn(db,'query');
    expect((await personalWork(employee,entity,{},1)).rows).toEqual(expected);
    expect(reads).toHaveBeenCalledTimes(2);reads.mockRestore();
    expect((await personalWork(other,entity,{},1)).rows).toEqual([]);
    expect((await personalWork(employee,entity,{view:'done',q:'absent'},999)).rows).toEqual([]);
  }
});

it('classic details keeps verification history and scope without reading unused sections',async()=>{
  await assignEntities({entity:'record',ids:[record],assignee:employee.email,assignedBy:admin.email});
  state.user=employee;
  const reads=vi.spyOn(db,'query');
  const response=await details(new Request(`http://localhost/api/details/record/${record}?section=classic`),{params:Promise.resolve({entity:'record',id:record})});
  expect(response.status).toBe(200);const data=await response.json();
  expect(data.row.id).toBe(record);expect(data.historyTotal).toBe(1);expect(data.history).toHaveLength(1);
  expect(data).not.toHaveProperty('manual');expect(data).not.toHaveProperty('relatedListings');expect(reads).toHaveBeenCalledTimes(3);
  state.user=other;
  expect((await details(new Request('http://localhost/?section=classic'),{params:Promise.resolve({entity:'record',id:record})})).status).toBe(404);
});

it('batch rows, totals, empty pages and exports agree after sharing the member calculation',async()=>{
  const result=await assignEntities({entity:'record',ids:[record,alias,unowned],assignee:employee.email,assignedBy:admin.email});
  const batch=await getBatch(admin,'manual',result.batchId);
  for(const filters of [{},{q:'Asha'},{q:'missing'},{state:['unallocated']}]){
    const exported=batchMembersExport(admin,batch,'all',filters),expected=(await query(exported.sql,exported.params)).rows;
    const reads=vi.spyOn(db,'query'),data=await batchMembers(admin,batch,'all',999,filters);
    expect(reads).toHaveBeenCalledTimes(1);reads.mockRestore();
    expect(data.rows).toEqual(expected);expect(data.total).toBe(expected.length);expect(data.page).toBe(1);expect(data.metrics.all).toBe(3);
  }
  const list=await listBatches(admin,{kind:'manual'},999);
  expect(list.total).toBe(1);expect(list.rows[0].id).toBe(result.batchId);expect(list.page).toBe(1);
  await expect(batchMembers(employee,batch)).rejects.toMatchObject({status:403});
});

it('preview pagination retains the entire selection and its allocation guard',async()=>{
  const ids=(await query(`insert into raw_records(id,source,source_record_id,owner_name)
    select gen_random_uuid(),'preview-pages',n::text,'Owner '||n from generate_series(1,61) n returning id`)).rows.map(row=>row.id);
  for(const [i,id] of ids.entries()){
    const phone=(await query('insert into raw_phone_numbers(phone_last10,phone) values($1,$1) returning phone_id',[String(9822000000+i)])).rows[0].phone_id;
    await query('insert into raw_phones(master_id,phone_id,is_primary) values($1,$2,true)',[id,phone]);
  }
  const body={entity_type:'record',ids,assignee:employee.email};
  const read=(page=1)=>preview(new NextRequest(`http://localhost/api/assignments/preview?page=${page}`,{method:'POST',body:JSON.stringify(body)}));
  const first=await(await read()).json(),second=await(await read(2)).json();
  const legacy=await(await preview(new NextRequest('http://localhost/api/assignments/preview',{method:'POST',body:JSON.stringify(body)}))).json();
  expect(legacy.items).toHaveLength(61);expect(legacy.previewHash).toBe(first.previewHash);
  expect(first).toMatchObject({page:1,pages:2,itemTotal:61,requested:61,eligible:61});expect(first.items).toHaveLength(50);expect(second.items).toHaveLength(11);
  expect(second.previewHash).toBe(first.previewHash);expect(new Set([...first.items,...second.items].map(row=>row.id)).size).toBe(61);
  expect((await read(0)).status).toBe(400);
  await assignEntities({entity:'record',ids:[ids[0]],assignee:other.email,assignedBy:admin.email});
  await expect(assignEntities({entity:'record',ids,assignee:employee.email,assignedBy:admin.email,expectedPreview:first.previewHash})).rejects.toMatchObject({status:409});
  const fresh=await(await read()).json();
  expect((await assignEntities({entity:'record',ids,assignee:employee.email,assignedBy:admin.email,expectedPreview:fresh.previewHash})).assigned).toBe(60);
});

it('lazy transcripts preserve the exact dial and employee visibility while primary selection stays unchanged',async()=>{
  const capture=(execution:string,provider:string,text:string)=>query("select bolna_record_ai_evidence($1::jsonb,'retained')",[{
    id:execution,status:'completed',created_at:'2026-10-10T03:00:00Z',initiated_at:'2026-10-10T03:00:00Z',updated_at:'2026-10-10T03:02:00Z',
    transcript:text,telephony_data:{provider_call_id:provider,to_number:'+919811550001',call_type:'outbound',duration:30},conversation_duration:30}]);
  await capture(call,'first','user: Earlier dial transcript');await capture(call,'second','user: Later dial transcript');
  await capture(secondCall,'other','user: Other execution');
  await assignEntities({entity:'call',ids:[call],assignee:employee.email,assignedBy:admin.email});
  const history=await aiHistory(admin,'record',record,{primaryPhone:true,lazyTranscripts:true});
  expect(history.phone).toBe('9811550001');expect(history.total).toBe(3);
  expect(history.rows.every(row=>row.transcript===null&&row.has_transcript)).toBe(true);
  expect(JSON.stringify(history)).not.toContain('Earlier dial transcript');
  expect(await aiTranscript(employee,'call',call,call,'first',{scope:'contact'})).toBe('user: Earlier dial transcript');
  expect(await aiTranscript(employee,'call',call,call,'second')).toBe('user: Later dial transcript');
  await expect(aiTranscript(employee,'call',call,secondCall,'other',{scope:'contact'})).rejects.toMatchObject({status:404});
  await expect(aiTranscript(other,'call',call,call,'first')).rejects.toMatchObject({status:404});
  await expect(aiTranscript(admin,'record',unowned,call,'first')).rejects.toMatchObject({status:404});
  await expect(aiTranscript(admin,'record',record,call,'first',{batch:'missing'})).rejects.toMatchObject({status:404});
  const read=(params:Record<string,string>={})=>aiDetails(new NextRequest(`http://localhost/api/details/call/${call}/ai?${new URLSearchParams({transcript:'1',execution:call,provider_call:'first',...params})}`),{params:Promise.resolve({entity:'call',id:call})});
  state.user=employee;
  const response=await read();expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({transcript:'user: Earlier dial transcript'});
  expect((await read({execution:'invalid'})).status).toBe(400);
  expect((await read({provider_call:'missing'})).status).toBe(404);
  expect((await read({scope:'contact',execution:secondCall,provider_call:'other',employee:admin.email})).status).toBe(404);
  state.user=admin;expect((await read({employee:other.email})).status).toBe(404);
  state.user=null;expect((await read()).status).toBe(401);
  state.user=employee;await query("update bolna_assignments set state='dropped' where entity_id=$1",[call]);
  expect((await read()).status).toBe(404);
});

it('rendered batch tokens cost no extra reads and detect edits without acknowledging unseen data',async()=>{
  const allocated=await assignEntities({entity:'record',ids:[record],assignee:employee.email,assignedBy:admin.email});
  const batch=await getBatch(admin,'manual',allocated.batchId),data=await batchMembers(admin,batch);
  const reads=vi.spyOn(db,'query');
  const first=batchDetailVersion(batch,data);expect(batchDetailVersion(batch,data)).toBe(first);expect(reads).not.toHaveBeenCalled();reads.mockRestore();
  const poll=async()=>{const res=await versionEndpoint(new NextRequest(`http://localhost/?kind=manual&id=${allocated.batchId}`));expect(res.status).toBe(200);expect(res.headers.get('cache-control')).toBe('no-store');return (await res.json()).version;};
  expect(await poll()).toBe(first);
  await query('update raw_records set owner_name=owner_name where id=$1',[record]);expect(await poll()).toBe(first);
  await query('update raw_records set owner_name=$2 where id=$1',[unowned,'Unrelated edit']);expect(await poll()).toBe(first);
  await query('update raw_records set owner_name=$2 where id=$1',[record,'Changed owner']);
  // An edit committed after the page read cannot affect its rendered token.
  expect(batchDetailVersion(batch,data)).toBe(first);
  const edited=await poll();expect(edited).not.toBe(first);
  await query('delete from raw_phones where master_id=$1',[record]);expect(await poll()).not.toBe(edited);
  state.user=employee;expect((await versionEndpoint(new NextRequest('http://localhost/?kind=manual'))).status).toBe(403);
  state.user=admin;expect((await versionEndpoint(new NextRequest('http://localhost/?kind=invalid'))).status).toBe(400);
});

it('batch polling honors catalog and member filters, repeated values, metrics and page bounds',async()=>{
  const allocated=await assignEntities({entity:'record',ids:[record,alias,unowned],assignee:employee.email,assignedBy:admin.email});
  const batch=await getBatch(admin,'manual',allocated.batchId);
  for(const metric of ['all','open'])for(const filters of [{},{q:'absent'},{state:['open','unallocated']}]) {
    const data=await batchMembers(admin,batch,metric,999,filters);
    const params=new URLSearchParams({kind:'manual',id:batch.id,metric,page:'999'});
    for(const [key,value] of Object.entries(filters))for(const item of Array.isArray(value)?value:[value])params.append(key,item);
    const result=await versionEndpoint(new NextRequest('http://localhost/?'+params));
    expect(result.status).toBe(200);expect((await result.json()).version).toBe(batchDetailVersion(batch,data));
  }
  const filters={kind:'manual' as const,state:['open','closed'],q:'absent'};
  const data=await listBatches(admin,filters,999),people=await listUsers(),progress=await batchProgress(data.rows);
  const result=await versionEndpoint(new NextRequest('http://localhost/?kind=manual&state=open&state=closed&q=absent&page=999'));
  expect((await result.json()).version).toBe(batchCatalogVersion(data,progress,people));
  const legacy=await getBatch(admin,'manual','legacy');
  const legacyResult=await versionEndpoint(new NextRequest('http://localhost/?kind=manual&id=legacy'));
  expect((await legacyResult.json()).version).toBe(batchDetailVersion(legacy,await batchMembers(admin,legacy)));
});

it('AI batch tokens follow member evidence, metadata and deletion',async()=>{
  const id=randomUUID();
  await query("insert into call_batches(id,state,bolna_batch_id) values($1,'scheduled','version-evidence')",[id]);
  await query("insert into call_batch_items(batch_id,record_id,name,contact_number) values($1,$2,'Asha','+919811550001')",[id,record]);
  await query("update bolna_call_logs set batch_id='version-evidence' where id=$1",[call]);
  const poll=async()=>{const res=await versionEndpoint(new NextRequest(`http://localhost/?kind=ai&id=${id}`));expect(res.status).toBe(200);return (await res.json()).version;};
  const batch=await getBatch(admin,'ai',id),data=await batchMembers(admin,batch),first=batchDetailVersion(batch,data);
  expect(await poll()).toBe(first);
  await query("update bolna_call_logs set llm_availability='Unavailable' where id=$1",[call]);
  const changed=await poll();expect(changed).not.toBe(first);
  await query("update call_batches set state='completed' where id=$1",[id]);
  const completed=await poll();expect(completed).not.toBe(changed);
  await query('delete from call_batches where id=$1',[id]);
  expect(await poll()).toBe(batchDetailVersion(null));expect(await poll()).not.toBe(completed);
});

it('manual refresh tokens change when a follow-up becomes due without a write',async()=>{
  const allocated=await assignEntities({entity:'record',ids:[record],assignee:employee.email,assignedBy:admin.email});
  const batch=await getBatch(admin,'manual',allocated.batchId);
  await query("update bolna_assignments set disposition='callback',next_due_at=now()+interval '500 milliseconds' where batch_id=$1",[batch.id]);
  const before=await batchMembers(admin,batch);expect(before.metrics.retry_due).toBe(0);
  await query('select pg_sleep(0.6)');
  const after=await batchMembers(admin,batch);expect(after.metrics.retry_due).toBe(1);
  expect(batchDetailVersion(batch,after)).not.toBe(batchDetailVersion(batch,before));
});

it('background synchronization responds before provider work and authenticates before scheduling',async()=>{
  const request=()=>sync(new NextRequest('http://localhost/api/batches/sync',{method:'POST',body:JSON.stringify({ids:[],background:true})}));
  state.user=employee;expect((await request()).status).toBe(403);expect(state.after).toHaveLength(0);
  state.user=admin;const response=await request();expect(response.status).toBe(202);expect(await response.json()).toEqual({queued:true});
  expect(state.after).toHaveLength(1);await state.after[0]();
});
