import { warehouseWhere, dateRangeWhere, hasText } from "./filter-values";
import { aiAttemptsExistSql, aiAttemptSummarySql, type AiAttemptSummary } from "./ai-summary";
import { warehouseIdsSql, warehouseMatchSql } from './warehouse-contacts';
import { categoryWhere, filterValues, type FilterValue } from "./filter-values";
import { ApiError } from "./api";
import { query, transaction } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth";
import { contactTargets, type EntityType, type Outcome, type AssignmentState } from "@/lib/scope";
import { ASSIGNMENT_SOURCE_JOIN as HISTORY_SOURCE, ASSIGNMENT_CITY as HISTORY_CITY, ASSIGNMENT_REGION as HISTORY_REGION, ASSIGNMENT_SUBJECT as HISTORY_SUBJECT } from './assignment-context';

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
  const current=(await client.query<AssignmentRow & {entity_type:EntityType;entity_id:string}>(`select * from bolna_assignments where id=$1 and state<>'dropped'
    and ($2::boolean or assignee=$3) and revision=$4 for update`,[id,user.isAdmin,user.email.toLowerCase(),patch.revision])).rows[0];
  if(!current)throw new ApiError(409,"Assignment changed or is no longer editable. Refresh to review the latest version.");
  // The shared legacy deployment can leave the ownership trigger disabled.
  // Enforce reopening here, under the same lock used by assignment allocation.
  if(patch.state==='open' && current.state!=='open') {
    const registered=await client.query('select 1 from bolna_warehouse_matches where entity_type=$1 and entity_id=$2 limit 1',[current.entity_type,current.entity_id]);
    if(registered.rowCount)throw new ApiError(409,'This number has a warehouse already added to DB and cannot be reopened.','WAREHOUSE_ALREADY_ADDED');
    const owner=await client.query(`select 1 from (${contactTargets('$1::text','$2::uuid')}) contacts
      join bolna_assignments a using(entity_type,entity_id)
      where a.state='open' and a.id<>$3::bigint limit 1`,[current.entity_type,current.entity_id,id]);
    if(owner.rowCount)throw new ApiError(409,'This phone number already has open work. Ask an admin to reassign it before reopening.');
  }
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
  warehouse_ids: number[];
  work_context?: { owner_name: string | null; city: string | null; area_sqft: string | null; built_up_area_sqft: string | null; carpet_area_sqft: string | null; rent: string | null };
  ai_summary: AiAttemptSummary;
  batch_id: string | null;
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
  ai_comparable: boolean;
};

export type HistoryFilters = {
  warehouse_match?: "yes" | "no";
  assignment_id?: string;
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
  region?: string;
  comparison?: "mismatch";
  assigned_by?: FilterValue;
  ai_result?: FilterValue; has_ai_calls?: "yes" | "no"; manual_disposition?: FilterValue;
  completed_from?: string; completed_to?: string;
  wh_id?: string; has_notes?: "yes" | "no"; has_manual_calls?: "yes" | "no";
  date_from?: string; date_to?: string;
  added_to_db?: "yes" | "no";
  sort?: "oldest" | "name";
  page?: number;
  pageSize?: number;
};

export const HISTORY_PAGE_SIZE = 50;

// entity_id is polymorphic, so each side is joined on its own type guard. The
// `and a.entity_type = '...'` in the join condition (not the WHERE) is what keeps
// a record row from matching a call id and vice versa.
const HISTORY_AI_RESULT = "case when cl.id is not null then bolna_availability(cl.status, cl.llm_availability) else rai.llm_availability end";
const HISTORY_COMPARABLE_AI = "a.entity_type='call' and cl.status in ('completed','call-disconnected') and trim(cl.llm_availability) in ('Available','Unavailable','Unclear')";
const HISTORY_ENTITIES = `
  left join raw_records r
         on a.entity_type = 'record' and r.id = a.entity_id
  left join bolna_call_logs cl
         on a.entity_type = 'call'   and cl.id = a.entity_id`;
const HISTORY_PHONE = `
  left join lateral (
    select pp.phone from raw_phones rp
      join raw_phone_numbers pp on pp.phone_id = rp.phone_id
     where rp.master_id = r.id and nullif(trim(pp.phone), '') is not null order by rp.is_primary desc limit 1
  ) rphone on true`;
// A record assignment can still have AI calls across its linked numbers.
const HISTORY_AI = `left join lateral (
    select bolna_availability(cl2.status, cl2.llm_availability) as llm_availability
      from raw_phones rp2
      join bolna_call_logs cl2 on cl2.phone_id = rp2.phone_id
     where rp2.master_id = r.id and cl2.status is distinct from 'balance-low'
     order by cl2.call_created_at desc nulls last, cl2.id desc limit 1
  ) rai on true`;
const HISTORY_FROM = `from bolna_assignments a
  left join bolna_app_users u on u.email = a.assignee
  left join bolna_app_users assigner on assigner.email = a.assigned_by
  ${HISTORY_ENTITIES} ${HISTORY_SOURCE} ${HISTORY_PHONE} ${HISTORY_AI}`;

// Counts and page selection only need joins referenced by their predicates.
// Display-only phone/result lookups otherwise run once for every assignment.
function historyFilterFrom(f: HistoryFilters, ordering = false) {
  const search = !!f.q?.trim(), ai = filterValues(f.ai_result).length > 0;
  const location = !!f.city?.trim() || !!f.region?.trim();
  const source = location || search || ordering && f.sort === 'name';
  return `from bolna_assignments a
    ${search ? 'left join bolna_app_users u on u.email=a.assignee' : ''}
    ${search || ai || location || f.comparison || ordering && f.sort === 'name' ? HISTORY_ENTITIES : ''}
    ${source ? HISTORY_SOURCE : ''}
    ${search ? HISTORY_PHONE : ''} ${ai ? HISTORY_AI : ''}`;
}

function historyWhere(viewer: import("./scope").Viewer, f: HistoryFilters): { sql: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (!viewer.isAdmin) {
    params.push(viewer.email.toLowerCase());
    where.push(`a.assignee = $${params.length}`);
  }
  if (f.batch_id) { if (!UUID_RE.test(f.batch_id)) throw new ApiError(400,"Invalid batch ID"); params.push(f.batch_id); where.push(`a.batch_id = $${params.length}`); }
  if (f.assignment_id) { params.push(f.assignment_id); where.push(`a.id = $${params.length}::bigint`); }
  if (f.entity_id) { params.push(f.entity_id); where.push(`a.entity_id = $${params.length}`); }
  if (f.follow_up) where.push(`a.state='open' and a.disposition=any(bolna_retry_dispositions())${f.follow_up==='due'?" and (a.next_due_at is null or a.next_due_at<=now())":""}`);
  if (f.quality_review) where.push("a.id in (select id from bolna_assignment_quality_review)");
  // Only the exact assigned AI execution is comparable. A shared phone can
  // describe another property; missing or operational results are not mismatches.
  if (f.comparison === 'mismatch') where.push(`(${HISTORY_COMPARABLE_AI})
    and a.outcome in ('Available','Unavailable','Unclear')
    and a.outcome <> trim(cl.llm_availability)`);
  if (f.activeOnly) where.push(`a.state <> 'dropped'`);
  for (const [column, value] of [["a.assignee",filterValues(f.assignee).map(v=>v.toLowerCase())],["a.state",f.state],["a.entity_type",f.entity_type],["a.outcome",f.outcome]] as const) {
    const predicate=categoryWhere(column,value,params,column==="a.outcome"?"none":undefined);
    if(predicate)where.push(predicate);
  }
  const assigner = categoryWhere('a.assigned_by', filterValues(f.assigned_by).map(value => value.toLowerCase()), params);
  if (assigner) where.push(assigner);
  const ai = categoryWhere(`(${HISTORY_AI_RESULT})`, f.ai_result, params, 'none');
  if (ai) where.push(ai);
  const disposition=categoryWhere('a.disposition',f.manual_disposition,params,'none'); if(disposition)where.push(disposition);
  if(f.has_ai_calls)where.push(`${f.has_ai_calls==='no'?'not ':''}(case when a.entity_type='record' then ${aiAttemptsExistSql('record','a.entity_id')} else ${aiAttemptsExistSql('call','a.entity_id')} end)`);
  if(f.completed_from || f.completed_to) {
    where.push("a.state='done'");
    where.push(...dateRangeWhere('a.completed_at',f.completed_from,f.completed_to,params));
  }
  if (f.wh_id) {
    const recorded=warehouseWhere('a.wh_id', f.wh_id, params);
    where.push(`(${recorded} or exists(select 1 from bolna_warehouse_matches w where w.entity_type=a.entity_type and w.entity_id=a.entity_id and w.warehouse_id::text=$${params.length}))`);
  }
  if(f.warehouse_match)where.push(`${f.warehouse_match==='no'?'not ':''}${warehouseMatchSql('a.entity_type','a.entity_id')}`);
  if (f.has_notes) where.push(`${f.has_notes === 'no' ? 'not ' : ''}(${hasText('a.remarks')})`);
  if (f.has_manual_calls) where.push(`${f.has_manual_calls === 'no' ? 'not ' : ''}exists(select 1 from bolna_effective_manual_attempts e where e.assignment_id=a.id)`);
  where.push(...dateRangeWhere('a.assigned_at', f.date_from, f.date_to, params));
  if (f.city?.trim()) { params.push(f.city.trim().replace(/[\\%_]/g, '\\$&')); where.push(`${HISTORY_CITY} ilike '%' || $${params.length} || '%'`); }
  if (f.region?.trim()) { params.push(f.region.trim().replace(/[\\%_]/g, '\\$&')); where.push(`${HISTORY_REGION} ilike '%' || $${params.length} || '%'`); }
  if (f.added_to_db) { params.push(f.added_to_db === "yes"); where.push(`a.added_to_db = $${params.length}`); }
  if (f.q?.trim()) {
    params.push(f.q.trim());
    const p = `$${params.length}`;
    where.push(`(coalesce(${HISTORY_SUBJECT},'') ilike '%'||${p}||'%'
              or coalesce(${HISTORY_CITY},'') ilike '%'||${p}||'%'
              or coalesce(a.assignee,'') ilike '%'||${p}||'%'
              or coalesce(u.name,'') ilike '%'||${p}||'%'
              or coalesce(a.remarks,'') ilike '%'||${p}||'%'
              or coalesce(a.note,'') ilike '%'||${p}||'%'
              or coalesce(case when cl.call_type='inbound' then cl.from_number else cl.to_number end,'') ilike '%'||${p}||'%'
              or coalesce(rphone.phone,'') ilike '%'||${p}||'%')`);
  }
  return { sql: where.length ? `where ${where.join(" and ")}` : "", params };
}

/** The same criteria power table rows and the all-matching bulk selection. */
export function assignmentSelectionQuery(viewer: import("./scope").Viewer, filters: HistoryFilters, ids?: string[]) {
  const {sql,params}=historyWhere(viewer,filters);
  if(ids)params.push(ids);
  return {sql:`select a.id::text, a.entity_type, a.entity_id, a.assignee, a.state, a.revision
    ${historyFilterFrom(filters)} ${sql}${ids?`${sql?' and':'where'} a.id=any($${params.length}::bigint[])`:''}`,params};
}

export async function listAssignments(viewer: import("./scope").Viewer, f: HistoryFilters, { workContext = false }: { workContext?: boolean } = {}) {
  const { sql: whereSql, params } = historyWhere(viewer, f);
  const requestedPage = Number.isFinite(f.page) ? Math.max(1, Math.floor(f.page!)) : 1;
  const pageSize = Number.isFinite(f.pageSize) ? Math.max(1, Math.min(100, Math.floor(f.pageSize!))) : HISTORY_PAGE_SIZE;

  const countRes = await query<{ n: string }>(
    `select count(*)::text n ${historyFilterFrom(f)} ${whereSql}`, params);
  const total = Number(countRes.rows[0].n);
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));

  const order = `${f.activeOnly ? "(a.state = 'open') desc," : ""} ${f.sort === "name" ? `lower(coalesce(${HISTORY_SUBJECT}, '')) asc,` : ""} a.assigned_at ${f.sort === "oldest" ? "asc" : "desc"}, a.id ${f.sort === "oldest" ? "asc" : "desc"}`;
  const rowsRes = await query<AssignmentHistoryRow>(
    `with page_assignments as materialized (
       select a.* ${historyFilterFrom(f, true)} ${whereSql}
       order by ${order} limit ${pageSize} offset ${(page - 1) * pageSize}
     )
     select ${warehouseIdsSql('a.entity_type', 'a.entity_id')} as warehouse_ids,
            a.revision, a.id::text as id, a.batch_id::text, a.entity_type, a.entity_id::text as entity_id,
            ${HISTORY_SUBJECT} as subject,
            coalesce(rphone.phone, case when cl.call_type = 'inbound' then cl.from_number else cl.to_number end) as phone,
            ${HISTORY_CITY} as city,
            a.assignee, u.name as assignee_name, a.assigned_by, assigner.name as assigned_by_name,
            a.assigned_at::text as assigned_at, a.note, a.state, a.outcome, a.remarks,
            a.added_to_db, a.wh_id, a.closure_reason, a.disposition, a.next_due_at::text, a.last_attempt_at::text,
            a.completed_at::text as completed_at,
            ${HISTORY_AI_RESULT} as ai_availability,
            coalesce((${HISTORY_COMPARABLE_AI}),false) as ai_comparable,
            case when a.entity_type='record' then
              (select row_to_json(ai) from (${aiAttemptSummarySql("record", "a.entity_id")}) ai)
            else (select row_to_json(ai) from (${aiAttemptSummarySql("call", "a.entity_id")}) ai) end as ai_summary
            ${workContext ? `, json_build_object(
              'owner_name', work_source.owner_name,
              'city', ${HISTORY_CITY},
              'area_sqft', coalesce(r.area_sqft::text,work_source.area_sqft::text),
              'built_up_area_sqft',cl.built_up_area_sqft,'carpet_area_sqft',cl.carpet_area_sqft,
              'rent',case when a.entity_type='record' then r.metadata->>'rent' else cl.expected_rent end) as work_context` : ''}
       ${HISTORY_FROM.replace('from bolna_assignments a', 'from page_assignments a')}
       order by ${order}`,
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
    `select a.entity_type, a.state, count(*)::text n ${historyFilterFrom(filters)} ${sql} group by a.entity_type, a.state`, params,
  )).rows;
}

/** Status breakdown within the other applied criteria (never just the current page). */
export async function assignmentTotals(viewer: import("./scope").Viewer, assignee?: FilterValue, filters: HistoryFilters = {}): Promise<{ open: number; done: number; dropped: number; people: number }> {
  const { sql, params } = historyWhere(viewer, { ...filters, assignee, state: undefined });
  const res = await query<{ open: string; done: string; dropped: string; people: string }>(
    `select count(*) filter (where a.state = 'open')::text as open,
            count(*) filter (where a.state = 'done')::text as done,
            count(*) filter (where a.state = 'dropped')::text as dropped,
            count(distinct a.assignee) filter (where a.state = 'open')::text as people
       ${historyFilterFrom(filters)} ${sql}`, params);
  const r = res.rows[0];
  return { open: Number(r.open), done: Number(r.done), dropped: Number(r.dropped), people: Number(r.people) };
}
