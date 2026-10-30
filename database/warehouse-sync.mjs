import {createHash, randomUUID} from 'node:crypto';
import {warehouseContacts} from './warehouse-contact-backfill.mjs';

// The caller owns each transaction, so rehearsal runs the production write path
// and rolls it back. Source reads must happen outside the allocation lock.
export class WarehouseSyncError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export function prepareWarehouseSnapshot(snapshot) {
  const incremental = snapshot.mode === 'incremental';
  if (!Array.isArray(snapshot.warehouses) || (!incremental && !snapshot.warehouses.length) || snapshot.warehouses.length > 100000) {
    throw new WarehouseSyncError('INVALID_SOURCE_SIZE');
  }
  const snapshotAt = new Date(snapshot.snapshotAt);
  if (!Number.isFinite(snapshotAt.getTime())) throw new WarehouseSyncError('INVALID_SOURCE_TIME');
  let contacts;
  try { contacts = warehouseContacts(snapshot.warehouses); }
  catch { throw new WarehouseSyncError('INVALID_SOURCE_ID'); }
  if ((!incremental && !contacts.length) || contacts.length > 500000 || contacts.some(c => c.warehouse_id > 2147483647)) {
    throw new WarehouseSyncError('INVALID_SOURCE_CONTACTS');
  }
  const touchedIds = new Set(snapshot.touchedWarehouseIds ?? snapshot.warehouses.map(w => w.id));
  const touchedWarehouseIds = [...touchedIds];
  if (touchedWarehouseIds.length > 100000 || touchedWarehouseIds.some(id => !Number.isInteger(id) || id <= 0 || id > 2147483647)
    || snapshot.warehouses.some(w => !touchedIds.has(w.id))) throw new WarehouseSyncError('INVALID_SOURCE_SCOPE');
  // Production readers always supply cursors. Full-snapshot rehearsal can omit them.
  const cursors = snapshot.cursors ?? null;
  if (incremental && !cursors) throw new WarehouseSyncError('MISSING_SOURCE_CURSOR');
  if (cursors && (!Number.isInteger(cursors.warehouseId) || cursors.warehouseId < 0 || cursors.warehouseId > 2147483647
    || !Number.isInteger(cursors.recheckId) || cursors.recheckId < 0 || cursors.recheckId > cursors.warehouseId
    || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?$/.test(cursors.auditAt)
    || typeof cursors.auditId !== 'string' || cursors.auditId.length > 100)) throw new WarehouseSyncError('INVALID_SOURCE_CURSOR');
  return {contacts, snapshotAt: snapshotAt.toISOString(), sourceWarehouses: snapshot.warehouses.length,
    sourceHash: createHash('sha256').update(JSON.stringify(contacts)).digest('hex'),
    mode: incremental ? 'incremental' : 'bootstrap', touchedWarehouseIds,cursors,hasMore: !!snapshot.hasMore,
    auditEventsRead: snapshot.auditEventsRead ?? 0,auditReplayLimited: !!snapshot.auditReplayLimited};
}

export async function claimWarehouseSync(client) {
  await client.query("set local lock_timeout='2s'");
  const state = (await client.query(`select *,audit_cursor_at::text as audit_cursor_text,clock_timestamp() as checked_at
    from bolna_warehouse_sync_state where id=1 for update`)).rows[0];
  if (!state) throw new WarehouseSyncError('MISSING_SYNC_STATE');
  if (!state.enabled) return {status: 'skipped', reason: 'disabled'};
  if (state.lease_until && state.lease_until > state.checked_at) return {status: 'skipped', reason: 'leased'};
  if (state.next_attempt_at > state.checked_at) return {status: 'skipped', reason: 'not_due'};
  if (state.lease_token) {
    await client.query(`update bolna_warehouse_sync_runs set status='abandoned',finished_at=clock_timestamp(),
      error_code='LEASE_EXPIRED' where id=$1 and status='running'`, [state.lease_token]);
  }
  const token = randomUUID();
  // Worker maxDuration is 120s; a crashed invocation becomes retryable next tick.
  await client.query(`update bolna_warehouse_sync_state set lease_token=$1,lease_until=clock_timestamp()+interval '180 seconds',
    last_attempt_at=clock_timestamp() where id=1`, [token]);
  await client.query("insert into bolna_warehouse_sync_runs(id,status) values($1,'running')", [token]);
  // The rotating page includes previously known IDs, so deleted warehouses can
  // be reviewed even if their application audit write failed.
  const knownIds = (await client.query(`select distinct warehouse_id from bolna_warehouse_contacts
    where warehouse_id > $1 and warehouse_id <= $2 order by warehouse_id limit 251`,
    [state.recheck_cursor,state.warehouse_cursor])).rows.map(r => r.warehouse_id);
  return {status: 'claimed', token, sourceCursor: {initialized:state.initialized,
    warehouseId:state.warehouse_cursor,auditAt:state.audit_cursor_text,auditId:state.audit_cursor_id,
    recheckId:state.recheck_cursor,knownIds}};
}

export async function applyWarehouseSnapshot(client, token, snapshot) {
  await client.query("set local lock_timeout='2s'; set local statement_timeout='20s'");
  await client.query('select pg_advisory_xact_lock(81620404)');
  const state = (await client.query(`select *,lease_until > clock_timestamp() as lease_valid,
    (audit_cursor_at is null or ($2::timestamp,$3::text)>=(audit_cursor_at,audit_cursor_id)) as cursor_valid
    from bolna_warehouse_sync_state where id=1 and lease_token=$1 for update`,
    [token,snapshot.cursors?.auditAt??null,snapshot.cursors?.auditId??null])).rows[0];
  if (!state?.lease_valid) throw new WarehouseSyncError('LEASE_LOST');
  if (!state.enabled) throw new WarehouseSyncError('SYNC_DISABLED');
  const {contacts, snapshotAt, sourceHash, sourceWarehouses,mode,touchedWarehouseIds,cursors} = snapshot;
  if (cursors && (!state.cursor_valid || cursors.warehouseId < state.warehouse_cursor
    || (mode === 'incremental' && !state.initialized))) throw new WarehouseSyncError('INVALID_SOURCE_CURSOR');
  const importName = `wag-warehouse-sync:${token}`;
  await client.query(`create temporary table warehouse_sync_stage (
    phone_last10 text,warehouse_id integer,source_fields text[],primary key(phone_last10,warehouse_id)) on commit drop`);
  await client.query(`insert into warehouse_sync_stage select * from jsonb_to_recordset($1::jsonb)
    as x(phone_last10 text,warehouse_id int,source_fields text[])`, [JSON.stringify(contacts)]);
  await client.query(`insert into bolna_warehouse_imports(name,snapshot_at,source_sha256) values($1,$2,$3)`,
    [importName, snapshotAt, sourceHash]);
  const changed = await client.query(`insert into bolna_warehouse_contacts(phone_last10,warehouse_id,source_fields,import_name)
    select phone_last10,warehouse_id,source_fields,$1 from warehouse_sync_stage
    on conflict(phone_last10,warehouse_id) do update set source_fields=excluded.source_fields,import_name=excluded.import_name
    where bolna_warehouse_contacts.source_fields is distinct from excluded.source_fields`, [importName]);
  const missing = await client.query(`insert into bolna_warehouse_sync_reviews(phone_last10,warehouse_id,snapshot_at)
    select w.phone_last10,w.warehouse_id,$1 from bolna_warehouse_contacts w
    where ($2='bootstrap' or w.warehouse_id=any($3::int[]))
    and not exists(select 1 from warehouse_sync_stage s where (s.phone_last10,s.warehouse_id)=(w.phone_last10,w.warehouse_id))
    on conflict(phone_last10,warehouse_id) do update set snapshot_at=excluded.snapshot_at,last_seen_at=clock_timestamp(),
      first_seen_at=case when bolna_warehouse_sync_reviews.resolved_at is not null then clock_timestamp()
        else bolna_warehouse_sync_reviews.first_seen_at end,resolved_at=null`, [snapshotAt,mode,touchedWarehouseIds]);
  const resolved = await client.query(`update bolna_warehouse_sync_reviews r set resolved_at=clock_timestamp()
    where resolved_at is null and exists(select 1 from warehouse_sync_stage s
      where (s.phone_last10,s.warehouse_id)=(r.phone_last10,r.warehouse_id))`);
  await client.query("select set_config('bolna.actor','warehouse-contact-sync',true)");
  // Include every retained association when deciding ambiguity. A missing pair
  // still blocks allocation, but must not populate a new saved WHID.
  const assignments = await client.query(`with matches as (
    select a.id,min(w.warehouse_id) wh_id from bolna_assignments a
    join bolna_warehouse_matches w using(entity_type,entity_id)
    left join bolna_warehouse_sync_reviews r on (r.phone_last10,r.warehouse_id)=(w.phone_last10,w.warehouse_id)
    where nullif(trim(a.wh_id),'') is null
    group by a.id having count(distinct w.warehouse_id)=1 and not bool_or(r.phone_last10 is not null and r.resolved_at is null)
  ) update bolna_assignments a set wh_id=m.wh_id::text,revision=a.revision+1
    from matches m where a.id=m.id and nullif(trim(a.wh_id),'') is null
    and bolna_completion_issue(a.id,a.state,a.outcome,m.wh_id::text,a.remarks,a.closure_reason,false) is null`);
  const calls = await client.query(`with matches as (
    select c.id,min(w.warehouse_id) wh_id from bolna_call_logs c
    join bolna_warehouse_matches w on w.entity_type='call' and w.entity_id=c.id
    left join bolna_warehouse_sync_reviews r on (r.phone_last10,r.warehouse_id)=(w.phone_last10,w.warehouse_id)
    where nullif(trim(c.wh_id),'') is null
    group by c.id having count(distinct w.warehouse_id)=1 and not bool_or(r.phone_last10 is not null and r.resolved_at is null)
  ) update bolna_call_logs c set wh_id=m.wh_id::text,revision=c.revision+1
    from matches m where c.id=m.id and nullif(trim(c.wh_id),'') is null`);
  const pendingReviews = (await client.query('select count(*)::int n from bolna_warehouse_sync_reviews where resolved_at is null')).rows[0].n;
  const summary = {mode,sourceWarehouses, associations: contacts.length, associationsChanged: changed.rowCount,
    warehousesChecked:touchedWarehouseIds.length,pendingReviews,reviewsFlagged:missing.rowCount,reviewsResolved:resolved.rowCount,
    assignmentsFilled: assignments.rowCount, callsFilled: calls.rowCount,
    batchUnchanged: sourceHash === state.source_sha256,hasMore:snapshot.hasMore,
    auditEventsRead:snapshot.auditEventsRead,auditReplayLimited:snapshot.auditReplayLimited,
    ...(cursors ? {warehouseCursor:cursors.warehouseId,auditCursorAt:cursors.auditAt,auditCursorId:cursors.auditId,recheckCursor:cursors.recheckId} : {})};
  // The fence is checked again immediately before commit; an expired worker
  // must roll back all writes even if no replacement worker has claimed yet.
  const updated = await client.query(`update bolna_warehouse_sync_state set
    last_success_at=clock_timestamp(),last_snapshot_at=$2,source_sha256=$3,last_summary=$4::jsonb,
    next_attempt_at=clock_timestamp()+make_interval(secs=>case when $5 then 0 else interval_seconds end),
    initialized=initialized or $6::boolean,
    warehouse_cursor=coalesce($7::int,warehouse_cursor),audit_cursor_at=coalesce($8::timestamp,audit_cursor_at),
    audit_cursor_id=coalesce($9::text,audit_cursor_id),recheck_cursor=coalesce($10::int,recheck_cursor),
    lease_token=null,lease_until=null,consecutive_failures=0,last_error_code=null
    where id=1 and lease_token=$1 and lease_until > clock_timestamp()`,
    [token,snapshotAt,sourceHash,JSON.stringify(summary),snapshot.hasMore,!!cursors,
      cursors?.warehouseId ?? null,cursors?.auditAt ?? null,cursors?.auditId ?? null,cursors?.recheckId ?? null]);
  if (updated.rowCount !== 1) throw new WarehouseSyncError('LEASE_LOST');
  await client.query(`update bolna_warehouse_sync_runs set status='succeeded',finished_at=clock_timestamp(),
    snapshot_at=$2,source_sha256=$3,summary=$4::jsonb where id=$1`, [token, snapshotAt, sourceHash, JSON.stringify(summary)]);
  await client.query('update bolna_warehouse_imports set summary=$2::jsonb where name=$1', [importName, JSON.stringify(summary)]);
  return {status: 'succeeded', runId: token, ...summary};
}

export async function failWarehouseSync(client, token, code) {
  await client.query("set local lock_timeout='2s'");
  const result = await client.query(`update bolna_warehouse_sync_state set lease_token=null,lease_until=null,
    consecutive_failures=consecutive_failures+1,last_error_code=$2,next_attempt_at=clock_timestamp()+interval '5 minutes'
    where id=1 and lease_token=$1`, [token, code]);
  if (result.rowCount) await client.query(`update bolna_warehouse_sync_runs set status='failed',
    finished_at=clock_timestamp(),error_code=$2 where id=$1 and status='running'`, [token, code]);
}
