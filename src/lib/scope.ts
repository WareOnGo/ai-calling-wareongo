import { filterValues,categoryWhere,type FilterValue } from "./filter-values";
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
 * Select the open or latest completed assignment within the viewer's scope.
 * Historical visibility must never project a subsequent assignee's private notes.
 */
export function currentAssignmentLateral(entity: EntityType, idExpr: string, viewer: Viewer, params: unknown[]): string {
  let owner = "";
  if (!viewer.isAdmin) { params.push(viewer.email.toLowerCase()); owner = ` and a.assignee = $${params.length}`; }
  // `id` is aliased: exposing a bare `id` from the lateral makes an unqualified `id`
  // in the outer select list ambiguous against the driving table's own id.
  return `left join lateral (
   select history.*, owner.current_assignee from (select 1) seed
   left join lateral (
    select a.id as assignment_id, a.revision as assignment_revision, a.assignee, a.state, a.outcome, a.remarks, a.note,
           a.added_to_db as asg_added, a.wh_id as asg_wh,a.disposition,a.next_due_at,a.last_attempt_at,a.closure_reason,
           (select count(*)::int from bolna_effective_manual_attempts e where e.assignment_id=a.id) as manual_attempt_count
      from bolna_assignments a
     where a.entity_type = '${entity}' and a.entity_id = ${idExpr} and a.state <> 'dropped'${owner}
     order by (a.state = 'open') desc, a.assigned_at desc, a.id desc
     limit 1
   ) history on true
   left join lateral (
     select a.assignee as current_assignee from (${contactTargets(`'${entity}'`,idExpr)}) contacts
      join bolna_assignments a using(entity_type,entity_id)
      where a.state = 'open'${owner}
      order by (a.entity_type = '${entity}' and a.entity_id = ${idExpr}) desc, a.assigned_at desc, a.id desc limit 1
   ) owner on true
  ) asg on true`;
}

/** Contact ownership spans both work channels; outcome/history remains entity-specific. */
// Both expressions are source-code constants; never interpolate request values.
export function contactTargets(entityExpr: string, idExpr: string): string {
  // Resolve a small set of contact targets before joining their indexed work.
  // A correlated EXISTS per open assignment made a 50-row page scan global work.
  return `select ${entityExpr}::text as entity_type, ${idExpr} as entity_id
    union select 'record',rp.master_id
      from bolna_assignment_contacts target join raw_phone_numbers p using(phone_last10)
      join raw_phones rp using(phone_id)
      where target.entity_type=${entityExpr} and target.entity_id=${idExpr}
    union select 'call',c.id from bolna_assignment_contacts target
      join bolna_call_logs c using(phone_last10)
      where target.entity_type=${entityExpr} and target.entity_id=${idExpr}
    `;
}

export function ownershipFilter(entity: EntityType, idExpr: string, f: { assignee?: FilterValue; assignment_state?: string }, params: unknown[]): string[] {
  // Compute the matching entity set once for a grid/count/export, rather than
  // re-expanding all ownership for every candidate source row.
  const ownedIds = (owner='', states="a.state='open'") => `select a.entity_id from bolna_assignments a where ${states} and a.entity_type='${entity}' ${owner}
    union select target.entity_id from bolna_assignments a
      join bolna_assignment_contacts owned using(entity_type,entity_id)
      join bolna_assignment_contacts target using(phone_last10)
      where ${states} and target.entity_type='${entity}' ${owner}`;
  const open = `${idExpr} in (${ownedIds()})`;
  const assigned = `${idExpr} in (${ownedIds("", "a.state in ('open','done')")})`;
  const where: string[] = [];
  if (f.assignment_state === "unassigned") where.push(`not (${assigned})`);
  if (f.assignment_state === "open") where.push(`(${open})`);
  if (f.assignment_state === "never") where.push(`not (${idExpr} in (${ownedIds("", "true")}))`);
  if (f.assignment_state === "done") where.push(`exists(select 1 from bolna_assignments a where a.entity_type='${entity}' and a.entity_id=${idExpr} and a.state='done')`);
  const assignees=filterValues(f.assignee),named=assignees.filter(email=>email!=="none");
  const ownerChoices:string[]=[];
  if(assignees.includes("none"))ownerChoices.push(`not (${assigned})`);
  if(named.length){
    params.push(named.map(email=>email.toLowerCase()));
    ownerChoices.push(f.assignment_state === 'done'
      ? `exists(select 1 from bolna_assignments a where a.assignee=any($${params.length}::text[]) and a.state='done' and a.entity_type='${entity}' and a.entity_id=${idExpr})`
      : `${idExpr} in (${ownedIds(`and a.assignee=any($${params.length}::text[])`)})`);
  }
  if(ownerChoices.length)where.push(`(${ownerChoices.join(" or ")})`);
  return where;
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


/** Manual verification belongs to the latest visible entity episode, not a phone match. */
export function verificationFilters(entity:EntityType,idExpr:string,viewer:Viewer,f:{manual_outcome?:FilterValue;onboarded?:string},params:unknown[]){
  const where:string[]=[];if(!filterValues(f.manual_outcome).length&&!f.onboarded)return where;let owner="";
  if(!viewer.isAdmin){params.push(viewer.email.toLowerCase());owner=` and a.assignee=$${params.length}`;}
  const latest=`from bolna_assignments a where a.entity_type='${entity}' and a.entity_id=${idExpr} and a.state<>'dropped'${owner} order by (a.state='open') desc,a.assigned_at desc,a.id desc limit 1`;
  const outcome=categoryWhere(`(select a.outcome ${latest})`,f.manual_outcome,params,'none');if(outcome)where.push(outcome);
  if(f.onboarded){const legacy=entity==='call'?`(select c.added_to_db and bolna_recorded_warehouse(c.wh_id) from bolna_call_logs c where c.id=${idExpr})`:'false';const verified=`coalesce((select a.added_to_db and bolna_recorded_warehouse(a.wh_id) ${latest}),${legacy},false)`;where.push(f.onboarded==='yes'?verified:`not ${verified}`);}
  return where;
}
