// Board writes: card moves, notes and follow-up dates. Each runs in one transaction
// under the allocation lock, checks every task's revision before changing any,
// and uses the board workflow exception from migration 020.
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { ApiError } from "./api";
import { query, transaction } from "./db";
import { contactTargets, type EntityType, type Viewer } from "./scope";
import { allocationHash } from "./assignment-allocation";
import { MoveError, STRIKE_DISPOSITIONS, planMove, type Stage } from "./board-stages";
import { timelineEvents, type AttemptRow, type AuditRow, type TimelineEvent } from "./board-timeline";

export type TaskRef = { id: string; revision: number };
export type MovedTask = { id: string; revision: number; stage: Stage; state: "open" | "done" };
type TaskRow = {
  id: string; revision: number; entity_type: EntityType; entity_id: string; assignee: string; stage: Stage; state: "open" | "done";
  outcome: string | null; wh_id: string | null; added_to_db: boolean; disposition: string | null; warehouse_ids: number[];
};

const conflict = () => new ApiError(409, "This card changed or is no longer available to edit. Refresh to see its latest state.", "ASSIGNMENT_CONFLICT");

async function startBoardWrite(client: PoolClient, viewer: Viewer, employee?: string | null) {
  const actor = viewer.email.toLowerCase();
  const assignee = employee?.trim().toLowerCase() || actor;
  if (assignee !== actor && !viewer.isAdmin) throw new ApiError(403, "Only admins can edit another employee's work.");
  // Same lock as allocation and reopening, taken before any row lock.
  await client.query("select pg_advisory_xact_lock(81620404)");
  if (assignee !== actor && !(await client.query("select 1 from bolna_app_users where email=$1 and active for share", [assignee])).rowCount) {
    throw new ApiError(404, "This employee is no longer available.");
  }
  await client.query("select set_config('bolna.actor',$1,true), set_config('bolna.employee_workflow','board',true)", [actor]);
  return assignee;
}

/** Bind every task to the authorized assignee, including for admins. */
async function lockTasks(client: PoolClient, assignee: string, refs: TaskRef[]): Promise<TaskRow[]> {
  const rows = (await client.query<TaskRow>(`select a.id::text, a.revision, a.entity_type, a.entity_id::text, a.assignee, a.stage, a.state,
        a.outcome, a.wh_id, a.added_to_db, a.disposition,
        array(select distinct w.warehouse_id from bolna_warehouse_matches w where w.entity_type = a.entity_type and w.entity_id = a.entity_id order by 1) as warehouse_ids
      from bolna_assignments a
     where a.id = any($1::bigint[]) and a.state <> 'dropped' and a.assignee = $2
     order by a.id for update of a`, [refs.map(ref => ref.id), assignee])).rows;
  const revisions = new Map(refs.map(ref => [ref.id, ref.revision]));
  if (rows.length !== revisions.size || rows.some(row => revisions.get(row.id) !== row.revision)) throw conflict();
  return rows;
}

/** A number whose warehouse is in the DB keeps its finished work, and its stage 4 credit. */
async function assertNoWarehouse(client: PoolClient, task: TaskRow, message: string) {
  const registered = await client.query("select 1 from bolna_warehouse_matches where entity_type = $1 and entity_id = $2 limit 1", [task.entity_type, task.entity_id]);
  if (registered.rowCount) throw new ApiError(409, message, "WAREHOUSE_ALREADY_ADDED");
}

// The shared deployment can run with the ownership trigger disabled, so reopening
// is checked here, as updateAssignment does.
async function assertCanReopen(client: PoolClient, task: TaskRow, cardTaskIds: string[]) {
  await assertNoWarehouse(client, task, "This number already has a warehouse in the DB, so its finished work cannot be reopened.");
  const owner = await client.query(`select 1 from (${contactTargets("$1::text", "$2::uuid")}) contacts
      join bolna_assignments a using(entity_type, entity_id)
     where a.state = 'open' and a.id <> all($3::bigint[]) limit 1`, [task.entity_type, task.entity_id, cardTaskIds]);
  if (owner.rowCount) throw new ApiError(409, "This phone number already has open work. Ask an admin to reassign it before reopening.");
}

async function calledToday(client: PoolClient, taskId: string) {
  const result = await client.query(`select 1 from bolna_effective_manual_attempts
     where assignment_id = $1 and disposition = any($2::text[])
       and (occurred_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date limit 1`, [taskId, STRIKE_DISPOSITIONS]);
  return !!result.rowCount;
}

/** Records the unanswered call that a move into RnR stands for, once per task per IST day. */
export async function recordNoAnswer(client: PoolClient, viewer: Viewer, task: Pick<TaskRow, "id" | "assignee">) {
  const id = randomUUID();
  await client.query(`insert into bolna_manual_attempts(id, assignment_id, actor, assignee, occurred_at, disposition, request_hash)
    values ($1, $2, $3, $4, now(), 'no_answer', $5)`,
    [id, task.id, viewer.email.toLowerCase(), task.assignee, allocationHash({ source: "board", assignmentId: task.id, attempt: id })]);
}

export async function moveCard(viewer: Viewer, input: { tasks: TaskRef[]; stage: Stage; reason?: string | null; whId?: string | null }, employee?: string | null): Promise<MovedTask[]> {
  return transaction(async client => {
    const assignee = await startBoardWrite(client, viewer, employee);
    const tasks = await lockTasks(client, assignee, input.tasks);
    const plans = tasks.map(task => {
      try { return { task, plan: planMove({ ...task, warehouseIds: task.warehouse_ids }, input) }; }
      catch (error) { if (error instanceof MoveError) throw new ApiError(422, error.message, error.code, error.field); throw error; }
    });
    for (const { task, plan } of plans) {
      if (plan.reopen) await assertCanReopen(client, task, tasks.map(t => t.id));
      else if (plan.leavesWarehouse) await assertNoWarehouse(client, task, "This number already has a warehouse in the DB, so it stays in 4 Warehouse ID.");
    }
    const moved: MovedTask[] = [];
    for (const { task, plan } of plans) {
      if (plan.unchanged) { moved.push({ id: task.id, revision: task.revision, stage: task.stage, state: task.state }); continue; }
      const logCall = plan.logNoAnswer && plan.state === "open" && !(await calledToday(client, task.id));
      const row = (await client.query<MovedTask>(`update bolna_assignments set
          stage = $2, state = $3, outcome = $4, wh_id = $5, added_to_db = $6, disposition = $7, closure_reason = $8,
          outcome_attempt_id = case when outcome is distinct from $4 then null else outcome_attempt_id end,
          next_due_at = case when $9 then null else next_due_at end,
          completed_at = case when $3 = 'open' then null when state <> 'done' then now() else completed_at end,
          last_attempt_at = case when $10 then now() else last_attempt_at end,
          revision = revision + 1
        where id = $1 returning id::text, revision, stage, state`,
        [task.id, plan.stage, plan.state, plan.outcome, plan.whId, plan.addedToDb, logCall ? "no_answer" : plan.disposition,
          plan.closureReason, plan.clearFollowUp, logCall])).rows[0];
      if (logCall) await recordNoAnswer(client, viewer, task);
      moved.push(row);
    }
    return moved;
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
    let logged = 0;
    for (const task of tasks) {
      if (await calledToday(client, task.id)) continue;
      await client.query("update bolna_assignments set disposition = 'no_answer', last_attempt_at = now(), revision = revision + 1 where id = $1", [task.id]);
      await recordNoAnswer(client, viewer, task);
      logged++;
    }
    const strikes = (await client.query<{ strikes: number }>(`select count(distinct (occurred_at at time zone 'Asia/Kolkata')::date)::int as strikes
      from bolna_effective_manual_attempts where assignment_id = any($1::bigint[]) and disposition = any($2::text[])`,
      [input.tasks.map(task => task.id), STRIKE_DISPOSITIONS])).rows[0].strikes;
    return { logged, strikes };
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
