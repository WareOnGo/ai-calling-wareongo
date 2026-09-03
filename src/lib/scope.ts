// Row-level visibility scope. THE single chokepoint for "employees only see what
// they've been assigned" — both grid filter builders (lib/calls.ts, lib/raw.ts) run
// every query through this, so the CSV exports and the queue endpoint inherit the
// scope for free because they share those builders.
//
// Framework-free and unit-tested (see scope.test.ts). Takes a structural
// { email, isAdmin } rather than importing CurrentUser, so tests don't pull in
// next/headers.
//
// NOT enforced with Postgres RLS: the app connects as one pooled role over the
// Supabase session pooler, so per-request `set local` is fragile, and every read
// already funnels through the two filter builders. The tradeoff: this only holds as
// long as nobody queries bolna_call_logs / raw_records outside lib/calls.ts and
// lib/raw.ts. Add new read paths there, not ad hoc.

export type EntityType = "record" | "call";

export type Viewer = { email: string; isAdmin: boolean };

/**
 * SQL predicate restricting rows to the viewer's assignments, or null for an admin
 * (who sees everything). Pushes its parameter onto `params`, matching the
 * mutate-as-you-go convention of the surrounding filter builders.
 *
 * Visibility is "not dropped", NOT "open": a finished item stays in the employee's
 * view so they can see their own history and untick a Done they set by mistake.
 * Only an admin unassigning them (state='dropped') makes a row disappear.
 *
 * EXISTS rather than a join: an entity can have several assignments over time, and
 * a join would multiply rows. EXISTS also lets the planner use
 * idx_assignments_assignee instead of evaluating a per-row subquery.
 *
 * `entity` is a closed union and `idExpr` is a caller-supplied constant — no user
 * input is interpolated here.
 */
export function assignmentScope(
  viewer: Viewer,
  entity: EntityType,
  idExpr: string,
  params: unknown[],
): string | null {
  if (viewer.isAdmin) return null;
  params.push(viewer.email.toLowerCase());
  return `exists (select 1 from bolna_assignments a
                   where a.entity_type = '${entity}'
                     and a.entity_id = ${idExpr}
                     and a.assignee = $${params.length}
                     and a.state <> 'dropped')`;
}

/**
 * The one assignment to show for an entity: the open one if there is one, else the
 * most recent finished one. Used by both grids' display lateral so "who owns this"
 * is answered identically everywhere.
 */
export function currentAssignmentLateral(entity: EntityType, idExpr: string): string {
  // `id` is aliased: exposing a bare `id` from the lateral makes an unqualified `id`
  // in the outer select list ambiguous against the driving table's own id.
  return `left join lateral (
    select a.id as assignment_id, a.assignee, a.state, a.outcome, a.remarks, a.note, a.attempts
      from bolna_assignments a
     where a.entity_type = '${entity}' and a.entity_id = ${idExpr} and a.state <> 'dropped'
     order by (a.state = 'open') desc, a.assigned_at desc
     limit 1
  ) asg on true`;
}

/** Outcome vocabulary shared with the AI channel (bolna_call_logs.llm_availability). */
export const OUTCOMES = ["Available", "Unavailable", "Unclear"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const ASSIGNMENT_STATES = ["open", "done", "dropped"] as const;
export type AssignmentState = (typeof ASSIGNMENT_STATES)[number];

export function isOutcome(v: unknown): v is Outcome {
  return typeof v === "string" && (OUTCOMES as readonly string[]).includes(v);
}

export function isAssignmentState(v: unknown): v is AssignmentState {
  return typeof v === "string" && (ASSIGNMENT_STATES as readonly string[]).includes(v);
}
