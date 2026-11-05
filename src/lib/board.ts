// Caller board read model: one card per caller, phone and stage, with a page of
// cards per column and a total for each column. Every read applies the viewer's
// scope here, as the grid readers do (see scope.ts).
import { query } from "./db";
import type { Viewer } from "./scope";
import { CONTACT_PHONES_SQL } from "./assignment-contacts";
import { ASSIGNMENT_CITY, ASSIGNMENT_PHONE, ASSIGNMENT_PHONE_JOIN, ASSIGNMENT_REGION, ASSIGNMENT_SOURCE_JOIN, ASSIGNMENT_SUBJECT } from "./assignment-context";
import { STAGE_SLUGS, TERMINAL_STAGES, type Stage } from "./board-stages";
import { BOARD_MAX_CARDS, BOARD_PAGE_SIZE, type BoardFilters, type ColumnLimits } from "./board-filters";

export type BoardTask = {
  id: string; revision: number; entity: "record" | "call"; entityId: string; state: "open" | "done";
  outcome: string | null; remarks: string | null; note: string | null; whId: string | null; addedToDb: boolean;
  disposition: string | null; nextDueAt: string | null; batchId: string | null; assignedBy: string; assignedAt: string;
  name: string | null; city: string | null;
};
export type BoardCard = {
  key: string; stage: Stage; assignee: string; assigneeName: string | null; name: string | null; phone: string | null;
  city: string | null; region: string | null; tasks: BoardTask[]; warehouseIds: string[];
  nextDueAt: string | null; overdue: boolean; updatedAt: string; closed: boolean;
};
export type BoardColumn = { stage: Stage; total: number; limit: number; cards: BoardCard[] };
export type Board = { columns: BoardColumn[]; total: number };
export type BoardFilterOptions = {
  cities: string[]; regions: string[]; assigners: { email: string; name: string | null }[];
  batches: { id: string; createdAt: string; createdBy: string; creatorName: string | null; tasks: number }[];
  assignees: { email: string; name: string | null }[];
};

const INTERVALS = { "24h": "24 hours", "7d": "7 days", "30d": "30 days" } as const;
// Stage slugs are source-code constants, never request values.
const TERMINAL_SQL = TERMINAL_STAGES.map(stage => `'${stage}'`).join(",");
const STAGE_ORDER_SQL = `array[${STAGE_SLUGS.map(stage => `'${stage}'`).join(",")}]`;
const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

// `a` is the assignment; `r`, `cl`, `work_source` and `rphone` follow assignment-context.ts.
const TASK_FROM = `from bolna_assignments a
  left join raw_records r on a.entity_type = 'record' and r.id = a.entity_id
  left join bolna_call_logs cl on a.entity_type = 'call' and cl.id = a.entity_id
  ${ASSIGNMENT_SOURCE_JOIN} ${ASSIGNMENT_PHONE_JOIN}`;

/**
 * Predicates for the board. `task` uses only assignment columns; `context` needs
 * the listing/call joins in TASK_FROM. Open work shows in every column; finished
 * work only in the stages that end a task. Employees only ever see their own work.
 */
export function boardWhere(viewer: Viewer, f: BoardFilters, params: unknown[]): { task: string; context: string } {
  const task = ["a.state <> 'dropped'", `(a.state = 'open' or a.stage in (${TERMINAL_SQL}))`];
  if (!viewer.isAdmin) { params.push(viewer.email.toLowerCase()); task.push(`a.assignee = $${params.length}`); }
  else if (f.assignee?.length) { params.push(f.assignee); task.push(`a.assignee = any($${params.length}::text[])`); }
  if (f.assigned_by?.length) { params.push(f.assigned_by); task.push(`lower(a.assigned_by) = any($${params.length}::text[])`); }
  if (f.batch?.length) {
    const ids = f.batch.filter(value => value !== "none"), terms: string[] = [];
    if (ids.length) { params.push(ids); terms.push(`a.batch_id = any($${params.length}::uuid[])`); }
    if (f.batch.includes("none")) terms.push("a.batch_id is null");
    task.push(`(${terms.join(" or ")})`);
  }
  if (f.updated) { params.push(INTERVALS[f.updated]); task.push(`a.updated_at >= now() - $${params.length}::interval`); }
  const context: string[] = [];
  if (f.city?.length) { params.push(f.city.map(city => city.trim().toLowerCase())); context.push(`lower(trim(${ASSIGNMENT_CITY})) = any($${params.length}::text[])`); }
  if (f.region?.length) { params.push(f.region.map(region => region.trim().toLowerCase())); context.push(`lower(trim(${ASSIGNMENT_REGION})) = any($${params.length}::text[])`); }
  if (f.q) {
    params.push(escapeLike(f.q));
    const term = `$${params.length}`;
    const searchable = [ASSIGNMENT_SUBJECT, ASSIGNMENT_CITY, ASSIGNMENT_PHONE, "a.remarks", "a.note"];
    context.push(`(${searchable.map(expression => `coalesce(${expression}, '') ilike '%' || ${term} || '%'`).join(" or ")})`);
  }
  return { task: task.join(" and "), context: context.join(" and ") };
}

/** The complete board statement; exported so plans can be inspected with the exact SQL. */
export function boardQuery(viewer: Viewer, filters: BoardFilters, limits: Record<string, number>) {
  const params: unknown[] = [];
  const { task, context } = boardWhere(viewer, filters, params);
  params.push(JSON.stringify(limits));
  const limitParam = `$${params.length}`;
  // Latest task first, so a card shows its most recently worked listing.
  const latest = (expression: string) => `(array_agg(${expression} order by t.updated_at desc, t.id desc) filter (where nullif(trim(${expression}), '') is not null))[1]`;
  const sql = `with tasks as materialized (
      select a.id, a.revision, a.entity_type, a.entity_id, a.assignee, a.assigned_by, a.assigned_at, a.batch_id, a.state, a.stage,
             a.outcome, a.remarks, a.note, a.wh_id, a.added_to_db, a.disposition, a.next_due_at, a.updated_at,
             ${ASSIGNMENT_SUBJECT} as subject, ${ASSIGNMENT_CITY} as city, ${ASSIGNMENT_REGION} as region, ${ASSIGNMENT_PHONE} as phone,
             (select min(c.phone_last10) from (${CONTACT_PHONES_SQL}) c where c.entity_type = a.entity_type and c.entity_id = a.entity_id) as phone_key
        ${TASK_FROM}
       where ${task}${context ? ` and ${context}` : ""}
    ), cards as (
      select t.assignee, t.stage, coalesce(t.phone_key, t.entity_type || ':' || t.entity_id) as card_key,
             json_agg(json_build_object('id', t.id::text, 'revision', t.revision, 'entity', t.entity_type, 'entityId', t.entity_id::text,
               'state', t.state, 'outcome', t.outcome, 'remarks', t.remarks, 'note', t.note, 'whId', t.wh_id, 'addedToDb', t.added_to_db,
               'disposition', t.disposition, 'nextDueAt', t.next_due_at, 'batchId', t.batch_id::text, 'assignedBy', t.assigned_by,
               'assignedAt', t.assigned_at, 'name', t.subject, 'city', t.city) order by t.updated_at desc, t.id desc) as tasks,
             ${latest("t.subject")} as name, ${latest("t.phone")} as phone, ${latest("t.city")} as city, ${latest("t.region")} as region,
             min(t.next_due_at) as next_due_at, max(t.updated_at) as updated_at, bool_and(t.state = 'done') as closed,
             array_agg(t.id) as ids, min(t.phone_key) as phone_key
        from tasks t
       group by t.assignee, t.stage, coalesce(t.phone_key, t.entity_type || ':' || t.entity_id)
    ), ranked as (
      select c.*, coalesce(c.next_due_at < now(), false) and not c.closed as overdue,
             count(*) over (partition by c.stage) as stage_total,
             row_number() over (partition by c.stage order by coalesce(c.next_due_at < now(), false) and not c.closed desc,
               c.next_due_at asc nulls last, c.updated_at desc, c.assignee, c.card_key) as rn
        from cards c
    )
    select r.stage, r.stage_total::int as total, r.assignee, u.name as assignee_name, r.card_key as key, r.name, r.phone, r.city, r.region,
           r.tasks, r.next_due_at::text as next_due_at, r.overdue, r.updated_at::text as updated_at, r.closed,
           -- A card is one phone: read its warehouses by primary key, not through the
           -- all-listings bolna_warehouse_matches view, which cannot use a join key.
           array(select v from (
             select w.warehouse_id::text as v from bolna_warehouse_contacts w where w.phone_last10 = r.phone_key
             union select trim(wt.wh_id) from bolna_assignments wt where wt.id = any(r.ids) and bolna_valid_warehouse(wt.wh_id)
           ) ids order by length(v), v) as warehouse_ids
      from ranked r left join bolna_app_users u on u.email = r.assignee
     where r.rn <= coalesce((${limitParam}::jsonb ->> r.stage)::int, ${BOARD_PAGE_SIZE})
     order by array_position(${STAGE_ORDER_SQL}, r.stage), r.rn`;
  return { sql, params };
}

type CardRow = {
  stage: Stage; total: number; key: string; assignee: string; assignee_name: string | null; name: string | null; phone: string | null;
  city: string | null; region: string | null; tasks: BoardTask[]; next_due_at: string | null; overdue: boolean;
  updated_at: string; closed: boolean; warehouse_ids: string[];
};

export async function loadBoard(viewer: Viewer, filters: BoardFilters, limits: ColumnLimits = {}): Promise<Board> {
  const effective = Object.fromEntries(STAGE_SLUGS.map(stage => [stage, Math.max(1, Math.min(BOARD_MAX_CARDS, Math.floor(limits[stage] ?? BOARD_PAGE_SIZE)))]));
  const { sql, params } = boardQuery(viewer, filters, effective);
  const rows = (await query<CardRow>(sql, params)).rows;
  const columns = STAGE_SLUGS.map(stage => {
    const cards = rows.filter(row => row.stage === stage);
    return {
      stage, total: cards[0]?.total ?? 0, limit: effective[stage],
      cards: cards.map(row => ({
        key: row.key, stage, assignee: row.assignee, assigneeName: row.assignee_name, name: row.name, phone: row.phone,
        city: row.city, region: row.region, tasks: row.tasks, warehouseIds: row.warehouse_ids,
        nextDueAt: row.next_due_at, overdue: row.overdue, updatedAt: row.updated_at, closed: row.closed,
      })),
    };
  });
  return { columns, total: columns.reduce((sum, column) => sum + column.total, 0) };
}

/** Choices come from the viewer's own visible work, so nobody sees another caller's cities or batches. */
export async function boardFilterOptions(viewer: Viewer): Promise<BoardFilterOptions> {
  const params: unknown[] = [];
  const { task } = boardWhere(viewer, {}, params);
  const distinctText = (expression: string) => query<{ v: string }>(
    `select min(v) as v from (select trim(${expression}) as v ${TASK_FROM} where ${task}) values
      where nullif(v, '') is not null group by lower(v) order by lower(min(v))`, params);
  const [cities, regions, assigners, batches, assignees] = await Promise.all([
    distinctText(ASSIGNMENT_CITY),
    distinctText(ASSIGNMENT_REGION),
    query<{ email: string; name: string | null }>(`select distinct lower(a.assigned_by) as email, u.name from bolna_assignments a
      left join bolna_app_users u on u.email = lower(a.assigned_by) where ${task} order by u.name nulls last, email`, params),
    query<BoardFilterOptions["batches"][number]>(`select b.id::text as id, b.created_at::text as "createdAt", b.created_by as "createdBy",
        u.name as "creatorName", count(*)::int as tasks
      from bolna_assignments a join bolna_assignment_batches b on b.id = a.batch_id left join bolna_app_users u on u.email = b.created_by
      where ${task} group by b.id, b.created_at, b.created_by, u.name order by b.created_at desc limit 200`, params),
    viewer.isAdmin
      ? query<{ email: string; name: string | null }>(`select distinct a.assignee as email, u.name from bolna_assignments a
          left join bolna_app_users u on u.email = a.assignee where ${task} order by u.name nulls last, email`, params)
      : Promise.resolve({ rows: [] as { email: string; name: string | null }[] }),
  ]);
  return {
    cities: cities.rows.map(row => row.v), regions: regions.rows.map(row => row.v),
    assigners: assigners.rows, batches: batches.rows, assignees: assignees.rows,
  };
}
