import { query } from "./db";
import { listAssignments, matchingAssignmentTotals } from "./assignments";
import { hasWorkCriteria, type WorkFilters } from "./work-filters";
import { area, rent } from "./display";
import type { Viewer } from "./scope";

export type WorkItem = {
  revision: number; id: string; entityId: string; entity: "record" | "call"; who: string; phone: string | null;
  context: { city: string | null; area: string | null; rent: string | null }; ai: string | null; aiCount: number; brief: string | null;
  assignedBy: string; assignedByName: string | null; assignedAt: string;
  closureReason:string|null; disposition:string|null; nextDueAt:string|null;
  state: string; outcome: string | null; remarks: string | null; addedToDb: boolean; whId: string | null;
};
export type WorkPage = { rows: WorkItem[]; total: number; page: number; pages: number };
export type WorkTotals = { record: { open: number; done: number }; call: { open: number; done: number } };
function criteria(filters: WorkFilters) {
  return { has_ai_calls:filters.has_ai_calls,manual_disposition:filters.manual_disposition,completed_from:filters.completed_from,completed_to:filters.completed_to,ai_result:filters.ai_result, wh_id:filters.wh_id, has_notes:filters.has_notes, has_manual_calls:filters.has_manual_calls, date_from:filters.date_from, date_to:filters.date_to, follow_up:filters.follow_up,q: filters.q, city: filters.city, region: filters.region, assigned_by: filters.assigned_by, outcome: filters.outcome, added_to_db: filters.added_to_db };
}
export async function personalTotals(email: string, filters: WorkFilters = {}): Promise<WorkTotals> {
  const rows = hasWorkCriteria(filters)
    ? await matchingAssignmentTotals({ email, isAdmin: false }, { ...criteria(filters), assignee: email, activeOnly: true, entity_type: filters.type })
    : (await query<{ entity_type: string; state: string; n: string }>(`select entity_type, state, count(*)::text n from bolna_assignments where assignee = $1 and state <> 'dropped' group by entity_type, state`, [email.toLowerCase()])).rows;
  const totals = { record: { open: 0, done: 0 }, call: { open: 0, done: 0 } };
  for (const r of rows) if ((r.entity_type === 'call' || r.entity_type === 'record') && (r.state === 'open' || r.state === 'done')) totals[r.entity_type][r.state] = Number(r.n);
  return totals;
}
export async function personalWork(user: Viewer, entity: "call" | "record", filters: WorkFilters, page: number): Promise<WorkPage> {
  if (filters.type && filters.type !== entity) return { rows: [], total: 0, page: 1, pages: 1 };
  // Task cards need a few property facts, not full transcripts, source metadata,
  // call histories and a second copy of each assignment's AI summary.
  const result = await listAssignments(user, { ...criteria(filters), assignee: user.email, entity_type: entity, activeOnly: true, state: filters.view, sort: filters.sort, page, pageSize: 25 }, { workContext: true });
  const rows = result.rows.map(a => {
    const context = a.work_context!;
    return {
      revision: a.revision, id: a.id, entityId: a.entity_id, entity, who: a.subject || context.owner_name || "Unnamed owner", phone: a.phone,
      context: {
        city: context.city || a.city,
        area: context.carpet_area_sqft ? `${area(context.carpet_area_sqft)} carpet` : context.built_up_area_sqft ? `${area(context.built_up_area_sqft)} built-up` : area(context.area_sqft),
        rent: rent(context.rent),
      },
      ai: a.ai_availability, aiCount: entity === 'record' ? a.ai_summary.outbound : a.ai_summary.total, brief: a.note,
      assignedBy: a.assigned_by, assignedByName: a.assigned_by_name, assignedAt: a.assigned_at,
      closureReason:a.closure_reason,disposition:a.disposition,nextDueAt:a.next_due_at,
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
