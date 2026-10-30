import {Client, type ClientConfig} from 'pg';
import {databaseTls} from './database-tls';

export type WarehouseSourceRow = {id: number; contactNumber: string | null; alt_phone_number: string | null};
export type WarehouseSourceCursor = {
  initialized: boolean;warehouseId: number;auditAt: string|null;auditId: string|null;recheckId: number;knownIds: number[];
};
export type WarehouseSourceSnapshot = {
  warehouses: WarehouseSourceRow[];snapshotAt: string;mode?: 'bootstrap'|'incremental';touchedWarehouseIds?: number[];
  cursors?: {warehouseId: number;auditAt: string;auditId: string;recheckId: number};
  hasMore?: boolean;auditEventsRead?: number;auditReplayLimited?: boolean;
};
type AuditChange = {event_id: string;changed_at: string;warehouse_id: number};
const PAGE_SIZE=500, RECHECK_SIZE=250;
const initialCursor: WarehouseSourceCursor={initialized:false,warehouseId:0,auditAt:null,auditId:null,recheckId:0,knownIds:[]};

export function warehouseSourceConfig(env: Record<string,string|undefined> = process.env): ClientConfig {
  if (!env.WAREHOUSE_DATABASE_URL) throw new Error('WAREHOUSE_SOURCE_NOT_CONFIGURED');
  const url = new URL(env.WAREHOUSE_DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('INVALID_WAREHOUSE_SOURCE_URL');
  // URL SSL options must never override certificate/hostname verification.
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith('ssl') || ['pgbouncer', 'connection_limit'].includes(key)) url.searchParams.delete(key);
  }
  return {
    connectionString: url.toString(),
    ssl: databaseTls(url.hostname, {DATABASE_SSL_CA: env.WAREHOUSE_DATABASE_SSL_CA}),
    connectionTimeoutMillis: 10_000,
    statement_timeout: 20_000,
    query_timeout: 25_000,
    idle_in_transaction_session_timeout: 20_000,
    application_name: 'callongo_warehouse_sync',
  };
}

// The source client owns a repeatable-read transaction. Keep naive audit
// timestamps as PostgreSQL text: JS Date would apply the server's local timezone
// and lose sub-millisecond precision, skipping boundary events.
export async function readWarehouseChanges(client: Pick<Client,'query'>, cursor: WarehouseSourceCursor): Promise<WarehouseSourceSnapshot> {
  const snapshotAt=(await client.query<{snapshot_at: Date}>('select transaction_timestamp() snapshot_at')).rows[0].snapshot_at.toISOString();
  if (!cursor.initialized) {
    const {rows:warehouses}=await client.query<WarehouseSourceRow>(`select id,"contactNumber",alt_phone_number
      from public."Warehouse" order by id limit 100001`);
    const latest=(await client.query<AuditChange>(`select event_id,changed_at::text as changed_at,warehouse_id
      from public.callongo_warehouse_changes order by changed_at desc,event_id desc limit 1`)).rows[0];
    return {mode:'bootstrap',snapshotAt,warehouses,touchedWarehouseIds:warehouses.map(w=>w.id),
      cursors:{warehouseId:warehouses.reduce((max,w)=>Math.max(max,w.id),0),auditAt:latest?.changed_at??'1970-01-01 00:00:00',auditId:latest?.event_id??'',recheckId:0},
      hasMore:false,auditEventsRead:0,auditReplayLimited:false};
  }
  if (cursor.auditAt===null || cursor.auditId===null) throw new Error('MISSING_AUDIT_CURSOR');
  const newer=(await client.query<{id:number}>(`select id from public."Warehouse" where id>$1 order by id limit $2`,[cursor.warehouseId,PAGE_SIZE+1])).rows;
  const events=(await client.query<AuditChange>(`select event_id,changed_at::text as changed_at,warehouse_id from public.callongo_warehouse_changes
    where (changed_at,event_id)>($1::timestamp,$2::text) order by changed_at,event_id limit $3`,[cursor.auditAt,cursor.auditId,PAGE_SIZE+1])).rows;
  // Audit inserts happen after the HTTP response. Replay a bounded overlap for
  // late commits and equal timestamps; replayed events never move the cursor back.
  const replay=(await client.query<AuditChange>(`select event_id,changed_at::text as changed_at,warehouse_id from public.callongo_warehouse_changes
    where changed_at >= $1::timestamp-interval '24 hours' and (changed_at,event_id)<=($1::timestamp,$2::text)
    order by changed_at desc,event_id desc limit $3`,[cursor.auditAt,cursor.auditId,PAGE_SIZE+1])).rows;
  const older=(await client.query<{id:number}>(`select id from public."Warehouse" where id>$1 and id<=$2 order by id limit $3`,
    [cursor.recheckId,cursor.warehouseId,RECHECK_SIZE+1])).rows;
  // Include known-but-now-deleted IDs. This also finds direct SQL changes or
  // failed audit writes without periodically rereading the entire source table.
  const recheck=[...new Set([...older.map(w=>w.id),...cursor.knownIds])].sort((a,b)=>a-b);
  const newPage=newer.slice(0,PAGE_SIZE),eventPage=events.slice(0,PAGE_SIZE);
  const touchedWarehouseIds=[...new Set([...newPage.map(w=>w.id),...eventPage.map(e=>e.warehouse_id),
    ...replay.slice(0,PAGE_SIZE).map(e=>e.warehouse_id),...recheck.slice(0,RECHECK_SIZE)])].sort((a,b)=>a-b);
  const warehouses=touchedWarehouseIds.length ? (await client.query<WarehouseSourceRow>(`select id,"contactNumber",alt_phone_number
    from public."Warehouse" where id=any($1::int[]) order by id`,[touchedWarehouseIds])).rows : [];
  const lastEvent=eventPage.at(-1);
  return {mode:'incremental',snapshotAt,warehouses,touchedWarehouseIds,
    cursors:{warehouseId:newPage.at(-1)?.id??cursor.warehouseId,auditAt:lastEvent?.changed_at??cursor.auditAt,
      auditId:lastEvent?.event_id??cursor.auditId,recheckId:recheck.length>RECHECK_SIZE?recheck[RECHECK_SIZE-1]:0},
    hasMore:newer.length>PAGE_SIZE||events.length>PAGE_SIZE,
    auditEventsRead:eventPage.length+Math.min(replay.length,PAGE_SIZE),auditReplayLimited:replay.length>PAGE_SIZE};
}

export async function readWarehouseSource(cursor: WarehouseSourceCursor = initialCursor): Promise<WarehouseSourceSnapshot> {
  const client = new Client(warehouseSourceConfig());
  try {
    await client.connect();
    await client.query('begin isolation level repeatable read read only');
    const snapshot=await readWarehouseChanges(client,cursor);
    await client.query('commit');
    return snapshot;
  } finally {
    // Closing also rolls back a failed read. Do not log driver errors/connection URLs.
    await client.end().catch(() => {});
  }
}
