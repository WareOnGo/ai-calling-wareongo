import { query } from './db';
import { ApiError } from './api';
import { assignmentScope, type Viewer } from './scope';

/** Authorize before reading contact evidence, without fetching full call details. */
export async function recordAccess(viewer: Viewer, entity: 'call' | 'record', id: string) {
  const params: unknown[] = [id], allowed = assignmentScope(viewer, entity, 'seed.id', params);
  const result = await query<{ id: string; phones: string[] }>(`select seed.id,
    array(select distinct phone_last10 from bolna_assignment_contacts
      where entity_type='${entity}' and entity_id=seed.id order by phone_last10) phones
    from ${entity === 'call' ? 'bolna_call_logs' : 'raw_records'} seed
    where seed.id=$1::uuid${allowed ? ` and ${allowed}` : ''}`, params);
  if (!result.rowCount) throw new ApiError(404, 'Not found');
  return result.rows[0];
}
