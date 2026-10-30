import {afterEach,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({connect:vi.fn(),query:vi.fn(),end:vi.fn()}));
vi.mock('pg',()=>({Client:class {connect=mock.connect;query=mock.query;end=mock.end;}}));
import {readWarehouseSource,warehouseSourceConfig} from './warehouse-source';
import {prepareWarehouseSnapshot} from '../../database/warehouse-sync.mjs';
afterEach(()=>{vi.resetAllMocks();vi.unstubAllEnvs();});

it('requires a separate source credential and verifies TLS even when the caller disables it',()=>{
  expect(()=>warehouseSourceConfig({DATABASE_URL:'postgres://caller/db'})).toThrow('NOT_CONFIGURED');
  const config=warehouseSourceConfig({WAREHOUSE_DATABASE_URL:'postgres://reader:secret@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=disable&sslrootcert=bad&pgbouncer=true',DATABASE_SSL:'insecure'});
  expect(config.ssl).toMatchObject({rejectUnauthorized:true,ca:expect.any(Array)});
  expect(new URL(config.connectionString!).search).toBe('');
  expect(config).toMatchObject({connectionTimeoutMillis:10000,statement_timeout:20000,query_timeout:25000});
});

it('uses only the separate source CA when configured',()=>{
  expect(warehouseSourceConfig({WAREHOUSE_DATABASE_URL:'postgres://reader@source/db',WAREHOUSE_DATABASE_SSL_CA:'source\\nCA',DATABASE_SSL_CA:'caller CA'}).ssl)
    .toEqual({rejectUnauthorized:true,ca:'source\nCA'});
});

it('reads only the required source columns inside a consistent read-only transaction and closes the client',async()=>{
  vi.stubEnv('WAREHOUSE_DATABASE_URL','postgres://reader@source/db');
  mock.connect.mockResolvedValue(undefined);mock.end.mockResolvedValue(undefined);
  mock.query.mockResolvedValueOnce({}).mockResolvedValueOnce({rows:[{snapshot_at:new Date('2026-10-30T10:00:00Z')}]})
    .mockResolvedValueOnce({rows:[{id:501,contactNumber:'9876543210',alt_phone_number:null}]}).mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({});
  expect(await readWarehouseSource()).toMatchObject({mode:'bootstrap',snapshotAt:'2026-10-30T10:00:00.000Z',warehouses:[{id:501,contactNumber:'9876543210',alt_phone_number:null}],
    cursors:{warehouseId:501,auditAt:'1970-01-01 00:00:00',auditId:'',recheckId:0}});
  expect(mock.query.mock.calls[0][0]).toBe('begin isolation level repeatable read read only');
  expect(mock.query.mock.calls[2][0]).toMatch(/select id,"contactNumber",alt_phone_number\s+from public\."Warehouse" order by id limit 100001/);
  expect(mock.end).toHaveBeenCalledOnce();
});

it('closes the source connection when its query fails',async()=>{
  vi.stubEnv('WAREHOUSE_DATABASE_URL','postgres://reader@source/db');
  mock.connect.mockResolvedValue(undefined);mock.end.mockResolvedValue(undefined);mock.query.mockRejectedValue(Error('query failed'));
  await expect(readWarehouseSource()).rejects.toThrow('query failed');expect(mock.end).toHaveBeenCalledOnce();
});

it.each([
  {warehouses:[],snapshotAt:'2026-10-30'},
  {warehouses:[{id:0,contactNumber:'9876543210'}],snapshotAt:'2026-10-30'},
  {warehouses:[{id:2147483648,contactNumber:'9876543210'}],snapshotAt:'2026-10-30'},
  {warehouses:[{id:1,contactNumber:'bad number'}],snapshotAt:'2026-10-30'},
  {warehouses:[{id:1,contactNumber:'9876543210'}],snapshotAt:'not a date'},
])('rejects a snapshot that cannot safely be imported: %j',snapshot=>{
  expect(()=>prepareWarehouseSnapshot(snapshot)).toThrow();
});
