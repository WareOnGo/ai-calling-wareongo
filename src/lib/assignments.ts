import { query } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth";
import { type EntityType, type Outcome, type AssignmentState } from "@/lib/scope";

// Write layer for assignments. Reads go through the two grid filter builders
// (lib/calls.ts, lib/raw.ts) so the employee scope is applied in exactly one place.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Safety ceiling on a single bulk assign. Matches lib/raw.ts's QUEUE_CAP: the
// biggest realistic city slice is a couple of thousand rows.
export const ASSIGN_CAP = 20000;

export type AssignSummary = {
  requested: number;   // ids given (after uuid validation)
  assigned: number;    // new open assignments created
  reassigned: number;  // previously-open assignments closed to make way
  skipped: number;     // already open — left with their current owner
  capped: boolean;
};

export function validIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return ids.filter((x): x is string => typeof x === "string" && UUID_RE.test(x));
}

/**
 * Assign a set of entities to one person.
 *
 * Exclusive by design (uq_bolna_assignments_open): an entity has at most one open owner.
 * With `reassign` false the already-owned rows are SKIPPED and counted, rather than
 * silently stealing them — the caller reports the number back, the same way the
 * dispatch flow reports rows it held back.
 */
export async function assignEntities(opts: {
  entity: EntityType;
  ids: string[];
  assignee: string;
  assignedBy: string;
  note?: string | null;
  reassign?: boolean;
}): Promise<AssignSummary> {
  const capped = opts.ids.length > ASSIGN_CAP;
  const ids = capped ? opts.ids.slice(0, ASSIGN_CAP) : opts.ids;
  const assignee = opts.assignee.toLowerCase();
  if (ids.length === 0) {
    return { requested: 0, assigned: 0, reassigned: 0, skipped: 0, capped };
  }

  let reassigned = 0;
  if (opts.reassign) {
    // Close open assignments held by SOMEONE ELSE. Rows already owned by this
    // assignee are left alone so re-running doesn't churn their state/attempts.
    const dropped = await query<{ entity_id: string }>(
      `update bolna_assignments set state = 'dropped', completed_at = now()
        where entity_type = $1 and entity_id = any($2::uuid[])
          and state = 'open' and assignee <> $3
        returning entity_id`,
      [opts.entity, ids, assignee],
    );
    reassigned = dropped.rowCount ?? 0;
  }

  // Partial-index inference: the ON CONFLICT target must repeat uq_bolna_assignments_open's
  // WHERE clause. Inserted rows always default to state='open', so it always applies.
  const inserted = await query<{ entity_id: string }>(
    `insert into bolna_assignments (entity_type, entity_id, assignee, assigned_by, note)
     select $1, x, $2, $3, $4 from unnest($5::uuid[]) x
     on conflict (entity_type, entity_id) where state = 'open' do nothing
     returning entity_id`,
    [opts.entity, assignee, opts.assignedBy.toLowerCase(), opts.note || null, ids],
  );
  const assigned = inserted.rowCount ?? 0;

  return { requested: ids.length, assigned, reassigned, skipped: ids.length - assigned, capped };
}

/**
 * Does this user have access to a single entity? True for admins. Used by the
 * per-row action routes that operate on one id and can't route through a filter
 * builder (e.g. re-running inference on one call).
 */
export async function ownsEntity(
  user: CurrentUser,
  entity: EntityType,
  entityId: string,
): Promise<boolean> {
  if (user.isAdmin) return true;
  if (!UUID_RE.test(entityId)) return false;
  const res = await query(
    `select 1 from bolna_assignments
      where entity_type = $1 and entity_id = $2 and assignee = $3
        and state <> 'dropped' limit 1`,
    [entity, entityId, user.email.toLowerCase()],
  );
  return (res.rowCount ?? 0) > 0;
}

export type AssignmentPatch = {
  outcome?: Outcome | null;
  remarks?: string | null;
  state?: AssignmentState;
  logAttempt?: boolean;   // bump attempts + last_attempt_at ("I tried calling")
};

/**
 * Update one assignment. Ownership is enforced IN THE UPDATE (not as a pre-check),
 * so a non-owner gets rowCount 0 → 404 with no TOCTOU window. Admins bypass.
 * Returns null when the row doesn't exist or isn't the caller's.
 */
export type AssignmentRow = {
  id: string;          // bigint → pg returns a string
  state: string;
  outcome: string | null;
  remarks: string | null;
  attempts: number;    // int4 → a real number
};

export async function updateAssignment(
  id: number,
  user: CurrentUser,
  patch: AssignmentPatch,
): Promise<AssignmentRow | null> {
  const sets: string[] = [];
  const vals: unknown[] = [];

  if ("outcome" in patch) { vals.push(patch.outcome ?? null); sets.push(`outcome = $${vals.length}`); }
  if ("remarks" in patch) { vals.push(patch.remarks ?? null); sets.push(`remarks = $${vals.length}`); }
  if (patch.state) {
    vals.push(patch.state);
    sets.push(`state = $${vals.length}`);
    // completed_at tracks when work stopped, for either terminal state.
    sets.push(`completed_at = case when $${vals.length} = 'open' then null else now() end`);
  }
  if (patch.logAttempt) {
    sets.push(`attempts = attempts + 1`);
    sets.push(`last_attempt_at = now()`);
  }
  if (sets.length === 0) return null;

  vals.push(id);
  const idParam = `$${vals.length}`;
  let ownership = "";
  if (!user.isAdmin) {
    vals.push(user.email.toLowerCase());
    ownership = ` and assignee = $${vals.length}`;
  }

  const res = await query<AssignmentRow>(
    `update bolna_assignments set ${sets.join(", ")}
      where id = ${idParam}${ownership}
      returning id, state, outcome, remarks, attempts`,
    vals,
  );
  return res.rows[0] ?? null;
}

/** Unassign (admin): close the open assignment without recording an outcome. */
export async function dropAssignment(id: number): Promise<boolean> {
  const res = await query(
    `update bolna_assignments set state = 'dropped', completed_at = now()
      where id = $1 and state = 'open'`,
    [id],
  );
  return (res.rowCount ?? 0) > 0;
}
