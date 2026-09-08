import { query } from "./db";
import { listAssignments, matchingAssignmentTotals } from "./assignments";
import { hasWorkCriteria, type WorkFilters } from "./work-filters";
import { getRawRecordsByIds } from "./raw";
import { getCallsForExport } from "./calls";
import { area, rent } from "./display";
import type { Viewer } from "./scope";

export type WorkItem = {
  id: string; entityId: string; entity: "record" | "call"; who: string; phone: string | null;
  context: { city: string | null; area: string | null; rent: string | null }; ai: string | null; aiCount: number; brief: string | null;
  assignedBy: string; assignedByName: string | null; assignedAt: string;
  state: string; outcome: string | null; remarks: string | null; addedToDb: boolean; whId: string | null;
};
export type WorkPage = { rows: WorkItem[]; total: number; page: number; pages: number };
export type WorkTotals = { record: { open: number; done: number }; call: { open: number; done: number } };
function criteria(filters: WorkFilters) {
  return { q: filters.q, city: filters.city, assigned_by: filters.assigned_by, outcome: filters.outcome, added_to_db: filters.added_to_db };
}
export async function personalTotals(email: string, filters: WorkFilters = {}): Promise<WorkTotals> {
  const rows = hasWorkCriteria(filters)
    ? await matchingAssignmentTotals({ ...criteria(filters), assignee: email, activeOnly: true, entity_type: filters.type })
    : (await query<{ entity_type: string; state: string; n: string }>(`select entity_type, state, count(*)::text n from bolna_assignments where assignee = $1 and state <> 'dropped' group by entity_type, state`, [email.toLowerCase()])).rows;
  const totals = { record: { open: 0, done: 0 }, call: { open: 0, done: 0 } };
  for (const r of rows) if ((r.entity_type === 'call' || r.entity_type === 'record') && (r.state === 'open' || r.state === 'done')) totals[r.entity_type][r.state] = Number(r.n);
  return totals;
}
export async function personalWork(user: Viewer, entity: "call" | "record", filters: WorkFilters, page: number): Promise<WorkPage> {
  if (filters.type && filters.type !== entity) return { rows: [], total: 0, page: 1, pages: 1 };
  const result = await listAssignments({ ...criteria(filters), assignee: user.email, entity_type: entity, activeOnly: true, state: filters.view, sort: filters.sort, page, pageSize: 25 });
  const ids = result.rows.map(r => r.entity_id);
  const records = entity === 'record' && ids.length ? await getRawRecordsByIds(user, ids) : [];
  const calls = entity === 'call' && ids.length ? await getCallsForExport(user, { ids }) : [];
  const rows = result.rows.map(a => {
    const r = records.find(r => r.id === a.entity_id);
    const c = calls.find(c => c.id === a.entity_id);
    return {
      id: a.id, entityId: a.entity_id, entity, who: a.subject || c?.raw_owner_name || "Unnamed owner", phone: a.phone,
      context: {
        city: r?.city || c?.db_area || c?.raw_city || a.city,
        area: area(r?.area_sqft || c?.built_up_area_sqft || c?.raw_area_sqft || null),
        rent: rent(r?.rent || c?.expected_rent || null),
      },
      ai: r?.last_availability || c?.availability || null, aiCount: Number(r?.call_count || (c ? 1 : 0)), brief: a.note,
      assignedBy: a.assigned_by, assignedByName: a.assigned_by_name, assignedAt: a.assigned_at,
      state: a.state, outcome: a.outcome, remarks: a.remarks, addedToDb: a.added_to_db, whId: a.wh_id,
    };
  });
  return { rows, total: result.total, page: result.page, pages: result.pages };
}

export async function personalAssigners(email: string) {
  return (await query<{ email: string; name: string | null }>(
    `select distinct a.assigned_by as email, u.name from bolna_assignments a
     left join bolna_app_users u on u.email = a.assigned_by
     where a.assignee = $1 and a.state <> 'dropped' order by u.name nulls last, a.assigned_by`, [email.toLowerCase()],
  )).rows;
}
