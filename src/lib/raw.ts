import { unstable_cache } from "next/cache";
import { query } from "@/lib/db";
import { deriveCat, normNum, type QueueSel } from "@/lib/queue";

// Read layer for the raw master warehouse dataset (raw_records). Mirrors lib/calls.ts.
// Powers the "Raw Dataset" view/filter page; the selected set will later feed a
// Bolna calling batch (preprocessing TBD).

export type RawRow = {
  id: string;
  source: string | null;
  source_record_id: string | null;
  owner_name: string | null;
  owner_first_name: string | null;
  phone: string | null;          // primary phone (+91…)
  phone_count: number;           // how many numbers on this listing
  warehouse_type: string | null;
  listing_status: string | null;
  area_sqft: string | null;
  rent: string | null;           // from metadata
  address: string | null;
  city: string | null;
  state: string | null;
  contact_type: string | null;   // 'probable broker' | null
  email: string | null;          // from metadata
  // call history on this record's number(s) (via bolna_call_logs)
  call_count: number;
  last_called_at: string | null;
  last_status: string | null;
  last_availability: string | null;
  last_transcript: string | null;
  last_recording_url: string | null;
  last_notes: string | null;
  calls_history: { at: string | null; status: string | null; availability: string | null }[] | null;
};

export type RawFilters = {
  q?: string;
  source?: string;
  state?: string;
  city?: string;
  warehouse_type?: string;
  contact?: string;              // "broker" | "owner"
  called?: string;              // "yes" | "no" — already called or not
  last_result?: string;        // most-recent call availability: Available | Unavailable | Unclear
  min_area?: number;
  max_area?: number;
  has_phone?: boolean;
  page?: number;
  pageSize?: number;
};

const SEARCH_COLS = [
  "r.owner_name", "r.owner_first_name", "r.source", "r.city", "r.state",
  "r.address", "r.warehouse_type", "r.source_record_id",
  "r.metadata->>'email'", "r.metadata->>'pincode'",
];

export const RAW_PAGE_SIZE = 50;

const SELECT_LIST = `
  r.id, r.source, r.source_record_id, r.owner_name, r.owner_first_name,
  r.warehouse_type, r.listing_status, r.area_sqft::text as area_sqft,
  r.metadata->>'rent'  as rent,
  r.metadata->>'email' as email,
  r.address, r.city, r.state, r.contact_type,
  (select pp.phone from raw_phones rp join raw_phone_numbers pp on pp.phone_id = rp.phone_id
     where rp.master_id = r.id order by rp.is_primary desc limit 1) as phone,
  (select count(*) from raw_phones rp where rp.master_id = r.id)     as phone_count,
  coalesce(calls.call_count, 0)        as call_count,
  calls.last_called_at::text           as last_called_at,
  calls.last_status                    as last_status,
  calls.last_availability              as last_availability,
  calls.last_transcript                as last_transcript,
  calls.last_recording_url             as last_recording_url,
  calls.last_notes                     as last_notes,
  calls.calls_history                  as calls_history`;

// Call history aggregated across all of a record's phone numbers.
const CALLS_JOIN = `
  left join lateral (
    select count(*) as call_count,
           max(cl.call_created_at) as last_called_at,
           (array_agg(cl.status          order by cl.call_created_at desc nulls last))[1] as last_status,
           (array_agg(cl.llm_availability order by cl.call_created_at desc nulls last))[1] as last_availability,
           (array_agg(cl.transcript order by cl.call_created_at desc nulls last))[1] as last_transcript,
           (array_agg(cl.recording_url   order by cl.call_created_at desc nulls last))[1] as last_recording_url,
           (array_agg(cl.notes           order by cl.call_created_at desc nulls last))[1] as last_notes,
           jsonb_agg(jsonb_build_object(
             'at', cl.call_created_at, 'status', cl.status, 'availability', cl.llm_availability
           ) order by cl.call_created_at desc nulls last) as calls_history
    from raw_phones rp
    join bolna_call_logs cl on cl.phone_id = rp.phone_id
    where rp.master_id = r.id
  ) calls on true`;

function buildFilter(f: RawFilters): { whereSql: string; params: unknown[]; terms: string[] } {
  const where: string[] = [];
  const params: unknown[] = [];

  const terms = (f.q ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 6);
  for (const term of terms) {
    params.push(term);
    const pp = `$${params.length}`;
    const subs = SEARCH_COLS.map((c) => `coalesce(${c}::text,'') ilike '%'||${pp}||'%'`);
    const fuzzy = ["r.owner_name", "r.owner_first_name", "r.city"].map(
      (c) => `word_similarity(${pp}, coalesce(${c},'')) > 0.5`,
    );
    // phone match via EXISTS (no join → no row multiplication)
    const phone = `exists (select 1 from raw_phones rp join raw_phone_numbers p on p.phone_id = rp.phone_id
                   where rp.master_id = r.id and p.phone ilike '%'||${pp}||'%')`;
    where.push(`(${[...subs, ...fuzzy, phone].join(" or ")})`);
  }

  if (f.source) { params.push(f.source); where.push(`r.source = $${params.length}`); }
  if (f.state) { params.push(f.state); where.push(`r.state = $${params.length}`); }
  if (f.city) { params.push(f.city); where.push(`r.city ilike $${params.length}`); }
  if (f.warehouse_type) { params.push(f.warehouse_type); where.push(`r.warehouse_type = $${params.length}`); }
  if (f.contact === "broker") { where.push(`r.contact_type = 'probable broker'`); }
  if (f.contact === "owner") { where.push(`r.contact_type is null`); }
  if (f.min_area != null) { params.push(f.min_area); where.push(`r.area_sqft >= $${params.length}`); }
  if (f.max_area != null) { params.push(f.max_area); where.push(`r.area_sqft <= $${params.length}`); }
  if (f.has_phone) { where.push(`exists (select 1 from raw_phones rp where rp.master_id = r.id)`); }
  // already-called filter: does any of the record's numbers have a call_log?
  const calledExists = `exists (select 1 from raw_phones rp join bolna_call_logs cl on cl.phone_id = rp.phone_id where rp.master_id = r.id)`;
  if (f.called === "yes") { where.push(calledExists); }
  if (f.called === "no") { where.push(`not ${calledExists}`); }
  // most-recent call's result (self-contained subquery → works in count + rows)
  if (f.last_result) {
    params.push(f.last_result);
    where.push(`(select cl.llm_availability from raw_phones rp join bolna_call_logs cl
                 on cl.phone_id = rp.phone_id where rp.master_id = r.id
                 order by cl.call_created_at desc nulls last limit 1) = $${params.length}`);
  }

  const whereSql = where.length ? `where ${where.join(" and ")}` : "";
  return { whereSql, params, terms };
}

export async function getRawRecords(f: RawFilters) {
  const { whereSql, params, terms } = buildFilter(f);
  const page = Math.max(1, f.page ?? 1);
  const pageSize = f.pageSize ?? RAW_PAGE_SIZE;
  const offset = (page - 1) * pageSize;

  const countRes = await query<{ n: string }>(
    `select count(*)::text n from raw_records r ${whereSql}`,
    params,
  );
  const total = Number(countRes.rows[0].n);

  const rowsRes = await query<RawRow>(
    `select ${SELECT_LIST}
       from raw_records r ${CALLS_JOIN} ${whereSql}
       order by r.area_sqft desc nulls last, r.id
       limit ${pageSize} offset ${offset}`,
    params,
  );
  return { rows: rowsRes.rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)), terms };
}

const EXPORT_CAP = 100000; // safety ceiling; whole dataset is ~59k rows

// Export rows carry the full source metadata JSON on top of the grid columns. Kept
// out of the grid's SELECT_LIST so per-page fetches don't haul the jsonb blob.
export type RawExportRow = RawRow & { metadata: Record<string, unknown> | null };

// Full filtered set (no pagination) for the raw-dataset CSV export. Same filters and
// ordering as the grid so the CSV matches what the user is looking at.
export async function getRawRecordsForExport(f: RawFilters): Promise<RawExportRow[]> {
  const { whereSql, params } = buildFilter(f);
  const res = await query<RawExportRow>(
    `select ${SELECT_LIST}, r.metadata as metadata
       from raw_records r ${CALLS_JOIN} ${whereSql}
       order by r.area_sqft desc nulls last, r.id
       limit ${EXPORT_CAP}`,
    params,
  );
  return res.rows;
}

// Export only the explicitly-selected records (checkbox selection in the grid).
export async function getRawRecordsByIds(ids: string[]): Promise<RawExportRow[]> {
  if (ids.length === 0) return [];
  const res = await query<RawExportRow>(
    `select ${SELECT_LIST}, r.metadata as metadata
       from raw_records r ${CALLS_JOIN}
       where r.id = any($1)
       order by r.area_sqft desc nulls last, r.id`,
    [ids.slice(0, EXPORT_CAP)],
  );
  return res.rows;
}

// Minimal row for the "queue for calling" batch — one per matching record that has
// a phone, across ALL pages (not just the current one). Feeds the CSV preview; the
// client dedups by number in preprocessing before dispatch. `cat` flags records whose
// number was already called, by last outcome (''=fresh) so the UI can warn/purge them.
export type { CallCat, QueueSel as QueueRow } from "@/lib/queue";

const QUEUE_CAP = 20000; // safety ceiling; Delhi (largest city set) is ~2.5k

// Raw shape from SQL before classification; `cat` is derived in JS via the shared,
// unit-tested deriveCat() so server and client tag identically.
type QueueRowSql = {
  id: string; name: string; contact: string | null; area: string; state: string;
  call_count: string; last_avail: string | null;
};

// Shared projection: primary phone, name/area/state, and last-call info for cat.
// `where` and `params` are spliced in by the callers (filters vs. explicit ids).
const QUEUE_SELECT = `
  select r.id,
         coalesce(r.owner_first_name, r.owner_name, '') as name,
         (select pp.phone from raw_phones rp join raw_phone_numbers pp on pp.phone_id = rp.phone_id
            where rp.master_id = r.id order by rp.is_primary desc limit 1) as contact,
         coalesce(r.city, '')  as area,
         coalesce(r.state, '') as state,
         coalesce(c.n, 0)::text as call_count,
         c.last_avail           as last_avail
    from raw_records r
    left join lateral (
      select count(*) n,
             (array_agg(cl.llm_availability order by cl.call_created_at desc nulls last))[1] as last_avail
      from raw_phones rp join bolna_call_logs cl on cl.phone_id = rp.phone_id
      where rp.master_id = r.id
    ) c on true`;

function toQueueSel(r: QueueRowSql, queued: Set<string>): QueueSel {
  const contact = r.contact ?? "";
  return {
    id: r.id, name: r.name, contact, area: r.area, state: r.state,
    cat: deriveCat(r.call_count, r.last_avail),
    queued: queued.has(normNum(contact)),
  };
}

// Normalized (last-10-digit) set of every number already in a LIVE batch — i.e. one
// that's sending or scheduled. Failed batches don't block, so a failed dispatch can be
// retried. Used to skip re-queueing numbers that are already out for calling.
export async function getQueuedNumberSet(): Promise<Set<string>> {
  const res = await query<{ contact_number: string }>(
    `select distinct i.contact_number
       from call_batch_items i join call_batches b on b.id = i.batch_id
      where b.state in ('sending', 'scheduled')`,
  );
  return new Set(res.rows.map((r) => normNum(r.contact_number)));
}

export async function getRawQueueRows(f: RawFilters): Promise<{ rows: QueueSel[]; capped: boolean }> {
  const { whereSql, params } = buildFilter(f);
  // Must have a phone to call. Already-called records are NOT excluded here — they
  // are flagged via `cat` so the client can warn and let the user purge them.
  const phoneExists = `exists (select 1 from raw_phones rp where rp.master_id = r.id)`;
  const where = whereSql ? `${whereSql} and ${phoneExists}` : `where ${phoneExists}`;

  const [res, queued] = await Promise.all([
    query<QueueRowSql>(
      `${QUEUE_SELECT} ${where}
         order by r.area_sqft desc nulls last, r.id
         limit ${QUEUE_CAP + 1}`,
      params,
    ),
    getQueuedNumberSet(),
  ]);
  const rows = res.rows.map((r) => toQueueSel(r, queued));
  const capped = rows.length > QUEUE_CAP;
  return { rows: capped ? rows.slice(0, QUEUE_CAP) : rows, capped };
}

// Re-fetch specific records by id — the dispatch path uses this so the numbers sent
// to Bolna come from the DB, never from client-supplied data.
export async function getRawQueueRowsByIds(ids: string[]): Promise<QueueSel[]> {
  if (ids.length === 0) return [];
  const capped = ids.slice(0, QUEUE_CAP);
  const [res, queued] = await Promise.all([
    query<QueueRowSql>(`${QUEUE_SELECT} where r.id = any($1)`, [capped]),
    getQueuedNumberSet(),
  ]);
  return res.rows.map((r) => toQueueSel(r, queued));
}

export const getRawFilterOptions = unstable_cache(_getRawFilterOptions, ["raw-filter-options"], { revalidate: 600 });

async function _getRawFilterOptions() {
  const sources = await query<{ source: string }>(
    `select distinct source from raw_records where source is not null order by source`,
  );
  const states = await query<{ state: string }>(
    `select distinct state from raw_records where state is not null and state <> '' order by state`,
  );
  const types = await query<{ warehouse_type: string }>(
    `select warehouse_type, count(*) n from raw_records
      where warehouse_type is not null group by warehouse_type order by n desc limit 25`,
  );
  return {
    sources: sources.rows.map((r) => r.source),
    states: states.rows.map((r) => r.state),
    warehouseTypes: types.rows.map((r) => r.warehouse_type),
  };
}
