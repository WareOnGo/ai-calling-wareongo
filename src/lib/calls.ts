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
};

export type CallFilters = {
  q?: string;
  availability?: string;
  segment?: string;
  agent_id?: string;
  status?: string;
  confidence?: string;
  needs_review?: boolean;
  page?: number;
  pageSize?: number;
};

export const PAGE_SIZE = 25;

export async function getCalls(f: CallFilters) {
  const where: string[] = [];
  const params: unknown[] = [];

  if (f.q) {
    params.push(`%${f.q}%`);
    const p = `$${params.length}`;
    where.push(`(from_number ilike ${p} or to_number ilike ${p} or owner_name ilike ${p} or transcript ilike ${p})`);
  }
  if (f.availability) { params.push(f.availability); where.push(`availability = $${params.length}`); }
  if (f.segment) { params.push(f.segment); where.push(`segment = $${params.length}`); }
  if (f.agent_id) { params.push(f.agent_id); where.push(`agent_id = $${params.length}`); }
  if (f.status) { params.push(f.status); where.push(`status = $${params.length}`); }
  if (f.confidence) { params.push(f.confidence); where.push(`confidence = $${params.length}`); }
  if (f.needs_review) { where.push(`needs_review = true`); }

  const whereSql = where.length ? `where ${where.join(" and ")}` : "";
  const page = Math.max(1, f.page ?? 1);
  const pageSize = f.pageSize ?? PAGE_SIZE;
  const offset = (page - 1) * pageSize;

  const countRes = await query<{ n: string }>(
    `select count(*)::text n from call_analysis ${whereSql}`,
    params,
  );
  const total = Number(countRes.rows[0].n);

  const rowsRes = await query<CallRow>(
    `select id, call_created_at, call_type, from_number, to_number, owner_name, db_area,
            status, availability, segment, confidence, built_up_area_sqft, expected_rent,
            notes, transcript, recording_url, needs_review,
            call_status, called_by, added_to_db, wh_id
       from call_analysis
       ${whereSql}
       order by call_created_at desc nulls last
       limit ${pageSize} offset ${offset}`,
    params,
  );

  return { rows: rowsRes.rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

export function calledByOptions(): string[] {
  return (process.env.CALLED_BY_OPTIONS ?? "Raghav,Dhaval,Jayanth")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function getFilterOptions() {
  const agents = await query<{ agent_id: string }>(
    `select distinct agent_id from call_logs where agent_id is not null order by agent_id`,
  );
  const statuses = await query<{ status: string }>(
    `select distinct status from call_logs where status is not null order by status`,
  );
  return {
    agents: agents.rows.map((r) => r.agent_id),
    statuses: statuses.rows.map((r) => r.status),
    availabilities: ["Available", "Unavailable", "Unclear", "dead number - do not call"],
    segments: ["no_reach", "followup_hungup", "followup_silent", "followup_voicemail", "followup_retry", "followup_other"],
    confidences: ["High", "Medium", "Low"],
  };
}
