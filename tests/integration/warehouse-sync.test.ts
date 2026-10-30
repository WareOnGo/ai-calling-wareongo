import {randomUUID} from 'node:crypto';
import {afterAll,beforeEach,expect,it,vi} from 'vitest';
import {getPool,query,transaction} from '@/lib/db';
import {runWarehouseSync} from '@/lib/warehouse-sync';
import type {WarehouseSourceSnapshot} from '@/lib/warehouse-source';
import {GET,POST} from '@/app/api/warehouses/sync/route';
import {applyWarehouseSnapshot,claimWarehouseSync,failWarehouseSync,prepareWarehouseSnapshot} from '../../database/warehouse-sync.mjs';
import {seedLegacyAssignments} from './fixtures';

const snapshot=(warehouses=[{id:501,contactNumber:'+91 (98765) 43210',alt_phone_number:null as string|null}])=>({warehouses,snapshotAt:'2026-10-30T10:00:00Z'});
const sync=(data:WarehouseSourceSnapshot=snapshot())=>runWarehouseSync(async()=>data);
const due=()=>query("update bolna_warehouse_sync_state set next_attempt_at=clock_timestamp()-interval '1 second'");
beforeEach(async()=>{
  await query('truncate bolna_warehouse_imports,bolna_assignments,bolna_app_users,bolna_call_logs,raw_records,raw_phone_numbers,bolna_warehouse_sync_runs restart identity cascade');
  await query('delete from bolna_warehouse_sync_state; insert into bolna_warehouse_sync_state(enabled) values(true)');
  await query("insert into bolna_app_users(email,role) values('caller@test.example','employee')");
});
afterAll(async()=>{
  await query('truncate bolna_warehouse_imports,bolna_warehouse_sync_runs cascade');
  await query('delete from bolna_warehouse_sync_state; insert into bolna_warehouse_sync_state default values');
  await getPool().end();
});
async function listing(phone='9876543210') {
  const id=randomUUID();
  await query("insert into raw_records(id,source,source_record_id,owner_name) values($1::uuid,'sync-test',$1::text,'Owner')",[id]);
  const p=(await query('insert into raw_phone_numbers(phone_last10,phone) values($1,$1) on conflict(phone_last10) do update set phone=excluded.phone returning phone_id',[phone])).rows[0];
  await query('insert into raw_phones(master_id,phone_id,is_primary) values($1,$2,true)',[id,p.phone_id]);
  return id;
}
async function assign(id:string) {
  return (await query("insert into bolna_assignments(entity_type,entity_id,assignee,assigned_by,remarks) values('record',$1,'caller@test.example','caller@test.example','Keep caller notes') returning id",[id])).rows[0].id;
}
async function call(phone='9876543210',whid:string|null=null) {
  return (await query("insert into bolna_call_logs(id,call_type,to_number,wh_id,notes) values($1,'outbound',$2,$3,'Keep AI call notes') returning id",[randomUUID(),phone,whid])).rows[0].id;
}

it('fills open and closed assignments, calls and raw matches while preserving caller verification and notes',async()=>{
  const a=await assign(await listing()),b=await assign(await listing('9888888888'));
  const c=await call();await listing('9000000000');
  await seedLegacyAssignments("update bolna_assignments set state='done',outcome='Unavailable',completed_at=now() where id=$1",[b]);
  const before=(await query('select id,assignee,assigned_by,assigned_at,state,outcome,remarks,added_to_db,completed_at from bolna_assignments order by id')).rows;
  const data=snapshot([{id:501,contactNumber:'9876543210',alt_phone_number:'9888888888'},{id:502,contactNumber:'9000000000',alt_phone_number:null}]);
  expect(await sync(data)).toMatchObject({status:'succeeded',assignmentsFilled:2,callsFilled:1,associationsChanged:3});
  expect((await query('select id,assignee,assigned_by,assigned_at,state,outcome,remarks,added_to_db,completed_at from bolna_assignments order by id')).rows).toEqual(before);
  expect((await query('select id,wh_id,added_to_db from bolna_assignments where id=any($1::bigint[]) order by id',[[a,b]])).rows).toEqual([
    {id:a,wh_id:'501',added_to_db:false},{id:b,wh_id:'501',added_to_db:false},
  ]);
  expect((await query('select wh_id,added_to_db,notes from bolna_call_logs where id=$1',[c])).rows[0]).toEqual({wh_id:'501',added_to_db:false,notes:'Keep AI call notes'});
  expect((await query("select count(*)::int n from bolna_warehouse_matches where entity_type='record'")).rows[0].n).toBe(3);
  expect((await query("select count(*)::int n from bolna_assignment_changes where actor='warehouse-contact-sync'")).rows[0].n).toBe(2);
});

it('keeps all WHIDs, rejects malformed phone tokens, preserves existing WHIDs and completion rules',async()=>{
  const multiple=await assign(await listing()),saved=await assign(await listing('9888888888')),invalid=await assign(await listing('9777777777'));
  await query("update bolna_assignments set wh_id='999',added_to_db=true where id=$1",[saved]);
  await seedLegacyAssignments("update bolna_assignments set state='done',outcome='Unclear',remarks='RNR' where id=$1",[invalid]);
  const savedCall=await call('9888888888','888');
  await sync(snapshot([{id:501,contactNumber:'9876543210',alt_phone_number:'9888888888'},
    {id:502,contactNumber:'0091 98765 43210',alt_phone_number:'9777777777'},
    {id:503,contactNumber:'1239876543210',alt_phone_number:'+1 9876543210'}]));
  const rows=(await query('select id,wh_id,added_to_db from bolna_assignments')).rows;
  expect(rows.find(r=>r.id===multiple)?.wh_id).toBeNull();
  expect(rows.find(r=>r.id===invalid)?.wh_id).toBeNull();
  expect(rows.find(r=>r.id===saved)).toMatchObject({wh_id:'999',added_to_db:true});
  expect((await query('select wh_id from bolna_call_logs where id=$1',[savedCall])).rows[0].wh_id).toBe('888');
  expect((await query("select warehouse_id from bolna_warehouse_contacts where phone_last10='9876543210' order by warehouse_id")).rows).toEqual([{warehouse_id:501},{warehouse_id:502}]);
});

it('gates source reads hourly, and fills new call rows even with an unchanged source hash',async()=>{
  const id=await assign(await listing());await sync();
  const read=vi.fn(async()=>snapshot());
  expect(await runWarehouseSync(read)).toEqual({status:'skipped',reason:'not_due'});expect(read).not.toHaveBeenCalled();
  const first=(await query('select revision from bolna_assignments where id=$1',[id])).rows[0].revision;
  const c=await call();await due();
  expect(await sync()).toMatchObject({status:'succeeded',batchUnchanged:true,associationsChanged:0,assignmentsFilled:0,callsFilled:1});
  expect((await query('select wh_id from bolna_call_logs where id=$1',[c])).rows[0].wh_id).toBe('501');
  expect((await query('select revision from bolna_assignments where id=$1',[id])).rows[0].revision).toBe(first);
  expect((await query("select next_attempt_at-last_success_at >= interval '59 minutes' hourly from bolna_warehouse_sync_state")).rows[0].hourly).toBe(true);
});

it.each([
  {interval:3600,overdue:35,slots:1},
  {interval:3600,overdue:7235,slots:3},
  {interval:600,overdue:35,slots:1},
])('advances the scheduled slot without completion-time drift or catch-up storms: %j',async({interval,overdue,slots})=>{
  const anchor=(await query(`update bolna_warehouse_sync_state set interval_seconds=$1,
    next_attempt_at=clock_timestamp()-make_interval(secs=>$2) returning next_attempt_at::text anchor`,[interval,overdue])).rows[0].anchor;
  expect(await sync()).toMatchObject({status:'succeeded'});
  const timing=(await query(`select next_attempt_at=$1::timestamptz+make_interval(secs=>$2::int*$3::int) exact_slot,
    next_attempt_at>clock_timestamp() future_slot,
    next_attempt_at<=clock_timestamp()+make_interval(secs=>interval_seconds) within_interval
    from bolna_warehouse_sync_state`,[anchor,interval,slots])).rows[0];
  expect(timing).toEqual({exact_slot:true,future_slot:true,within_interval:true});
});

it('retains disappeared associations, flags them, avoids filling from stale evidence and resolves reappearing pairs',async()=>{
  await sync();const c=await call();await due();
  const changed=snapshot([{id:502,contactNumber:'9888888888',alt_phone_number:null}]);
  expect(await sync(changed)).toMatchObject({pendingReviews:1,callsFilled:0});
  expect((await query('select count(*)::int n from bolna_warehouse_contacts')).rows[0].n).toBe(2);
  expect((await query('select wh_id from bolna_call_logs where id=$1',[c])).rows[0].wh_id).toBeNull();
  await expect(assign(await listing())).rejects.toMatchObject({code:'23514'});
  await due();
  expect(await sync(snapshot([...snapshot().warehouses,...changed.warehouses]))).toMatchObject({pendingReviews:0,reviewsResolved:1,callsFilled:1});
  expect((await query('select count(*)::int n from bolna_warehouse_sync_reviews where resolved_at is null')).rows[0].n).toBe(0);
});

it('claims once across simultaneous invocations and recovers expired runs without letting the old owner write',async()=>{
  const claims=await Promise.all([transaction(claimWarehouseSync),transaction(claimWarehouseSync)]);
  const first=claims.find(c=>c.token)!.token;
  expect(claims.filter(c=>c.status==='claimed')).toHaveLength(1);
  expect(claims.find(c=>!c.token)).toMatchObject({reason:'leased'});
  await query("update bolna_warehouse_sync_state set lease_until=clock_timestamp()-interval '1 second'");
  const next=await transaction(claimWarehouseSync);
  await expect(transaction(c=>applyWarehouseSnapshot(c,first,prepareWarehouseSnapshot(snapshot())))).rejects.toMatchObject({code:'LEASE_LOST'});
  await transaction(c=>failWarehouseSync(c,first,'STALE_FAILURE'));
  expect((await query('select lease_token from bolna_warehouse_sync_state')).rows[0].lease_token).toBe(next.token);
  expect((await query('select status from bolna_warehouse_sync_runs where id=$1',[first])).rows[0].status).toBe('abandoned');
  expect((await query('select count(*)::int n from bolna_warehouse_contacts')).rows[0].n).toBe(0);
  await transaction(c=>applyWarehouseSnapshot(c,next.token,prepareWarehouseSnapshot(snapshot())));
});

it('rolls back the entire apply on a late write failure and preserves the last successful snapshot',async()=>{
  await sync();const previous=(await query('select last_success_at,source_sha256 from bolna_warehouse_sync_state')).rows[0];
  const a=await assign(await listing('9888888888'));await call('9888888888');await due();
  await query(`create function warehouse_sync_test_failure() returns trigger language plpgsql as $$begin raise exception 'deliberate test failure'; end$$;
    create trigger warehouse_sync_test_failure before update on bolna_call_logs for each row execute function warehouse_sync_test_failure()`);
  const log=vi.spyOn(console,'error').mockImplementation(()=>{});
  try {
    expect(await sync(snapshot([{id:502,contactNumber:'9888888888',alt_phone_number:null}]))).toMatchObject({status:'failed',code:'APPLY_FAILED'});
    expect((await query('select warehouse_id from bolna_warehouse_contacts')).rows).toEqual([{warehouse_id:501}]);
    expect((await query('select wh_id from bolna_assignments where id=$1',[a])).rows[0].wh_id).toBeNull();
    expect((await query('select last_success_at,source_sha256 from bolna_warehouse_sync_state')).rows[0]).toEqual(previous);
    expect((await query('select lease_token,consecutive_failures,last_error_code from bolna_warehouse_sync_state')).rows[0]).toEqual({lease_token:null,consecutive_failures:1,last_error_code:'APPLY_FAILED'});
    expect((await query('select count(*)::int n from bolna_warehouse_sync_reviews')).rows[0].n).toBe(0);
  } finally {log.mockRestore();await query('drop trigger warehouse_sync_test_failure on bolna_call_logs; drop function warehouse_sync_test_failure()');}
});

it('rolls back writes if its lease expires during the apply, before the final commit fence',async()=>{
  const claim=await transaction(claimWarehouseSync);
  await query(`create function warehouse_sync_test_slow() returns trigger language plpgsql as $$begin perform pg_sleep(0.2);return new;end$$;
    create trigger warehouse_sync_test_slow after insert on bolna_warehouse_contacts for each row execute function warehouse_sync_test_slow()`);
  try {
    await query("update bolna_warehouse_sync_state set lease_until=clock_timestamp()+interval '100 milliseconds'");
    await expect(transaction(c=>applyWarehouseSnapshot(c,claim.token,prepareWarehouseSnapshot(snapshot())))).rejects.toMatchObject({code:'LEASE_LOST'});
    expect((await query('select count(*)::int n from bolna_warehouse_contacts')).rows[0].n).toBe(0);
    expect((await query('select last_success_at from bolna_warehouse_sync_state')).rows[0].last_success_at).toBeNull();
  } finally {await query('drop trigger warehouse_sync_test_slow on bolna_warehouse_contacts;drop function warehouse_sync_test_slow()');}
});

it('honors a pause while fetching the source and keeps existing data intact',async()=>{
  const log=vi.spyOn(console,'error').mockImplementation(()=>{});
  try {
    expect(await runWarehouseSync(async()=>{
      await query('update bolna_warehouse_sync_state set enabled=false');return snapshot();
    })).toMatchObject({status:'failed',code:'SYNC_DISABLED'});
    expect((await query('select count(*)::int n from bolna_warehouse_contacts')).rows[0].n).toBe(0);
  } finally {log.mockRestore();}
});

it('does not persist or log source credentials on failure and retries on a later tick',async()=>{
  const log=vi.spyOn(console,'error').mockImplementation(()=>{});
  try {
    expect(await runWarehouseSync(async()=>{throw Error('postgres://secret:password@source/PII');})).toMatchObject({status:'failed',code:'SOURCE_FAILED'});
    expect(JSON.stringify(log.mock.calls)).not.toContain('password');
    expect((await query('select error_code from bolna_warehouse_sync_runs')).rows).toEqual([{error_code:'SOURCE_FAILED'}]);
    expect(await sync()).toMatchObject({reason:'not_due'});
    await due();expect(await sync()).toMatchObject({status:'succeeded'});
  } finally {log.mockRestore();}
});

it('commits cursors with data, scopes missing-pair review to fetched warehouses, and schedules backlog on the next cron tick',async()=>{
  const cursors={warehouseId:501,auditAt:'2026-10-30 10:00:00.123456',auditId:'event-a',recheckId:0};
  await sync({...snapshot(),cursors});await due();
  const next={warehouseId:502,auditAt:'2026-10-30 10:01:00.123456',auditId:'event-b',recheckId:250};
  expect(await sync({...snapshot([{id:502,contactNumber:'9888888888',alt_phone_number:null}]),
    mode:'incremental',touchedWarehouseIds:[502],cursors:next,hasMore:true})).toMatchObject({pendingReviews:0,hasMore:true,warehouseCursor:502});
  const state=(await query(`select initialized,warehouse_cursor,audit_cursor_at::text audit_at,audit_cursor_id,recheck_cursor,
    next_attempt_at<=clock_timestamp() due from bolna_warehouse_sync_state`)).rows[0];
  expect(state).toEqual({initialized:true,warehouse_cursor:502,audit_at:next.auditAt,audit_cursor_id:'event-b',recheck_cursor:250,due:true});
  // A deleted warehouse can legitimately return no rows, with its ID in scope.
  expect(await sync({...snapshot([]),mode:'incremental',touchedWarehouseIds:[501],cursors:next})).toMatchObject({pendingReviews:1});
  expect((await query('select warehouse_id from bolna_warehouse_sync_reviews where resolved_at is null')).rows).toEqual([{warehouse_id:501}]);
  expect((await query('select count(*)::int n from bolna_warehouse_contacts')).rows[0].n).toBe(2);
});

it('does not advance any cursor when applying an incremental batch fails',async()=>{
  const first={warehouseId:501,auditAt:'2026-10-30 10:00:00.123456',auditId:'event-a',recheckId:0};
  await sync({...snapshot(),cursors:first});await call('9888888888');await due();
  await query(`create function warehouse_sync_test_failure() returns trigger language plpgsql as $$begin raise exception 'injected failure';end$$;
    create trigger warehouse_sync_test_failure before update on bolna_call_logs for each row execute function warehouse_sync_test_failure()`);
  const log=vi.spyOn(console,'error').mockImplementation(()=>{});
  try {
    const next={warehouseId:502,auditAt:'2026-10-30 10:01:00.123456',auditId:'event-b',recheckId:250};
    expect(await sync({...snapshot([{id:502,contactNumber:'9888888888',alt_phone_number:null}]),mode:'incremental',touchedWarehouseIds:[502],cursors:next}))
      .toMatchObject({status:'failed'});
    expect((await query('select warehouse_cursor,audit_cursor_at::text audit_at,audit_cursor_id,recheck_cursor from bolna_warehouse_sync_state')).rows[0])
      .toEqual({warehouse_cursor:501,audit_at:first.auditAt,audit_cursor_id:'event-a',recheck_cursor:0});
    expect((await query('select warehouse_id from bolna_warehouse_contacts')).rows).toEqual([{warehouse_id:501}]);
  } finally {log.mockRestore();await query('drop trigger warehouse_sync_test_failure on bolna_call_logs;drop function warehouse_sync_test_failure()');}
});

it('does not read the source when disabled, but remains independent of the AI enrichment toggle',async()=>{
  await query('update bolna_warehouse_sync_state set enabled=false');
  const read=vi.fn(async()=>snapshot());
  expect(await runWarehouseSync(read)).toMatchObject({reason:'disabled'});expect(read).not.toHaveBeenCalled();
  await query('update bolna_warehouse_sync_state set enabled=true');
  vi.stubEnv('ENABLE_ENRICHMENT','false');
  try{expect(await sync()).toMatchObject({status:'succeeded'});}finally{vi.unstubAllEnvs();}
});

it('rejects invalid snapshots without changing mapping or succeeding the run',async()=>{
  const log=vi.spyOn(console,'error').mockImplementation(()=>{});
  try {
    expect(await sync(snapshot([]))).toMatchObject({status:'failed',code:'INVALID_SOURCE_SIZE'});
    expect((await query('select count(*)::int n from bolna_warehouse_contacts')).rows[0].n).toBe(0);
  } finally {log.mockRestore();}
});

it('keeps the worker/status private, never runs on GET and excludes operational tables from public access',async()=>{
  const url='http://localhost/api/warehouses/sync';
  expect((await POST(new Request(url))).status).toBe(401);
  expect((await POST(new Request(`${url}?token=${process.env.PROCESS_SECRET}`))).status).toBe(401);
  expect((await GET(new Request(url))).status).toBe(401);
  const req=new Request(url,{headers:{Authorization:`Bearer ${process.env.PROCESS_SECRET}`}});
  const res=await GET(req);expect(res.status).toBe(200);expect(res.headers.get('cache-control')).toBe('no-store');
  expect((await res.json()).recentRuns).toEqual([]);
  await query('update bolna_warehouse_sync_state set enabled=false');
  expect(await (await POST(req)).json()).toMatchObject({reason:'disabled'});
  const access=await query(`select relrowsecurity,exists(select 1 from aclexplode(relacl) where grantee=0) public_access
    from pg_class where relname in ('bolna_warehouse_sync_state','bolna_warehouse_sync_runs','bolna_warehouse_sync_reviews')`);
  expect(access.rows).toEqual(Array(3).fill({relrowsecurity:true,public_access:false}));
});
