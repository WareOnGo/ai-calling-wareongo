import {readFile} from 'node:fs/promises';
import {afterAll,beforeEach,afterEach,expect,it} from 'vitest';
import type {PoolClient} from 'pg';
import {getPool} from '@/lib/db';
import {readWarehouseChanges,type WarehouseSourceCursor} from '@/lib/warehouse-source';
import {prepareWarehouseSnapshot} from '../../database/warehouse-sync.mjs';
let c:PoolClient;
const cursor:WarehouseSourceCursor={initialized:true,warehouseId:1200,auditAt:'2026-10-30 10:00:00.123456',auditId:'m',recheckId:0,knownIds:[]};
beforeEach(async()=>{
  c=await getPool().connect();await c.query('begin');
  await c.query(`create table public."Warehouse"(id int primary key,"contactNumber" text,alt_phone_number text);
    create table public.audit_logs(id text primary key,"createdAt" timestamp not null,entity text,action text,"entityId" text,metadata jsonb,"userEmail" text);
    create role callongo_warehouse_reader;
    grant usage on schema public to callongo_warehouse_reader;
    insert into public."Warehouse" select n,'9876543210',null from generate_series(1,1200) n`);
  await c.query(await readFile(new URL('../../database/warehouse-source-audit-view.sql',import.meta.url),'utf8'));
});
afterEach(async()=>{await c.query('rollback');c.release();});
afterAll(()=>getPool().end());

it('bootstraps through the highest WHID and preserves exact audit timestamp precision without JS timezone conversion',async()=>{
  await c.query(`insert into audit_logs values('event-a','2026-10-30 10:00:00.123456','warehouse','UPDATE','750',
    '{"updatedFields":["contactNumber"]}','hidden@example.test')`);
  const result=await readWarehouseChanges(c,{...cursor,initialized:false});
  expect(result.warehouses).toHaveLength(1200);
  expect(result.cursors).toEqual({warehouseId:1200,auditAt:'2026-10-30 10:00:00.123456',auditId:'event-a',recheckId:0});
  expect(prepareWarehouseSnapshot(result).mode).toBe('bootstrap');
});

it('reads new IDs and audited phone edits/deletions; late equal-timestamp events replay and masked audit values are never used',async()=>{
  await c.query(`insert into public."Warehouse" values(1201,'9888888888',null);
    update public."Warehouse" set "contactNumber"='9777777777' where id=750;
    delete from public."Warehouse" where id=751;
    insert into audit_logs values
      ('z','2026-10-30 10:00:00.123456','warehouse','UPDATE','750','{"updatedFields":["contactNumber"],"changes":[{"field":"contactNumber","to":"••••7777"}]}','hidden'),
      ('a','2026-10-30 10:00:00.123456','warehouse','DELETE','751',null,'hidden'),
      ('irrelevant','2026-10-30 10:01:00','warehouse','UPDATE','900','{"updatedFields":["city"]}','hidden'),
      ('reveal','2026-10-30 10:02:00','contact','READ','901',null,'hidden')`);
  const result=await readWarehouseChanges(c,cursor);
  expect(result.touchedWarehouseIds).toContain(1201);expect(result.touchedWarehouseIds).toContain(751);
  expect(result.warehouses.find(w=>w.id===750)?.contactNumber).toBe('9777777777');
  expect(result.warehouses.some(w=>w.id===751)).toBe(false);
  expect(result.touchedWarehouseIds).not.toContain(900);expect(result.touchedWarehouseIds).not.toContain(901);
  expect(result.warehouses.length).toBeLessThan(260);
  expect(result.cursors).toEqual({warehouseId:1201,auditAt:'2026-10-30 10:00:00.123456',auditId:'z',recheckId:250});
});

it('pages new warehouses and same-timestamp audit events with durable, independent cursors',async()=>{
  await c.query(`insert into audit_logs select 'event-'||lpad(n::text,4,'0'),'2026-10-30 10:01:00.123456'::timestamp,
    'warehouse','UPDATE',n::text,'{"updatedFields":["alt_phone_number"]}'::jsonb,'hidden' from generate_series(1,600) n`);
  const first=await readWarehouseChanges(c,{...cursor,warehouseId:200});
  expect(first.hasMore).toBe(true);
  expect(first.cursors).toMatchObject({warehouseId:700,auditAt:'2026-10-30 10:01:00.123456',auditId:'event-0500'});
  const second=await readWarehouseChanges(c,{initialized:true,knownIds:[],...first.cursors!});
  expect(second.hasMore).toBe(false);
  expect(second.cursors).toMatchObject({warehouseId:1200,auditAt:'2026-10-30 10:01:00.123456',auditId:'event-0600'});
  expect(second.auditEventsRead).toBe(600);
});

it('rotates over old warehouses and known deleted IDs to recover changes that never reached the audit log',async()=>{
  await c.query('delete from public."Warehouse" where id=1199');
  const result=await readWarehouseChanges(c,{...cursor,recheckId:1000,knownIds:[1199,1200]});
  expect(result.touchedWarehouseIds).toContain(1199);
  expect(result.warehouses.some(w=>w.id===1199)).toBe(false);
  expect(result.cursors?.recheckId).toBe(0);
  expect(result.cursors?.warehouseId).toBe(1200);
  expect(result.auditEventsRead).toBe(0);
});

it('accepts an empty incremental result and bounds audit overlap without moving its checkpoint backward',async()=>{
  await c.query('delete from public."Warehouse"');
  const result=await readWarehouseChanges(c,{...cursor,knownIds:[100]});
  expect(result.warehouses).toEqual([]);
  expect(prepareWarehouseSnapshot(result)).toMatchObject({mode:'incremental',contacts:[],touchedWarehouseIds:[100]});
  await c.query(`insert into audit_logs select 'event-'||lpad(n::text,4,'0'),'2026-10-30 09:59:00'::timestamp,
    'warehouse','UPDATE','100',null,'hidden' from generate_series(1,501) n`);
  const replay=await readWarehouseChanges(c,cursor);
  expect(replay.auditReplayLimited).toBe(true);expect(replay.auditEventsRead).toBe(500);
  expect(replay.cursors?.auditAt).toBe(cursor.auditAt);expect(replay.cursors?.auditId).toBe(cursor.auditId);
});

it('exposes only relevant change identifiers to the read-only role, including legacy updates and staged approvals',async()=>{
  await c.query(`insert into audit_logs values
    ('legacy','2026-10-30','warehouse','UPDATE','700',null,'private-user'),
    ('approved','2026-10-30','staged_warehouse','APPROVE','staged-uuid','{"warehouseId":1201}','private-user'),
    ('bad-id','2026-10-30','warehouse','UPDATE','not-an-integer',null,'private-user'),
    ('too-large','2026-10-30','warehouse','UPDATE','999999999999999999999999',null,'private-user'),
    ('not-phone','2026-10-30','warehouse','UPDATE','900','{"updatedFields":["city"]}','private-user');
    set local role callongo_warehouse_reader`);
  const rows=(await c.query('select * from public.callongo_warehouse_changes order by event_id')).rows;
  expect(rows.map(r=>r.warehouse_id)).toEqual([1201,700]);
  expect(Object.keys(rows[0]).sort()).toEqual(['changed_at','event_id','warehouse_id']);
  await c.query('savepoint denied');
  await expect(c.query('select * from public.audit_logs')).rejects.toMatchObject({code:'42501'});
  await c.query('rollback to savepoint denied;reset role');
});
