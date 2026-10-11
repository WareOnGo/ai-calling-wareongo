import {matchesCallSearch,rawSearch,matchesSearch} from "./search";
import {cityWhere} from "./filter-values";
import { categoryWhere,filterValues,type FilterValue } from "./filter-values";
import { ApiError } from "./api";
import { getDispatchAgents } from "./agents";
import { unstable_cache } from "next/cache";
import { query } from "@/lib/db";
import { MIN_COST_CENTS, ENABLE_ENRICHMENT } from "@/lib/inference";
import { INFERENCE_VERSION } from "@/lib/openai";
import { assignmentScope, currentAssignmentLateral, ownershipFilter,verificationFilters, type Viewer } from "@/lib/scope";

export type CallRow = {
  revision: number;
  id: string;
  agent_id: string | null;
  call_created_at: string | null;
  call_type: string | null;
  from_number: string | null;
  to_number: string | null;
  owner_name: string | null;
  db_area: string | null;
  status: string | null;
  availability: string | null;
  segment: string | null;
  confidence: string | null;
  built_up_area_sqft: string | null;
  carpet_area_sqft: string | null;
  expected_rent: string | null;
  notes: string | null;
  transcript: string | null;
  recording_url: string | null;
  needs_review: boolean;
  inferred: boolean;      // has OpenAI enrichment run on this call?
  can_enrich: boolean;    // qualifies for (re-)inference but isn't enriched at the current version
  // Retained legacy metadata; current manual work is stored on the assignment.
  call_status: string | null;
  called_by: string | null;      // legacy read-only metadata; actual manual attempts record actor separately
  added_to_db: boolean;
  wh_id: string | null;
  // current assignment (who owns the follow-up)
  assigned_to: string | null;
  assignment_assignee: string | null;
  assignment_revision:number|null;
  assignment_id: string | null;   // bigint → pg returns a string; used as a URL segment
  assignment_state: string | null;
  assignment_closure_reason: string | null;
  assignment_outcome: string | null;
  assignment_remarks: string | null;
  assignment_note: string | null;
  assignment_added_to_db: boolean | null;
  assignment_wh_id: string | null;
  manual_attempt_count:number|null;
  manual_disposition:string|null;
  manual_next_due_at:string|null;
  manual_last_attempt_at:string|null;
  // Representative matched listing (scalar columns) + count + full set.
  raw_match_count: number;
  raw_source: string | null;
  raw_owner_name: string | null;
  raw_warehouse_type: string | null;
  raw_city: string | null;
  source_cities:string|null;
  ai_attempt_count:number;ai_conversation_count:number;
  raw_state: string | null;
  raw_area_sqft: string | null;
  raw_contact_type: string | null;
  raw_sources: string | null;   // all distinct sources this number is listed in
  raw_matches: RawMatch[] | null;
};

export type RawMatch = {
  source: string | null;
  source_record_id: string | null;
  owner_name: string | null;
  warehouse_type: string | null;
  listing_status: string | null;
  area_sqft: number | null;
  address: string | null;
  city: string | null;
  state: string | null;
  contact_type: string | null;
  is_primary: boolean | null;
};

export type CallFilters = {
  ids?: string[];
  include_blocked?:boolean;batch_id?:string;
  q?: string;
  availability?: FilterValue;
  agent_id?: FilterValue;
  status?: FilterValue;
  source?: FilterValue;        // matched raw-dataset source
  state?: FilterValue;         // matched raw-dataset state
  contact?: FilterValue;       // "broker" | "owner"
  call_type?: FilterValue;     // "inbound" | "outbound"
  date_from?: string;     // YYYY-MM-DD (inclusive)
  date_to?: string;       // YYYY-MM-DD (inclusive)
  needs_review?: boolean;
  city?:string;min_area?:number;max_area?:number;area_basis?:"source"|"built_up"|"carpet";
  manual_outcome?:FilterValue;rent_mentioned?:"yes"|"no";onboarded?:"yes"|"no";
  assignment_state?: string;
  assignee?: FilterValue;      // admin-only: filter by owner ("none" = unassigned)
  page?: number;
  pageSize?: number;
};

// Columns the free-text search scans (substring) for highlighting + matching.


export const PAGE_SIZE = 25;

// "Enrichable" = the same gate the worker/bulk-enrich use (connected + cost + has
// transcript + not enriched at the current version), but against the view where the
// enriched flag is surfaced as `inferred`. Constants are server-side numbers → safe
// to inline; keep in sync with inference.ts NEEDS_INFERENCE_SQL.
const CAN_ENRICH_SQL = `(
  ${ENABLE_ENRICHMENT} and status in ('completed', 'call-disconnected')
  and total_cost > ${MIN_COST_CENTS}
  and length(trim(coalesce(transcript, ''))) > 0
  and (inferred = false or inference_version < ${INFERENCE_VERSION})
) as can_enrich`;

const SELECT_LIST = `(select revision from bolna_call_logs c where c.id = bolna_call_analysis.id) as revision, id, agent_id, call_created_at, call_type, from_number, to_number, owner_name, db_area,
       status, availability, segment, confidence, built_up_area_sqft, carpet_area_sqft, expected_rent,
       notes, transcript, recording_url, needs_review, inferred, ${CAN_ENRICH_SQL},
       call_status, called_by, added_to_db, wh_id,
       asg.current_assignee as assigned_to, asg.assignee as assignment_assignee, asg.assignment_id, asg.assignment_revision, asg.state as assignment_state, asg.outcome as assignment_outcome,
       asg.remarks as assignment_remarks, asg.note as assignment_note,
       coalesce(asg.asg_added,bolna_call_analysis.added_to_db) as assignment_added_to_db, case when asg.assignment_id is null then bolna_call_analysis.wh_id else asg.asg_wh end as assignment_wh_id,
       asg.closure_reason as assignment_closure_reason,asg.manual_attempt_count,asg.disposition as manual_disposition,asg.next_due_at::text as manual_next_due_at,asg.last_attempt_at::text as manual_last_attempt_at,
       raw_match_count, raw_source, raw_owner_name, raw_warehouse_type,
       raw_city, raw_state, raw_area_sqft, raw_contact_type, raw_sources,
       (select string_agg(distinct r.city,', ' order by r.city) from raw_phone_numbers p join raw_phones rp using(phone_id) join raw_records r on r.id=rp.master_id where p.phone_last10=bolna_call_analysis.phone_last10 and nullif(trim(r.city),'') is not null) as source_cities,
       (select count(*)::int from bolna_ai_attempts ai where ai.execution_id=bolna_call_analysis.id) as ai_attempt_count,
       (select count(*)::int from bolna_ai_attempts ai where ai.execution_id=bolna_call_analysis.id and ai.confirmed_conversation) as ai_conversation_count, raw_matches`;

// Build the WHERE clause + params shared by the paged list, the CSV export and the
// id resolver. `viewer` is FIRST and required so a new call site can't forget the
// employee scope — that scope is the only thing standing between an employee and
// every call in the system, and it has to be applied here to cover the export too.
function buildFilter(viewer: Viewer, f: CallFilters): { whereSql: string; params: unknown[]; terms: string[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  if(!f.include_blocked&&!filterValues(f.status).includes('balance-low'))where.push("status is distinct from 'balance-low'");
  if(f.batch_id){params.push(f.batch_id);where.push(`batch_id=$${params.length}`);}

  // Mandatory row-level scope (no-op for admins), before any user-supplied filter.
  const scope = assignmentScope(viewer, "call", "bolna_call_analysis.id", params);
  if (scope) where.push(scope);
  if (f.ids) { params.push(f.ids); where.push(`id = any($${params.length}::uuid[])`); }

  // Multi-term fuzzy search: every whitespace-separated term must match (substring
  // OR trigram-similar) at least one search column. Fuzzy = typo tolerance on names.
  const terms = (f.q ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 6);
  for (const term of terms) {
    params.push(term);
    const p = `$${params.length}`;
    where.push(`bolna_call_analysis.id in (
      select cs.id from bolna_call_logs cs where ${matchesCallSearch('cs',p)}
      union select cs.id from raw_records rs join raw_phones rp on rp.master_id=rs.id
       join raw_phone_numbers pp using(phone_id) join bolna_call_logs cs using(phone_last10)
       where ${matchesSearch(rawSearch('rs'),p)})`);
  }

  for(const [column,value] of [["availability",f.availability],["agent_id::text",f.agent_id],["status",f.status],["call_type",f.call_type]] as const){const clause=categoryWhere(column,value,params,column==='availability'?'none':undefined);if(clause)where.push(clause);}
  const listing:string[]=[];
  for(const [column,value] of [["r.source",f.source],["r.state",f.state]] as const){const clause=categoryWhere(column,value,params);if(clause)listing.push(clause);}
  if(f.city)listing.push(cityWhere("r.city",f.city,params));
  const contacts=filterValues(f.contact),contactChoices:string[]=[];
  if(contacts.includes('broker'))contactChoices.push("r.contact_type='probable broker'");
  if(contacts.includes('owner'))contactChoices.push("r.contact_type is null");
  if(contactChoices.length)listing.push(`(${contactChoices.join(' or ')})`);
  const measure=f.area_basis==='built_up'?'bolna_numeric_measure(built_up_area_sqft)':f.area_basis==='carpet'?'bolna_numeric_measure(carpet_area_sqft)':'r.area_sqft';
  for(const [value,op] of [[f.min_area,">="],[f.max_area,"<="]] as const)if(value!=null){params.push(value);(measure==='r.area_sqft'?listing:where).push(`${measure} ${op} $${params.length}`);}
  if(listing.length)where.push(`exists(select 1 from raw_phone_numbers p join raw_phones rp using(phone_id) join raw_records r on r.id=rp.master_id where p.phone_last10=bolna_call_analysis.phone_last10 and ${listing.join(' and ')})`);
  if(f.rent_mentioned)where.push(`${f.rent_mentioned==='no'?'not ':''}bolna_rent_mentioned(expected_rent)`);
  where.push(...verificationFilters('call','bolna_call_analysis.id',viewer,f,params));
  if (f.date_from) { params.push(f.date_from); where.push(`call_created_at >= ($${params.length}::date::timestamp at time zone 'Asia/Kolkata')`); }
  if (f.date_to) { params.push(f.date_to); where.push(`call_created_at < (($${params.length}::date + interval '1 day') at time zone 'Asia/Kolkata')`); }
  if (f.needs_review) { where.push(`needs_review = true`); }
  if (viewer.isAdmin) where.push(...ownershipFilter("call", "bolna_call_analysis.id", f, params));

  const whereSql = where.length ? `where ${where.join(" and ")}` : "";
  return { whereSql, params, terms };
}

// Small explicit selections for detail/personal-work views. CSV uses callsExportQuery.
export async function getCallDetailsByIds(viewer: Viewer, ids: string[]): Promise<CallRow[]> {
  if (!ids.length) return [];
  if (ids.length > 1000) throw new ApiError(400, "Too many detail IDs; use the export endpoint");
  const { whereSql, params } = buildFilter(viewer, { ids,include_blocked:true });
  const res = await query<CallRow>(
    `select ${SELECT_LIST} from bolna_call_analysis ${currentAssignmentLateral("call", "bolna_call_analysis.id", viewer, params)} ${whereSql}
       order by call_created_at desc nulls last, id`,
    params,
  );
  return res.rows;
}

// Just the ids matching the filters — the "assign everything that matches" path.
// Same builder, so the set is exactly what the grid shows.
export async function getCallIds(viewer: Viewer, f: CallFilters, cap: number): Promise<{ ids: string[]; capped: boolean }> {
  const { whereSql, params } = buildFilter(viewer, f);
  const res = await query<{ id: string }>(
    `select id from bolna_call_analysis ${whereSql}
       order by call_created_at desc nulls last, id limit ${cap + 1}`,
    params,
  );
  const ids = res.rows.map((r) => r.id);
  return ids.length > cap ? { ids: ids.slice(0, cap), capped: true } : { ids, capped: false };
}

export async function getCalls(viewer: Viewer, f: CallFilters) {
  const { whereSql, params, terms } = buildFilter(viewer, f);
  const requestedPage = Number.isFinite(f.page) ? Math.max(1, Math.floor(f.page!)) : 1;
  const pageSize = Number.isFinite(f.pageSize) ? Math.max(1, Math.min(100, Math.floor(f.pageSize!))) : PAGE_SIZE;

  // Evaluate expensive fuzzy/property filters once for both the count and page.
  // Materialize only IDs/timestamps; full transcripts and property JSON stay out.
  const countRes = await query<{ n: string; ids: string[] }>(
    `with matching as materialized (select id,call_created_at from bolna_call_analysis ${whereSql}),
      totals as (select count(*) n from matching)
     select n::text, array(select id from matching order by call_created_at desc nulls last,id
       limit ${pageSize} offset least(${requestedPage - 1},greatest(ceil(n::numeric/${pageSize})-1,0))*${pageSize}) ids
     from totals`,
    params,
  );
  const total = Number(countRes.rows[0].n);
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));
  const detailParams: unknown[] = [countRes.rows[0].ids];
  // Recheck access at the detail read if an admin reassigns work between queries.
  const detailScope = assignmentScope(viewer,"call","bolna_call_analysis.id",detailParams);
  const rowsRes = await query<CallRow>(
    `select ${SELECT_LIST.replace('notes, transcript, recording_url', 'left(notes,240) as notes, left(transcript,240) as transcript, recording_url').replace(/raw_matches$/, 'null::jsonb as raw_matches')}
       from bolna_call_analysis ${currentAssignmentLateral("call", "bolna_call_analysis.id", viewer, detailParams)}
       where id=any($1::uuid[])${detailScope ? ` and ${detailScope}` : ''}
       order by call_created_at desc nulls last, id`,
    detailParams,
  );

  return { rows: rowsRes.rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)), terms };
}

// Filter dropdowns change rarely but the source/state options materialize the
// view — cache for 10 min to cut repeated heavy queries (egress + compute).
export const getFilterOptions = unstable_cache(_getFilterOptions, ["call-filter-options"], { revalidate: 600 });

async function _getFilterOptions() {
  const agents = await query<{ agent_id: string }>(
    `select distinct agent_id from bolna_call_logs where agent_id is not null order by agent_id`,
  );
  const statuses = await query<{ status: string }>(
    `select distinct status from bolna_call_logs where status is not null order by status`,
  );
  // Sources / states come from the matched raw dataset (only ones that actually link to a call).
  const sources = await query<{ raw_source: string }>(
    `select distinct raw_source from bolna_call_analysis where raw_source is not null order by raw_source`,
  );
  const states = await query<{ raw_state: string }>(
    `select distinct raw_state from bolna_call_analysis where raw_state is not null and raw_state <> '' order by raw_state`,
  );
  return {
    agents: [...new Set([...Object.values(getDispatchAgents()).map(agent => agent.id), ...agents.rows.map((r) => r.agent_id)])],
    statuses: statuses.rows.map((r) => r.status),
    sources: sources.rows.map((r) => r.raw_source),
    states: states.rows.map((r) => r.raw_state),
    availabilities: ["Available", "Unavailable", "Unclear"],
  };
}

export function callsExportQuery(viewer: Viewer, f: CallFilters): import("./export").ExportQuery {
  const { whereSql, params } = buildFilter(viewer, f);
  const countParams = [...params];
  const join = currentAssignmentLateral("call", "bolna_call_analysis.id", viewer, params);
  return { sql: `select ${SELECT_LIST.replace(/raw_matches$/, "null::jsonb as raw_matches")} from bolna_call_analysis ${join} ${whereSql} order by call_created_at desc nulls last, id`,
    countSql: `select count(*)::text n from bolna_call_analysis ${whereSql}`, params, countParams };
}


export async function countCalls(viewer:Viewer,filters:CallFilters){
  const {whereSql,params}=buildFilter(viewer,filters);
  return Number((await query<{n:string}>(`select count(*)::text n from bolna_call_analysis ${whereSql}`,params)).rows[0].n);
}
