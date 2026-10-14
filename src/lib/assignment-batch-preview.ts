import { ApiError, bigintId } from './api';
import { listAssignments } from './assignments';
import { batchMembers, getBatch } from './batch-browser';
import { query } from './db';
import type { Viewer } from './scope';

export async function assignmentBatchPreview(viewer: Viewer, assignmentId: string, page = 1) {
  if (!viewer.isAdmin) throw new ApiError(403, 'forbidden');
  const id = bigintId.parse(assignmentId);
  const assignment = (await listAssignments(viewer, { assignment_id: id, pageSize: 1 })).rows[0];
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
