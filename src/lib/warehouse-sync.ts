import {query, transaction} from './db';
import {readWarehouseSource, type WarehouseSourceSnapshot, type WarehouseSourceCursor} from './warehouse-source';
import {applyWarehouseSnapshot, claimWarehouseSync, failWarehouseSync, prepareWarehouseSnapshot, WarehouseSyncError} from '../../database/warehouse-sync.mjs';

export async function runWarehouseSync(readSource: (cursor: WarehouseSourceCursor) => Promise<WarehouseSourceSnapshot> = readWarehouseSource) {
  const claim = await transaction(claimWarehouseSync);
  if (claim.status !== 'claimed' || !claim.token) return claim;
  let phase = 'SOURCE';
  try {
    const snapshot = prepareWarehouseSnapshot(await readSource(claim.sourceCursor));
    phase = 'APPLY';
    return await transaction(client => applyWarehouseSnapshot(client, claim.token, snapshot));
  } catch (error) {
    const code = error instanceof WarehouseSyncError ? error.code : `${phase}_FAILED`;
    try { await transaction(client => failWarehouseSync(client, claim.token, code)); }
    catch { console.error('[warehouse-sync] Could not record failure; lease will expire', {runId: claim.token}); }
    // Never persist/log source exceptions, which can contain phone data or secrets.
    console.error('[warehouse-sync] Run failed', {runId: claim.token, code});
    return {status: 'failed', runId: claim.token, code};
  }
}

export async function warehouseSyncStatus() {
  const [state, runs, reviews] = await Promise.all([
    query(`select enabled,interval_seconds,next_attempt_at,last_attempt_at,last_success_at,last_snapshot_at,
      lease_until,consecutive_failures,last_error_code,last_summary,initialized,warehouse_cursor,
      audit_cursor_at::text audit_cursor_at,audit_cursor_id,recheck_cursor from bolna_warehouse_sync_state where id=1`),
    query(`select id,started_at,finished_at,status,snapshot_at,summary,error_code
      from bolna_warehouse_sync_runs order by started_at desc limit 10`),
    query('select count(*)::int pending from bolna_warehouse_sync_reviews where resolved_at is null'),
  ]);
  return {state: state.rows[0], recentRuns: runs.rows, pendingReviews: reviews.rows[0].pending};
}
