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
  addedToDb?: boolean;
  whId?: string | null;
  state?: AssignmentState;
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
  added_to_db: boolean;
  wh_id: string | null;
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
  if ("addedToDb" in patch) { vals.push(!!patch.addedToDb); sets.push(`added_to_db = $${vals.length}`); }
  if ("whId" in patch) { vals.push(patch.whId || null); sets.push(`wh_id = $${vals.length}`); }
  if (patch.state) {
    vals.push(patch.state);
    sets.push(`state = $${vals.length}`);
    // completed_at tracks when work stopped, for either terminal state.
    sets.push(`completed_at = case when $${vals.length} = 'open' then null else now() end`);
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
      returning id, state, outcome, remarks, added_to_db, wh_id`,
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

// ---------------------------------------------------------------------------
// Admin assignment history: one place to answer "who did I give this to, and
// what happened?" — across both channels, including finished and dropped work.
// ---------------------------------------------------------------------------

export type AssignmentHistoryRow = {
  id: string;                    // bigint -> string
  entity_type: "record" | "call";
  entity_id: string;
  subject: string | null;        // owner name (record) or the number's owner (call)
  phone: string | null;
  city: string | null;
  assignee: string;
  assignee_name: string | null;
  assigned_by: string;
  assigned_at: string;
  note: string | null;
  state: string;
  outcome: string | null;
  remarks: string | null;
  added_to_db: boolean;
  wh_id: string | null;
  completed_at: string | null;
  ai_availability: string | null; // what the AI channel found, for comparison
};

export type HistoryFilters = {
  q?: string;
  assignee?: string;
  state?: string;         // open | done | dropped
  entity_type?: string;   // record | call
  outcome?: string;
  page?: number;
  pageSize?: number;
};

export const HISTORY_PAGE_SIZE = 50;

// entity_id is polymorphic, so each side is joined on its own type guard. The
// `and a.entity_type = '...'` in the join condition (not the WHERE) is what keeps
// a record row from matching a call id and vice versa.
const HISTORY_FROM = `
  from bolna_assignments a
  left join bolna_app_users u on u.email = a.assignee
  left join raw_records r
         on a.entity_type = 'record' and r.id = a.entity_id
  left join bolna_call_logs cl
         on a.entity_type = 'call'   and cl.id = a.entity_id
  left join lateral (
    select pp.phone from raw_phones rp
      join raw_phone_numbers pp on pp.phone_id = rp.phone_id
     where rp.master_id = r.id order by rp.is_primary desc limit 1
  ) rphone on true
  -- For a MANUAL assignment there is no call row to read a verdict from, but the
  -- number may well have been rung by the AI already — and "the human disagreed
  -- with the AI" is the most useful signal precisely on these rows. So pull the
  -- latest AI verdict across the listing's numbers.
  left join lateral (
    select cl2.llm_availability
      from raw_phones rp2
      join bolna_call_logs cl2 on cl2.phone_id = rp2.phone_id
     where rp2.master_id = r.id and nullif(btrim(cl2.llm_availability), '') is not null
     order by cl2.call_created_at desc nulls last limit 1
  ) rai on true`;

function historyWhere(f: HistoryFilters): { sql: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.assignee) { params.push(f.assignee.toLowerCase()); where.push(`a.assignee = $${params.length}`); }
  if (f.state) { params.push(f.state); where.push(`a.state = $${params.length}`); }
  if (f.entity_type) { params.push(f.entity_type); where.push(`a.entity_type = $${params.length}`); }
  if (f.outcome === "none") { where.push(`a.outcome is null`); }
  else if (f.outcome) { params.push(f.outcome); where.push(`a.outcome = $${params.length}`); }
  if (f.q?.trim()) {
    params.push(f.q.trim());
    const p = `$${params.length}`;
    where.push(`(coalesce(r.owner_name,'') ilike '%'||${p}||'%'
              or coalesce(r.city,'') ilike '%'||${p}||'%'
              or coalesce(a.assignee,'') ilike '%'||${p}||'%'
              or coalesce(a.remarks,'') ilike '%'||${p}||'%'
              or coalesce(cl.to_number,'') ilike '%'||${p}||'%'
              or coalesce(rphone.phone,'') ilike '%'||${p}||'%')`);
  }
  return { sql: where.length ? `where ${where.join(" and ")}` : "", params };
}

export async function listAssignments(f: HistoryFilters) {
  const { sql: whereSql, params } = historyWhere(f);
  const page = Math.max(1, f.page ?? 1);
  const pageSize = f.pageSize ?? HISTORY_PAGE_SIZE;

  const countRes = await query<{ n: string }>(
    `select count(*)::text n ${HISTORY_FROM} ${whereSql}`, params);
  const total = Number(countRes.rows[0].n);

  const rowsRes = await query<AssignmentHistoryRow>(
    `select a.id::text as id, a.entity_type, a.entity_id::text as entity_id,
            coalesce(r.owner_name, cl.context_details -> 'recipient_data' ->> 'name') as subject,
            coalesce(rphone.phone, cl.to_number) as phone,
            coalesce(r.city, initcap(cl.context_details -> 'recipient_data' ->> 'area')) as city,
            a.assignee, u.name as assignee_name, a.assigned_by,
            a.assigned_at::text as assigned_at, a.note, a.state, a.outcome, a.remarks,
            a.added_to_db, a.wh_id,
            a.completed_at::text as completed_at,
            coalesce(cl.llm_availability, rai.llm_availability) as ai_availability
       ${HISTORY_FROM} ${whereSql}
       order by a.assigned_at desc, a.id desc
       limit ${pageSize} offset ${(page - 1) * pageSize}`,
    params);

  return {
    rows: rowsRes.rows, total, page, pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Headline counts for the history page, over the WHOLE table (not the page). */
export async function assignmentTotals(): Promise<{ open: number; done: number; dropped: number; people: number }> {
  const res = await query<{ open: string; done: string; dropped: string; people: string }>(
    `select count(*) filter (where state = 'open')::text     as open,
            count(*) filter (where state = 'done')::text     as done,
            count(*) filter (where state = 'dropped')::text  as dropped,
            count(distinct assignee) filter (where state = 'open')::text as people
       from bolna_assignments`);
  const r = res.rows[0];
  return { open: Number(r.open), done: Number(r.done), dropped: Number(r.dropped), people: Number(r.people) };
}
