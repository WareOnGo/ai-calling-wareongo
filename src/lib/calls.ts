import { query } from "@/lib/db";

export type CallRow = {
  id: string;
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
  expected_rent: string | null;
  notes: string | null;
  transcript: string | null;
  recording_url: string | null;
  needs_review: boolean;
  // editable workflow fields
  call_status: string | null;
  called_by: string | null;
  added_to_db: boolean;
  wh_id: string | null;
  // Representative matched listing (scalar columns) + count + full set.
  raw_match_count: number;
  raw_source: string | null;
  raw_owner_name: string | null;
  raw_warehouse_type: string | null;
  raw_city: string | null;
  raw_state: string | null;
  raw_area_sqft: string | null;
  raw_contact_type: string | null;
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
  q?: string;
  availability?: string;
  agent_id?: string;
  status?: string;
  source?: string;        // matched raw-dataset source
  state?: string;         // matched raw-dataset state
  contact?: string;       // "broker" | "owner"
  call_type?: string;     // "inbound" | "outbound"
  needs_review?: boolean;
  page?: number;
  pageSize?: number;
};

// Columns the free-text search scans (substring) for highlighting + matching.
const SEARCH_COLS = [
  "from_number", "to_number", "owner_name", "db_area", "city_area",
  "raw_owner_name", "raw_source", "raw_city", "raw_state", "raw_warehouse_type",
  "expected_rent", "built_up_area_sqft", "status", "notes", "transcript",
];

export const PAGE_SIZE = 25;

const SELECT_LIST = `id, call_created_at, call_type, from_number, to_number, owner_name, db_area,
       status, availability, segment, confidence, built_up_area_sqft, expected_rent,
       notes, transcript, recording_url, needs_review,
       call_status, called_by, added_to_db, wh_id,
       raw_match_count, raw_source, raw_owner_name, raw_warehouse_type,
       raw_city, raw_state, raw_area_sqft, raw_contact_type, raw_matches`;

// Build the WHERE clause + params shared by the paged list and the CSV export.
function buildFilter(f: CallFilters): { whereSql: string; params: unknown[]; terms: string[] } {
  const where: string[] = [];
  const params: unknown[] = [];

  // Multi-term fuzzy search: every whitespace-separated term must match (substring
  // OR trigram-similar) at least one search column. Fuzzy = typo tolerance on names.
  const terms = (f.q ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 6);
  for (const term of terms) {
    params.push(term);
    const p = `$${params.length}`;
    const subs = SEARCH_COLS.map((c) => `coalesce(${c}::text,'') ilike '%'||${p}||'%'`);
    // word_similarity catches typos within a name ("raghuv" -> "Raghav"); per-column,
    // not a concat blob (which would dilute a short term's score).
    const fuzzyCols = ["owner_name", "raw_owner_name", "raw_source", "raw_city"];
    const fuzzy = fuzzyCols.map((c) => `word_similarity(${p}, coalesce(${c},'')) > 0.5`);
    where.push(`(${[...subs, ...fuzzy].join(" or ")})`);
  }

  if (f.availability) { params.push(f.availability); where.push(`availability = $${params.length}`); }
  if (f.agent_id) { params.push(f.agent_id); where.push(`agent_id = $${params.length}`); }
  if (f.status) { params.push(f.status); where.push(`status = $${params.length}`); }
  if (f.source) { params.push(f.source); where.push(`raw_source = $${params.length}`); }
  if (f.state) { params.push(f.state); where.push(`raw_state = $${params.length}`); }
  if (f.contact === "broker") { where.push(`raw_contact_type = 'probable broker'`); }
  if (f.contact === "owner") { where.push(`raw_source is not null and raw_contact_type is null`); }
  if (f.call_type) { params.push(f.call_type); where.push(`call_type = $${params.length}`); }
  if (f.needs_review) { where.push(`needs_review = true`); }

  const whereSql = where.length ? `where ${where.join(" and ")}` : "";
  return { whereSql, params, terms };
}

// All rows matching the filters, ignoring pagination — used by the CSV export.
export async function getCallsForExport(f: CallFilters): Promise<CallRow[]> {
  const { whereSql, params } = buildFilter(f);
  const res = await query<CallRow>(
    `select ${SELECT_LIST} from bolna_call_analysis ${whereSql}
       order by call_created_at desc nulls last`,
    params,
  );
  return res.rows;
}

export async function getCalls(f: CallFilters) {
  const { whereSql, params, terms } = buildFilter(f);
  const page = Math.max(1, f.page ?? 1);
  const pageSize = f.pageSize ?? PAGE_SIZE;
  const offset = (page - 1) * pageSize;

  const countRes = await query<{ n: string }>(
    `select count(*)::text n from bolna_call_analysis ${whereSql}`,
    params,
  );
  const total = Number(countRes.rows[0].n);

  const rowsRes = await query<CallRow>(
    `select ${SELECT_LIST}
       from bolna_call_analysis
       ${whereSql}
       order by call_created_at desc nulls last
       limit ${pageSize} offset ${offset}`,
    params,
  );

  return { rows: rowsRes.rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)), terms };
}

export function calledByOptions(): string[] {
  return (process.env.CALLED_BY_OPTIONS ?? "Raghav,Dhaval,Jayanth")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function getFilterOptions() {
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
    agents: agents.rows.map((r) => r.agent_id),
    statuses: statuses.rows.map((r) => r.status),
    sources: sources.rows.map((r) => r.raw_source),
    states: states.rows.map((r) => r.raw_state),
    availabilities: ["Available", "Unavailable", "Unclear", "dead number - do not call"],
  };
}
