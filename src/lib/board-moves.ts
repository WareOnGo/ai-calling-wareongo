// Board writes: card moves, notes and follow-up dates. Each runs in one transaction
// checks every task's revision before changing any, and uses the board workflow
// exception from migration 020. Only stage moves need the allocation lock.
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { ApiError } from "./api";
import { query, transaction } from "./db";
import { contactTargets, type EntityType, type Viewer } from "./scope";
import { allocationHash } from "./assignment-allocation";
import { MoveError, STRIKE_DISPOSITIONS, planMove, type MovePlan, type Stage } from "./board-stages";
import { timelineEvents, type AttemptRow, type AuditRow, type TimelineEvent } from "./board-timeline";

export type TaskRef = { id: string; revision: number };
export type MovedTask = { id: string; revision: number; stage: Stage; state: "open" | "done" };
type TaskRow = {
  id: string; revision: number; entity_type: EntityType; entity_id: string; assignee: string; stage: Stage; state: "open" | "done";
  outcome: string | null; wh_id: string | null; added_to_db: boolean; disposition: string | null; warehouse_ids: number[];
};

const conflict = () => new ApiError(409, "This card changed or is no longer available to edit. Refresh to see its latest state.", "ASSIGNMENT_CONFLICT");

async function startBoardWrite(client: PoolClient, viewer: Viewer, employee?: string | null, allocationLock = false) {
  const actor = viewer.email.toLowerCase();
  const assignee = employee?.trim().toLowerCase() || actor;
  if (assignee !== actor && !viewer.isAdmin) throw new ApiError(403, "Only admins can edit another employee's work.");
  // Moves retain the same lock order as allocation/reopening. Notes, dates and
  // call logging cannot change ownership; their row locks/revisions suffice.
  await client.query(`select ${allocationLock ? "pg_advisory_xact_lock(81620404), " : ""}
    set_config('bolna.actor',$1,true), set_config('bolna.employee_workflow','board',true)`, [actor]);
  if (assignee !== actor && !(await client.query("select 1 from bolna_app_users where email=$1 and active for share", [assignee])).rowCount) {
    throw new ApiError(404, "This employee is no longer available.");
  }
  return assignee;
}

/** Bind every task to the authorized assignee, including for admins. */
async function lockTasks(client: PoolClient, assignee: string, refs: TaskRef[], warehouses = false): Promise<TaskRow[]> {
  const rows = (await client.query<TaskRow>(`select a.id::text, a.revision, a.entity_type, a.entity_id::text, a.assignee, a.stage, a.state,
        a.outcome, a.wh_id, a.added_to_db, a.disposition,
        ${warehouses ? "array(select distinct w.warehouse_id from bolna_warehouse_matches w where w.entity_type = a.entity_type and w.entity_id = a.entity_id order by 1)" : "array[]::integer[]"} as warehouse_ids
      from bolna_assignments a
     where a.id = any($1::bigint[]) and a.state <> 'dropped' and a.assignee = $2
     order by a.id for update of a`, [refs.map(ref => ref.id), assignee])).rows;
  const revisions = new Map(refs.map(ref => [ref.id, ref.revision]));
  if (rows.length !== revisions.size || rows.some(row => revisions.get(row.id) !== row.revision)) throw conflict();
  return rows;
}

// The shared deployment can run with the ownership trigger disabled, so reopening
// is checked here, as updateAssignment does. Validate a whole card in bounded
// statements, including warehouse guards, before any of its tasks are changed.
async function assertMovesAllowed(client: PoolClient, plans: { task: TaskRow; plan: MovePlan }[]) {
  const guarded = plans.filter(({ plan }) => plan.reopen || plan.leavesWarehouse);
  if (guarded.length) {
    const registered = await client.query(`select 1 from bolna_assignments t
      join bolna_warehouse_matches w on w.entity_type = t.entity_type and w.entity_id = t.entity_id
      where t.id = any($1::bigint[]) limit 1`, [guarded.map(({ task }) => task.id)]);
    if (registered.rowCount) throw new ApiError(409, "This number already has a warehouse in the DB, so its finished work cannot be reopened or moved out of 4 Warehouse ID.", "WAREHOUSE_ALREADY_ADDED");
  }
  const reopening = plans.filter(({ plan }) => plan.reopen);
  if (reopening.length) {
    const owner = await client.query(`select 1 from bolna_assignments t
      cross join lateral (${contactTargets("t.entity_type", "t.entity_id")}) contacts
      join bolna_assignments a on a.entity_type = contacts.entity_type and a.entity_id = contacts.entity_id
      where t.id = any($1::bigint[]) and a.state = 'open' and a.id <> all($2::bigint[]) limit 1`,
      [reopening.map(({ task }) => task.id), plans.map(({ task }) => task.id)]);
    if (owner.rowCount) throw new ApiError(409, "This phone number already has open work. Ask an admin to reassign it before reopening.");
  }
}

async function calledToday(client: PoolClient, taskIds: string[]): Promise<Set<string>> {
  if (!taskIds.length) return new Set();
  const result = await client.query<{ id: string }>(`select distinct assignment_id::text as id from bolna_effective_manual_attempts
     where assignment_id = any($1::bigint[]) and disposition = any($2::text[])
       and occurred_at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')
       and occurred_at < ((date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '1 day') at time zone 'Asia/Kolkata')`, [taskIds, STRIKE_DISPOSITIONS]);
  return new Set(result.rows.map(row => row.id));
}

/** Records the unanswered call that a move into RnR stands for, once per task per IST day. */
async function recordNoAnswers(client: PoolClient, viewer: Viewer, tasks: Pick<TaskRow, "id" | "assignee">[]) {
  if (!tasks.length) return;
  const rows = tasks.map(task => {
    const id = randomUUID();
    return { id, assignment_id: task.id, assignee: task.assignee, request_hash: allocationHash({ source: "board", assignmentId: task.id, attempt: id }) };
  });
  await client.query(`insert into bolna_manual_attempts(id, assignment_id, actor, assignee, occurred_at, disposition, request_hash)
    select x.id, x.assignment_id, $2, x.assignee, now(), 'no_answer', x.request_hash
    from jsonb_to_recordset($1::jsonb) x(id uuid, assignment_id bigint, assignee text, request_hash text)`, [JSON.stringify(rows), viewer.email.toLowerCase()]);
}

export async function moveCard(viewer: Viewer, input: { tasks: TaskRef[]; stage: Stage; reason?: string | null; whId?: string | null }, employee?: string | null): Promise<MovedTask[]> {
  return transaction(async client => {
    const assignee = await startBoardWrite(client, viewer, employee, true);
    const tasks = await lockTasks(client, assignee, input.tasks, true);
    const plans = tasks.map(task => {
      try { return { task, plan: planMove({ ...task, warehouseIds: task.warehouse_ids }, input) }; }
      catch (error) { if (error instanceof MoveError) throw new ApiError(422, error.message, error.code, error.field); throw error; }
    });
    await assertMovesAllowed(client, plans);
    const changed = plans.filter(({ plan }) => !plan.unchanged);
    const candidates = changed.filter(({ plan }) => plan.logNoAnswer && plan.state === "open").map(({ task }) => task);
    const called = await calledToday(client, candidates.map(task => task.id));
    const logged = candidates.filter(task => !called.has(task.id));
    const logIds = new Set(logged.map(task => task.id));
    const updates = changed.map(({ task, plan }) => ({ id: task.id, ...plan, disposition: logIds.has(task.id) ? "no_answer" : plan.disposition, logCall: logIds.has(task.id) }));
    const moved = updates.length ? (await client.query<MovedTask>(`update bolna_assignments a set
        stage = p.stage, state = p.state, outcome = p.outcome, wh_id = p."whId", added_to_db = p."addedToDb",
        disposition = p.disposition, closure_reason = p."closureReason",
        outcome_attempt_id = case when a.outcome is distinct from p.outcome then null else a.outcome_attempt_id end,
        next_due_at = case when p."clearFollowUp" then null else a.next_due_at end,
        completed_at = case when p.state = 'open' then null when a.state <> 'done' then now() else a.completed_at end,
        last_attempt_at = case when p."logCall" then now() else a.last_attempt_at end,
        revision = a.revision + 1
      from jsonb_to_recordset($1::jsonb) p(id bigint, stage text, state text, outcome text, "whId" text, "addedToDb" boolean,
        disposition text, "closureReason" text, "clearFollowUp" boolean, "logCall" boolean)
      where a.id = p.id returning a.id::text, a.revision, a.stage, a.state`, [JSON.stringify(updates)])).rows : [];
    await recordNoAnswers(client, viewer, logged);
    const byId = new Map(moved.map(row => [row.id, row]));
    return tasks.map(task => byId.get(task.id) ?? { id: task.id, revision: task.revision, stage: task.stage, state: task.state });
  });
}

export async function updateTaskNotes(viewer: Viewer, id: string, input: { revision: number; remarks: string | null }, employee?: string | null) {
  return transaction(async client => {
    const assignee = await startBoardWrite(client, viewer, employee);
    const result = await client.query<{ id: string; revision: number; remarks: string | null }>(`update bolna_assignments
        set remarks = $2, revision = revision + 1
      where id = $1 and revision = $3 and state <> 'dropped' and assignee = $4
      returning id::text, revision, remarks`, [id, input.remarks, input.revision, assignee]);
    if (!result.rowCount) throw conflict();
    return result.rows[0];
  });
}

/**
 * Records another unanswered call on each open task of a card. Strikes count IST
 * days, so a task already called today is skipped and `logged` says how many counted.
 */
export async function logNoAnswer(viewer: Viewer, input: { tasks: TaskRef[] }, employee?: string | null) {
  return transaction(async client => {
    const assignee = await startBoardWrite(client, viewer, employee);
    const tasks = (await lockTasks(client, assignee, input.tasks)).filter(task => task.state === "open");
    if (!tasks.length) throw new ApiError(422, "Finished work takes no more calls. Move the card to an open stage first.", "TASK_FINISHED");
    const called = await calledToday(client, tasks.map(task => task.id));
    const logged = tasks.filter(task => !called.has(task.id));
    if (logged.length) await client.query("update bolna_assignments set disposition = 'no_answer', last_attempt_at = now(), revision = revision + 1 where id = any($1::bigint[])", [logged.map(task => task.id)]);
    await recordNoAnswers(client, viewer, logged);
    const strikes = (await client.query<{ strikes: number }>(`select count(distinct (occurred_at at time zone 'Asia/Kolkata')::date)::int as strikes
      from bolna_effective_manual_attempts where assignment_id = any($1::bigint[]) and disposition = any($2::text[])`,
      [input.tasks.map(task => task.id), STRIKE_DISPOSITIONS])).rows[0].strikes;
    return { logged: logged.length, strikes };
  });
}

/** Follow-ups apply to the card's open tasks; finished tasks keep none. */
export async function setFollowUp(viewer: Viewer, input: { tasks: TaskRef[]; nextDueAt: string | null }, employee?: string | null) {
  return transaction(async client => {
    const assignee = await startBoardWrite(client, viewer, employee);
    const tasks = await lockTasks(client, assignee, input.tasks);
    const open = tasks.filter(task => task.state === "open").map(task => task.id);
    if (!open.length) throw new ApiError(422, "Finished work has no follow-up date. Move the card to an open stage first.", "TASK_FINISHED", "next_due_at");
    return (await client.query<{ id: string; revision: number }>(`update bolna_assignments set next_due_at = $2, revision = revision + 1
      where id = any($1::bigint[]) returning id::text, revision`, [open, input.nextDueAt])).rows;
  });
}

/**
 * Stage moves and edits for the viewer's visible tasks on one card. Logged calls are
 * included only when `includeCalls` is set: employees do not see manual call records.
 */
export async function cardTimeline(viewer: Viewer, ids: string[], { includeCalls = false } = {}): Promise<TimelineEvent[]> {
  const scope = [ids, viewer.isAdmin, viewer.email.toLowerCase()];
  const visible = "a.id = any($1::bigint[]) and a.state <> 'dropped' and ($2::boolean or a.assignee = $3)";
  const [audit, attempts] = await Promise.all([
    query<AuditRow>(`select c.assignment_id::text as task_id, c.actor, u.name as actor_name, c.changed_at::text as at, c.before_values, c.after_values
        from bolna_assignment_changes c join bolna_assignments a on a.id = c.assignment_id left join bolna_app_users u on u.email = c.actor
       where ${visible} and c.before_values <> '{}'::jsonb order by c.changed_at desc, c.id desc limit 200`, scope),
    includeCalls ? query<AttemptRow>(`select e.assignment_id::text as task_id, e.actor, u.name as actor_name, e.occurred_at::text as at, e.disposition, e.outcome, e.notes
        from bolna_effective_manual_attempts e join bolna_assignments a on a.id = e.assignment_id left join bolna_app_users u on u.email = e.actor
       where ${visible} order by e.occurred_at desc limit 100`, scope) : Promise.resolve({ rows: [] as AttemptRow[] }),
  ]);
  return timelineEvents(audit.rows, attempts.rows).slice(0, 200);
}
