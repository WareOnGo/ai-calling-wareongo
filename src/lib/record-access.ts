import { query } from './db';
import { ApiError } from './api';
import { assignmentScope, type Viewer } from './scope';

/** Authorize before reading contact evidence, without fetching full call details. */
export async function recordAccess(viewer: Viewer, entity: 'call' | 'record', id: string, withPrimary = false) {
  const params: unknown[] = [id], allowed = assignmentScope(viewer, entity, 'seed.id', params);
  const displayPhone = entity === 'call' ? `case when seed.call_type='inbound' then seed.from_number else seed.to_number end`
    : `(select p.phone from raw_phones rp join raw_phone_numbers p using(phone_id)
        where rp.master_id=seed.id and nullif(trim(p.phone),'') is not null order by rp.is_primary desc,rp.phone_id limit 1)`;
  const result = await query<{ id: string; phones: string[]; primary_phone: string | null }>(`select seed.id,
    ${withPrimary ? `right(regexp_replace(${displayPhone},'\\D','','g'),10)` : 'null::text'} primary_phone,
    array(select distinct phone_last10 from bolna_assignment_contacts
      where entity_type='${entity}' and entity_id=seed.id order by phone_last10) phones
    from ${entity === 'call' ? 'bolna_call_logs' : 'raw_records'} seed
    where seed.id=$1::uuid${allowed ? ` and ${allowed}` : ''}`, params);
  if (!result.rowCount) throw new ApiError(404, 'Not found');
  return result.rows[0];
}
