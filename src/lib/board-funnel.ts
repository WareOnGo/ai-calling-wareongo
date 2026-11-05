// Admin funnel: each caller's leads (board cards) by stage, conversion to a
// warehouse ID, and the warehouse IDs credited to them. Counts every non-dropped
// card, including finished work outside the board's terminal columns.
import { ApiError } from "./api";
import { query } from "./db";
import type { Viewer } from "./scope";
import { boardWhere, cardWarehouseIds, cardsCte } from "./board";
import { STAGE_SLUGS, type Stage } from "./board-stages";
import type { BoardFilters } from "./board-filters";

export type FunnelCounts = Record<Stage, number>;
export type FunnelInput = { assignee: string; name: string | null; stages: FunnelCounts; warehouseIds: string[] };
export type FunnelRow = FunnelInput & { leads: number; reachedWarehouse: number; warehouseIdCount: number };
export type FunnelTotals = { stages: FunnelCounts; leads: number; warehouseLeads: number; reachedWarehouse: number; warehouseIdCount: number; awaiting: number };

const emptyCounts = () => Object.fromEntries(STAGE_SLUGS.map(stage => [stage, 0])) as FunnelCounts;
const share = (part: number, whole: number) => whole ? part / whole : 0;
const byNumber = (a: string, b: string) => a.length - b.length || a.localeCompare(b);

export function funnelRow(input: FunnelInput): FunnelRow {
  const leads = STAGE_SLUGS.reduce((sum, stage) => sum + input.stages[stage], 0);
  return { ...input, leads, reachedWarehouse: share(input.stages.warehouse_created, leads), warehouseIdCount: input.warehouseIds.length };
}

/** Stages add up across callers; a warehouse ID credited to two callers counts once. */
export function funnelTotals(rows: FunnelRow[]): FunnelTotals {
  const stages = emptyCounts();
  for (const row of rows) for (const stage of STAGE_SLUGS) stages[stage] += row.stages[stage];
  const leads = rows.reduce((sum, row) => sum + row.leads, 0);
  return {
    stages, leads, warehouseLeads: stages.warehouse_created, reachedWarehouse: share(stages.warehouse_created, leads),
    warehouseIdCount: new Set(rows.flatMap(row => row.warehouseIds)).size, awaiting: stages.awaiting_details,
  };
}

/** Credit for a warehouse ID goes to the caller whose card reached stage 4. */
export async function loadFunnel(viewer: Viewer, filters: BoardFilters): Promise<{ rows: FunnelRow[]; totals: FunnelTotals }> {
  if (!viewer.isAdmin) throw new ApiError(403, "The funnel is for admins only.");
  const params: unknown[] = [];
  const where = boardWhere(viewer, filters, params, { includeFinished: true });
  const counts = (await query<{ assignee: string; name: string | null; stage: Stage; cards: number; warehouse_ids: string[] }>(`${cardsCte(where)}
    select c.assignee, u.name, c.stage, count(distinct c.card_key)::int as cards,
           coalesce(array_agg(distinct w.v) filter (where w.v is not null), '{}') as warehouse_ids
      from cards c left join bolna_app_users u on u.email = c.assignee
      left join lateral unnest(case when c.stage = 'warehouse_created' then ${cardWarehouseIds("c")} else '{}'::text[] end) w(v) on true
     group by c.assignee, u.name, c.stage`, params)).rows;
  const people = new Map<string, FunnelInput>();
  for (const count of counts) {
    const person = people.get(count.assignee) ?? { assignee: count.assignee, name: count.name, stages: emptyCounts(), warehouseIds: [] };
    person.stages[count.stage] += count.cards;
    person.warehouseIds = [...new Set([...person.warehouseIds, ...count.warehouse_ids])].sort(byNumber);
    people.set(count.assignee, person);
  }
  const rows = [...people.values()].map(funnelRow)
    .sort((a, b) => (a.name || a.assignee).localeCompare(b.name || b.assignee));
  return { rows, totals: funnelTotals(rows) };
}
