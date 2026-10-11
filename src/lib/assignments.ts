import { categoryWhere, filterValues, type FilterValue } from "./filter-values";
import { ApiError } from "./api";
import { query, transaction } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth";
import { type EntityType, type Outcome, type AssignmentState } from "@/lib/scope";

// Write layer for assignments. Reads go through the two grid filter builders
// (lib/calls.ts, lib/raw.ts) so the employee scope is applied in exactly one place.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export { ASSIGN_CAP, assignEntities, type AssignSummary } from "./assignment-allocation";

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
  closure_reason?: "resolved" | "escalated" | "invalid_number_verified" | "exhausted" | null;
  state?: AssignmentState;
  revision: number;
};

/**
 * Update one assignment. Ownership is enforced IN THE UPDATE (not as a pre-check),
 * Ownership and revision are checked together; stale/inaccessible writes conflict.
 * Admins bypass ownership but still supply the expected revision.
 */
export type AssignmentRow = {
  revision: number;
  id: string;          // bigint → pg returns a string
  state: string;
  outcome: string | null;
  remarks: string | null;
  added_to_db: boolean;
  wh_id: string | null;
  closure_reason: string | null;
  disposition: string | null;
  next_due_at: string | null;
  last_attempt_at: string | null;
};

export async function updateAssignment(
  id: string,
  user: CurrentUser,
  patch: AssignmentPatch,
): Promise<AssignmentRow | null> {
  if (patch.state === "dropped" && !user.isAdmin) throw new ApiError(403, "Only admins can unassign work");
  return transaction(async client => {
  if (patch.state === 'open') await client.query("select pg_advisory_xact_lock(81620404)");
  await client.query("select set_config('bolna.actor',$1,true)",[user.email.toLowerCase()]);
  const current=(await client.query<AssignmentRow>(`select * from bolna_assignments where id=$1 and state<>'dropped'
    and ($2::boolean or assignee=$3) and revision=$4 for update`,[id,user.isAdmin,user.email.toLowerCase(),patch.revision])).rows[0];
  if(!current)throw new ApiError(409,"Assignment changed or is no longer editable. Refresh to review the latest version.");
  const proposed={...current,...("state" in patch?{state:patch.state}:{}),
    ...("outcome" in patch?{outcome:patch.outcome??null}:{}),...("remarks" in patch?{remarks:patch.remarks??null}:{}),
    ...("whId" in patch?{wh_id:patch.whId?.trim()||null}:{}),...("addedToDb" in patch?{added_to_db:patch.addedToDb}:{}),
    ...("closure_reason" in patch?{closure_reason:patch.closure_reason??null}:{})};
  if (patch.whId?.trim() && patch.whId.trim()!==current.wh_id?.trim() && !(await client.query('select bolna_valid_warehouse($1) valid',[patch.whId])).rows[0].valid)
    throw new ApiError(422,'Warehouse ID must be a positive integer.','INVALID_WAREHOUSE_ID','wh_id');
  const completionChanged=current.state!==proposed.state || current.outcome!==proposed.outcome
    || current.wh_id!==proposed.wh_id || current.remarks!==proposed.remarks || current.closure_reason!==proposed.closure_reason;
  if(proposed.state==='done' && completionChanged){
    const issue=(await client.query<{issue:{message:string;code:string;field:string}|null}>("select bolna_completion_issue($1,$2,$3,$4,$5,$6,$7) issue",
      [id,proposed.state,proposed.outcome,proposed.wh_id,proposed.remarks,proposed.closure_reason,current.state!=='done'])).rows[0].issue;
    if(issue)throw new ApiError(422,issue.message,issue.code,issue.field);
  }
  const res=await client.query<AssignmentRow>(`update bolna_assignments set state=$2,outcome=$3,remarks=$4,wh_id=$5,added_to_db=$6,closure_reason=$7,
    outcome_attempt_id=case when $8 then null else outcome_attempt_id end,
    completed_at=case when $2='open' then null when state<>$2 then now() else completed_at end,revision=revision+1
    where id=$1 returning *`,[id,proposed.state,proposed.outcome,proposed.remarks,proposed.wh_id,proposed.added_to_db,proposed.closure_reason,"outcome" in patch]);
  return res.rows[0] ?? null;
  });
}

/** Unassign (admin): close the open assignment without recording an outcome. */
export async function dropAssignment(id: string, actor: string | null = null): Promise<boolean> {
  return transaction(async client => {
  await client.query("select pg_advisory_xact_lock(81620404)");
  await client.query("select set_config('bolna.actor',$1,true)",[actor||""]);
  const res = await client.query(
    `update bolna_assignments set state = 'dropped', completed_at = now(), revision = revision + 1
      where id = $1 and state = 'open'`,
    [id],
  );
  return (res.rowCount ?? 0) > 0;
  });
}

// ---------------------------------------------------------------------------
// Admin assignment history: one place to answer "who did I give this to, and
// what happened?" — across both channels, including finished and dropped work.
// ---------------------------------------------------------------------------

export type AssignmentHistoryRow = {
  revision: number;
  id: string;                    // bigint -> string
  entity_type: "record" | "call";
  entity_id: string;
  subject: string | null;        // owner name (record) or the number's owner (call)
  phone: string | null;
  city: string | null;
  assignee: string;
  assignee_name: string | null;
  assigned_by: string;
  assigned_by_name: string | null;
  assigned_at: string;
  note: string | null;
  state: string;
  outcome: string | null;
  remarks: string | null;
  added_to_db: boolean;
  wh_id: string | null;
  closure_reason: string | null;
  disposition: string | null;
  next_due_at: string | null;
  last_attempt_at: string | null;
  completed_at: string | null;
  ai_availability: string | null; // what the AI channel found, for comparison
};

export type HistoryFilters = {
  entity_id?: string;
  batch_id?: string;
  activeOnly?: boolean;
  follow_up?: "pending" | "due";
  quality_review?: boolean;
  q?: string;
  assignee?: FilterValue;
  state?: FilterValue;         // open | done | dropped
  entity_type?: FilterValue;   // record | call
  outcome?: FilterValue;
  city?: string;
  assigned_by?: string;
  added_to_db?: "yes" | "no";
  sort?: "oldest" | "name";
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
  left join bolna_app_users assigner on assigner.email = a.assigned_by
  left join raw_records r
         on a.entity_type = 'record' and r.id = a.entity_id
  left join bolna_call_logs cl
         on a.entity_type = 'call'   and cl.id = a.entity_id
  left join lateral (
    select pp.phone from raw_phones rp
      join raw_phone_numbers pp on pp.phone_id = rp.phone_id
     where rp.master_id = r.id and nullif(trim(pp.phone), '') is not null order by rp.is_primary desc limit 1
  ) rphone on true
  -- For a MANUAL assignment there is no call row to read a verdict from, but the
  -- number may well have been rung by the AI already — and "the human disagreed
  -- with the AI" is the most useful signal precisely on these rows. So pull the
  -- latest AI verdict across the listing's numbers.
  left join lateral (
    select bolna_availability(cl2.status, cl2.llm_availability) as llm_availability
      from raw_phones rp2
      join bolna_call_logs cl2 on cl2.phone_id = rp2.phone_id
     where rp2.master_id = r.id
     order by cl2.call_created_at desc nulls last limit 1
  ) rai on true`;

function historyWhere(viewer: import("./scope").Viewer, f: HistoryFilters): { sql: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (!viewer.isAdmin) {
    params.push(viewer.email.toLowerCase());
    where.push(`a.assignee = $${params.length}`);
  }
  if (f.batch_id) { if (!UUID_RE.test(f.batch_id)) throw new ApiError(400,"Invalid batch ID"); params.push(f.batch_id); where.push(`a.batch_id = $${params.length}`); }
  if (f.entity_id) { params.push(f.entity_id); where.push(`a.entity_id = $${params.length}`); }
  if (f.follow_up) where.push(`a.state='open' and a.disposition=any(bolna_retry_dispositions())${f.follow_up==='due'?" and (a.next_due_at is null or a.next_due_at<=now())":""}`);
  if (f.quality_review) where.push("a.id in (select id from bolna_assignment_quality_review)");
  if (f.activeOnly) where.push(`a.state <> 'dropped'`);
  for (const [column, value] of [["a.assignee",filterValues(f.assignee).map(v=>v.toLowerCase())],["a.state",f.state],["a.entity_type",f.entity_type],["a.outcome",f.outcome]] as const) {
    const predicate=categoryWhere(column,value,params,column==="a.outcome"?"none":undefined);
    if(predicate)where.push(predicate);
  }
  if (f.assigned_by) { params.push(f.assigned_by.toLowerCase()); where.push(`a.assigned_by = $${params.length}`); }
  if (f.city?.trim()) { params.push(f.city.trim()); where.push(`coalesce(r.city, cl.context_details -> 'recipient_data' ->> 'area', '') ilike '%' || $${params.length} || '%'`); }
  if (f.added_to_db) { params.push(f.added_to_db === "yes"); where.push(`a.added_to_db = $${params.length}`); }
  if (f.q?.trim()) {
    params.push(f.q.trim());
    const p = `$${params.length}`;
    where.push(`(coalesce(r.owner_name,'') ilike '%'||${p}||'%'
              or coalesce(cl.context_details -> 'recipient_data' ->> 'name','') ilike '%'||${p}||'%'
              or coalesce(r.city,'') ilike '%'||${p}||'%'
              or coalesce(a.assignee,'') ilike '%'||${p}||'%'
              or coalesce(u.name,'') ilike '%'||${p}||'%'
              or coalesce(a.remarks,'') ilike '%'||${p}||'%'
              or coalesce(a.note,'') ilike '%'||${p}||'%'
              or coalesce(cl.to_number,'') ilike '%'||${p}||'%'
              or coalesce(rphone.phone,'') ilike '%'||${p}||'%')`);
  }
  return { sql: where.length ? `where ${where.join(" and ")}` : "", params };
}

export async function listAssignments(viewer: import("./scope").Viewer, f: HistoryFilters) {
  const { sql: whereSql, params } = historyWhere(viewer, f);
  const requestedPage = Number.isFinite(f.page) ? Math.max(1, Math.floor(f.page!)) : 1;
  const pageSize = Number.isFinite(f.pageSize) ? Math.max(1, Math.min(100, Math.floor(f.pageSize!))) : HISTORY_PAGE_SIZE;

  const countRes = await query<{ n: string }>(
    `select count(*)::text n ${HISTORY_FROM} ${whereSql}`, params);
  const total = Number(countRes.rows[0].n);
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));

  const rowsRes = await query<AssignmentHistoryRow>(
    `select a.revision, a.id::text as id, a.entity_type, a.entity_id::text as entity_id,
            coalesce(r.owner_name, cl.context_details -> 'recipient_data' ->> 'name') as subject,
            coalesce(rphone.phone, case when cl.call_type = 'inbound' then cl.from_number else cl.to_number end) as phone,
            coalesce(r.city, initcap(cl.context_details -> 'recipient_data' ->> 'area')) as city,
            a.assignee, u.name as assignee_name, a.assigned_by, assigner.name as assigned_by_name,
            a.assigned_at::text as assigned_at, a.note, a.state, a.outcome, a.remarks,
            a.added_to_db, a.wh_id, a.closure_reason, a.disposition, a.next_due_at::text, a.last_attempt_at::text,
            a.completed_at::text as completed_at,
            case when cl.id is not null then bolna_availability(cl.status, cl.llm_availability) else rai.llm_availability end as ai_availability
       ${HISTORY_FROM} ${whereSql}
       order by ${f.activeOnly ? "(a.state = 'open') desc," : ""} ${f.sort === "name" ? "lower(coalesce(r.owner_name, cl.context_details -> 'recipient_data' ->> 'name', '')) asc," : ""} a.assigned_at ${f.sort === "oldest" ? "asc" : "desc"}, a.id ${f.sort === "oldest" ? "asc" : "desc"}
       limit ${pageSize} offset ${(page - 1) * pageSize}`,
    params);

  return {
    rows: rowsRes.rows, total, page, pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Counts use the same predicates as the rows, across every matching page. */
export async function matchingAssignmentTotals(viewer: import("./scope").Viewer, filters: HistoryFilters) {
  const { sql, params } = historyWhere(viewer, filters);
  return (await query<{ entity_type: string; state: string; n: string }>(
    `select a.entity_type, a.state, count(*)::text n ${HISTORY_FROM} ${sql} group by a.entity_type, a.state`, params,
  )).rows;
}

/** Headline counts for the history page, over the WHOLE table (not the page). */
export async function assignmentTotals(viewer: import("./scope").Viewer, assignee?: FilterValue): Promise<{ open: number; done: number; dropped: number; people: number }> {
  if (!viewer.isAdmin) assignee = viewer.email;
  const people=filterValues(assignee).map(v=>v.toLowerCase());
  const res = await query<{ open: string; done: string; dropped: string; people: string }>(
    `select count(*) filter (where state = 'open')::text     as open,
            count(*) filter (where state = 'done')::text     as done,
            count(*) filter (where state = 'dropped')::text  as dropped,
            count(distinct assignee) filter (where state = 'open')::text as people
       from bolna_assignments${people.length ? " where assignee = any($1::text[])" : ""}`, people.length ? [people] : []);
  const r = res.rows[0];
  return { open: Number(r.open), done: Number(r.done), dropped: Number(r.dropped), people: Number(r.people) };
}
