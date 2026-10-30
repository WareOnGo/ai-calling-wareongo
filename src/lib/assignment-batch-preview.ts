import { ApiError, bigintId } from './api';
import type { AssignmentHistoryRow } from './assignments';
import { ASSIGNMENT_SOURCE_JOIN, ASSIGNMENT_SUBJECT } from './assignment-context';
import { batchMembers, getBatch } from './batch-browser';
import { query } from './db';
import type { Viewer } from './scope';

type AssignmentPreview = Pick<AssignmentHistoryRow,
  'id' | 'batch_id' | 'entity_type' | 'entity_id' | 'subject' | 'phone' |
  'assignee' | 'assigned_by' | 'assigned_at' | 'note' | 'state' | 'outcome' | 'remarks' | 'completed_at'>;

export async function assignmentBatchPreview(viewer: Viewer, assignmentId: string, page = 1) {
  if (!viewer.isAdmin) throw new ApiError(403, 'forbidden');
  const id = bigintId.parse(assignmentId);
  // A single-assignment preview needs neither table pagination/counts nor AI
  // history. Keep this lookup limited to the fields shown in the modal.
  const assignment = (await query<AssignmentPreview>(`
    select a.id::text, a.batch_id::text, a.entity_type, a.entity_id::text,
      ${ASSIGNMENT_SUBJECT} subject,
      coalesce(rphone.phone, case when cl.call_type='inbound' then cl.from_number else cl.to_number end) phone,
      a.assignee, a.assigned_by, a.assigned_at::text, a.note, a.state, a.outcome, a.remarks, a.completed_at::text
    from bolna_assignments a
    left join raw_records r on a.entity_type='record' and r.id=a.entity_id
    left join bolna_call_logs cl on a.entity_type='call' and cl.id=a.entity_id
    ${ASSIGNMENT_SOURCE_JOIN}
    left join lateral (
      select pp.phone from raw_phones rp join raw_phone_numbers pp using(phone_id)
      where rp.master_id=r.id and nullif(trim(pp.phone),'') is not null
      order by rp.is_primary desc limit 1
    ) rphone on true
    where a.id=$1::bigint`, [id])).rows[0];
  if (!assignment) throw new ApiError(404, 'Assignment not found');
  // A missing batch ID is a standalone legacy assignment, never a date-based group.
  const batch = assignment.batch_id ? await getBatch(viewer, 'manual', assignment.batch_id) : null;
  const members = batch ? await batchMembers(viewer, batch, 'all', page) : null;
  const people = [...new Set([assignment.assignee, assignment.assigned_by, batch?.created_by,
    ...(batch?.assignees || []), ...(members?.rows.flatMap(row => [row.assignee, row.current_owner]) || [])].filter(Boolean))];
  const users = (await query<{ email: string; name: string | null }>(
    'select email,name from bolna_app_users where email=any($1::text[])', [people],
  )).rows;
  const names: Record<string, string | null> = Object.fromEntries(users.map(user => [user.email, user.name]));
  return { assignment, batch, members, names };
}

export type AssignmentBatchPreview = Awaited<ReturnType<typeof assignmentBatchPreview>>;
