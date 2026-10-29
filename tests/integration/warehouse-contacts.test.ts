import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { getPool, query, transaction } from '@/lib/db';
import { assignEntities, previewAssignment } from '@/lib/assignment-allocation';
import { updateAssignment, listAssignments } from '@/lib/assignments';
import { bulkAssignments } from '@/lib/bulk-assignments';
import { getRawQueueRowsByIds, getRawRecords, getRawRecordIds, rawExportQuery } from '@/lib/raw';
import { getCalls, callsExportQuery } from '@/lib/calls';
import { getBatch, batchMembers, batchMembersExport } from '@/lib/batch-browser';
import { personalTotals, personalWork } from '@/lib/personal-work';
import { toRawFilters, toCallFilters } from '@/lib/filters';
import { assembleBatch } from '@/lib/dispatch-plan';
import { dispatchBatch } from '@/lib/dispatch-service';
import { backfillWarehouseContacts } from '../../database/warehouse-contact-backfill.mjs';
import { seedLegacyAssignments } from './fixtures';

const admin={email:'admin@test.example',isAdmin:true,name:null};
const caller={email:'caller@test.example',isAdmin:false,name:'Caller'};
beforeAll(()=>{if(!process.env.TEST_DATABASE_URL||!['127.0.0.1','localhost'].includes(new URL(process.env.TEST_DATABASE_URL).hostname))throw Error('Disposable local database required');});
beforeEach(async()=>{
  await query('truncate bolna_warehouse_imports,bolna_assignments,bolna_app_users,bolna_call_logs,raw_records,raw_phone_numbers,call_batches,bolna_dispatch_requests restart identity cascade');
  await query("insert into bolna_app_users(email,role) values($1,'admin'),($2,'employee')",[admin.email,caller.email]);
});
afterAll(async()=>{await query('truncate bolna_warehouse_imports cascade');await getPool().end();});
async function listing(phones=['9876543210']){
  const id=randomUUID();
  await query("insert into raw_records(id,source,source_record_id,owner_name,state) values($1::uuid,'warehouse-test',$1::text,'Owner','Delhi')",[id]);
  for(const [i,phone] of phones.entries()){
    const p=(await query('insert into raw_phone_numbers(phone_last10,phone) values($1,$2) on conflict(phone_last10) do update set phone=excluded.phone returning phone_id',[phone,`+91${phone}`])).rows[0];
    await query('insert into raw_phones(master_id,phone_id,is_primary) values($1,$2,$3)',[id,p.phone_id,i===0]);
  }
  return id;
}
const options=(ids:string[])=>({entity:'record' as const,ids,assignee:caller.email,assignedBy:admin.email});
const load=(warehouses=[{id:501,contactNumber:'+91 (98765) 43210',alt_phone_number:null as string|null}])=>transaction(client=>backfillWarehouseContacts(client,warehouses,'2026-10-29T00:00:00Z'));

it('matches the entire raw dataset, including unassigned duplicate listings and alternate phones',async()=>{
  const a=await listing(),b=await listing(['9000000000','9876543210']),fresh=await listing(['9888888888']);
  const summary=await load();expect(summary).toMatchObject({matched_raw_numbers:1,matched_raw_records:2,matched_assignments:0});
  const preview=await previewAssignment({...options([a,b,fresh]),reassign:true});
  expect(preview).toMatchObject({eligible:1,warehouseExists:2,warehouseNumbers:1});
  expect(preview.items.filter(i=>i.disposition==='warehouse_exists').map(i=>i.warehouseIds)).toEqual([[501],[501]]);
  const result=await assignEntities(options([a,b,fresh]));expect(result).toMatchObject({assigned:1,skippedWarehouse:2});
  expect((await query('select entity_id from bolna_assignments')).rows).toEqual([{entity_id:fresh}]);
  expect((await getRawRecords(admin,{})).rows.find(r=>r.id===b)?.warehouse_ids).toEqual([501]);
  expect((await getRawRecords(admin,{wh_id:'501',warehouse_match:'yes'})).rows.map(r=>r.id).sort()).toEqual([a,b].sort());
});

it('backfills single IDs and flags, preserves notes and status, and retains every ambiguous warehouse ID',async()=>{
  const a=await listing(),b=await listing(['9888888888']),c=await listing(['9777777777']);
  await assignEntities(options([a,b,c]));
  await seedLegacyAssignments("update bolna_assignments set state='done',outcome='Unavailable',remarks='Keep caller notes',completed_at='2026-10-20',wh_id=case when entity_id=$1 then '999' else null end",[c]);
  const before=(await query('select id,state,remarks,outcome,completed_at,assigned_at,assignee from bolna_assignments order by id')).rows;
  await load([{id:501,contactNumber:'09876543210',alt_phone_number:'98888 88888'},{id:502,contactNumber:'+91 98888 88888',alt_phone_number:null},{id:503,contactNumber:'9777777777',alt_phone_number:null}]);
  expect((await query('select id,state,remarks,outcome,completed_at,assigned_at,assignee from bolna_assignments order by id')).rows).toEqual(before);
  const rows=(await listAssignments(admin,{})).rows;
  expect(rows.find(r=>r.entity_id===a)).toMatchObject({wh_id:'501',warehouse_ids:[501],added_to_db:true});
  expect(rows.find(r=>r.entity_id===b)).toMatchObject({wh_id:null,warehouse_ids:[501,502],added_to_db:true});
  expect(rows.find(r=>r.entity_id===c)).toMatchObject({wh_id:'999',warehouse_ids:[503],added_to_db:true});
  const revisions=(await query('select id,revision from bolna_assignments order by id')).rows;
  expect(await load()).toMatchObject({alreadyApplied:true});
  expect((await query('select id,revision from bolna_assignments order by id')).rows).toEqual(revisions);
});

it('blocks stale previews, single and bulk reopening, while permitting existing open notes to be edited',async()=>{
  const id=await listing();const preview=await previewAssignment(options([id]));
  await assignEntities(options([id]));
  const a=(await query('select * from bolna_assignments')).rows[0];
  await load();
  await expect(assignEntities({...options([id]),expectedPreview:preview.previewHash})).rejects.toMatchObject({status:409});
  const revision=(await query('select revision from bolna_assignments where id=$1',[a.id])).rows[0].revision;
  await updateAssignment(a.id,caller,{revision,remarks:'Existing task notes can still be corrected'});
  await seedLegacyAssignments("update bolna_assignments set state='done',outcome='Unavailable' where id=$1",[a.id]);
  const next=(await query('select revision from bolna_assignments where id=$1',[a.id])).rows[0].revision;
  await expect(updateAssignment(a.id,caller,{revision:next,state:'open'})).rejects.toMatchObject({code:'WAREHOUSE_ALREADY_ADDED'});
  expect(await bulkAssignments(admin,{ids:[a.id],action:'reopen'})).toMatchObject({eligible:0,skippedWarehouse:1});
});

it('blocks AI dispatch before provider traffic and retains exclusion metadata through deduplication',async()=>{
  const a=await listing(['9000000000','9876543210']),b=await listing(['9000000000']);await load();
  const rows=await getRawQueueRowsByIds(admin,[a,b]);
  const summary=assembleBatch(rows,[],{availableLanguages:['hindi','english']});
  expect(summary).toMatchObject({warehouseExists:1,callable:[]});
  const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('Provider must not be called'));
  try{
    await expect(dispatchBatch(admin,{ids:[a,b],intentKey:randomUUID(),confirm:true,routingMode:'auto',excludeCats:[]})).rejects.toMatchObject({status:409});
    expect(fetch).not.toHaveBeenCalled();
    expect((await query('select count(*)::int n from call_batches')).rows[0].n).toBe(0);
  }finally{fetch.mockRestore();}
});

it('uses inbound and retained phone fallbacks for call assignments and enforces direct SQL guards',async()=>{
  await listing();const phoneId=(await query('select phone_id from raw_phone_numbers')).rows[0].phone_id;
  const inbound=randomUUID(),retained=randomUUID();
  await query("insert into bolna_call_logs(id,call_type,from_number,to_number,phone_id) values($1,'inbound','+91 98765 43210','9000000000',$3),($2,'outbound',null,null,$3)",[inbound,retained,phoneId]);
  await load();
  for(const id of [inbound,retained]){
    const preview=await previewAssignment({...options([id]),entity:'call'});expect(preview).toMatchObject({eligible:0,warehouseExists:1});
    await expect(query("insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by) values('call',$1,$2,$3)",[id,caller.email,admin.email])).rejects.toMatchObject({code:'23514'});
  }
  expect((await getCalls(admin,{})).rows.every(c=>c.warehouse_ids.includes(501))).toBe(true);
  const batch=(await query('insert into call_batches default values returning id')).rows[0].id;
  await expect(query('insert into call_batch_items(batch_id,contact_number) values($1,$2)',[batch,'+91 (98765) 43210'])).rejects.toMatchObject({code:'23514'});
});

it('blocks in-place caller changes with the shared legacy triggers disabled, while preserving ordinary edits',async()=>{
  const id=await listing();await assignEntities(options([id]));await load();
  const client=await getPool().connect();
  try{
    await client.query('begin');
    await client.query('alter table bolna_assignments disable trigger bolna_assignment_contacts_sync; alter table bolna_assignments disable trigger bolna_assignment_quality_guard');
    await client.query("update bolna_assignments set state='open',assignee=assignee,remarks='Notes remain editable'");
    await expect(client.query('update bolna_assignments set assignee=$1',[admin.email])).rejects.toMatchObject({code:'23514',detail:expect.stringContaining('WAREHOUSE_ALREADY_ADDED')});
  }finally{await client.query('rollback');client.release();}
  expect((await query('select assignee from bolna_assignments')).rows[0].assignee).toBe(caller.email);
});

it('keeps warehouse matching distinct from saved onboarding and consistent across scope, counts, selections and exports',async()=>{
  const a=await listing(),b=await listing(['9888888888']),c=await listing();
  await assignEntities(options([b]));
  const allocated=await assignEntities({...options([c]),assignee:admin.email});
  await query("update bolna_assignments set added_to_db=true,wh_id='999' where entity_id=$1",[b]);
  const call=randomUUID();await query("insert into bolna_call_logs(id,status,call_type,to_number) values($1,'completed','outbound','+919876543210')",[call]);
  await load();
  const f=toRawFilters({warehouse_match:'yes'}),expected=[a,c].sort();
  const exported=async(spec:ReturnType<typeof rawExportQuery>)=>(await query(spec.sql,spec.params)).rows;
  expect((await getRawRecords(admin,f)).rows.map(r=>r.id).sort()).toEqual(expected);
  expect((await getRawRecords(admin,f)).total).toBe(2);
  expect((await getRawRecordIds(admin,f,100)).ids.sort()).toEqual(expected);
  expect((await exported(rawExportQuery(admin,f))).map(r=>r.id).sort()).toEqual(expected);
  expect((await getRawRecords(admin,{warehouse_match:'no'})).rows.map(r=>r.id)).toEqual([b]);
  expect((await getRawRecords(admin,{warehouse_match:'yes',wh_id:'404'})).total).toBe(0);
  // An unassigned phone match does not change the meaning of the saved staff flag.
  expect((await getRawRecords(admin,{added_to_db:'yes'})).rows.map(r=>r.id).sort()).toEqual([b,c].sort());
  expect((await getRawRecords(admin,{onboarded:'yes'})).rows.map(r=>r.id).sort()).toEqual([b,c].sort());
  expect((await getRawRecords(caller,f)).total).toBe(0);
  expect((await listAssignments(caller,{warehouse_match:'yes'})).total).toBe(0);
  expect((await listAssignments(admin,{warehouse_match:'yes'})).rows.map(r=>r.entity_id)).toEqual([c]);
  expect((await personalWork(caller,'record',{warehouse_match:'no'},1)).rows.map(r=>r.entityId)).toEqual([b]);
  expect((await personalTotals(caller.email,{warehouse_match:'yes'})).record.open).toBe(0);
  const cf=toCallFilters({warehouse_match:'yes'});
  expect((await getCalls(admin,cf)).rows.map(r=>r.id)).toEqual([call]);
  expect((await exported(callsExportQuery(admin,cf))).map(r=>r.id)).toEqual([call]);
  expect((await getCalls(caller,cf)).total).toBe(0);
  const batch=await getBatch(admin,'manual',allocated.batchId);
  expect((await batchMembers(admin,batch,'all',1,{warehouse_match:'yes'})).total).toBe(1);
  expect((await batchMembers(admin,batch,'all',1,{warehouse_match:'no'})).total).toBe(0);
  expect((await exported(batchMembersExport(admin,batch,'all',{warehouse_match:'yes'})))[0].warehouse_ids).toEqual([501]);
});

it('serializes an allocation racing the import and rechecks warehouse matches after the lock',async()=>{
  const id=await listing(),client=await getPool().connect();
  let allocation:ReturnType<typeof assignEntities>|undefined;
  try{
    await client.query('begin');
    await backfillWarehouseContacts(client,[{id:501,contactNumber:'9876543210'}],'2026-10-29T00:00:00Z');
    allocation=assignEntities(options([id]));
    await vi.waitFor(async()=>expect((await query("select count(*)::int n from pg_stat_activity where wait_event='advisory' and query like '%81620404%'")).rows[0].n).toBeGreaterThan(0));
    await client.query('commit');
    expect(await allocation).toMatchObject({assigned:0,skippedWarehouse:1});
    expect((await query('select count(*)::int n from bolna_assignments')).rows[0].n).toBe(0);
  }finally{await client.query('rollback');client.release();await allocation?.catch(()=>{});}
});

it('rolls back both associations and existing assignment changes on a failed import transaction',async()=>{
  const id=await listing();await assignEntities(options([id]));
  const before=(await query('select * from bolna_assignments')).rows;
  await expect(transaction(async client=>{
    await backfillWarehouseContacts(client,[{id:501,contactNumber:'9876543210'}],'2026-10-29T00:00:00Z');
    throw Error('Interrupted import');
  })).rejects.toThrow('Interrupted import');
  expect((await query('select * from bolna_assignments')).rows).toEqual(before);
  expect((await query('select count(*)::int n from bolna_warehouse_contacts')).rows[0].n).toBe(0);
  expect((await query('select count(*)::int n from bolna_warehouse_imports')).rows[0].n).toBe(0);
});
