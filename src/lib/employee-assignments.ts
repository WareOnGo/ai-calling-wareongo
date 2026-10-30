// Preserves the employee task editing contract from main before the visual overhaul.
// The admin/manual-call workflows continue to use assignments.updateAssignment.
import { ApiError } from "./api";
import { transaction } from "./db";
import type { CurrentUser } from "./auth";
import { contactTargets, type EntityType, type Outcome, type AssignmentState } from "./scope";

export type AssignmentPatch = { outcome?: Outcome | null; remarks?: string | null; addedToDb?: boolean; whId?: string | null; state?: AssignmentState; revision: number };
type AssignmentRow = { revision: number; id: string; state: string; outcome: string | null; remarks: string | null; added_to_db: boolean; wh_id: string | null };

export async function updateMyWorkAssignment(
  id: string,
  user: CurrentUser,
  patch: AssignmentPatch,
): Promise<AssignmentRow | null> {
  if (patch.state === "dropped") throw new ApiError(403, "Only admins can unassign work");
  const sets: string[] = [];
  const vals: unknown[] = [];

  if ("outcome" in patch) { vals.push(patch.outcome ?? null); sets.push(`outcome = $${vals.length}`); }
  if ("remarks" in patch) { vals.push(patch.remarks ?? null); sets.push(`remarks = $${vals.length}`); }
  if ("addedToDb" in patch) { vals.push(patch.addedToDb); sets.push(`added_to_db = $${vals.length}`); }
  if ("whId" in patch) { vals.push(patch.whId || null); sets.push(`wh_id = $${vals.length}`); }
  if (patch.state) {
    vals.push(patch.state);
    sets.push(`state = $${vals.length}`);
    // completed_at tracks when work stopped, for either terminal state.
    sets.push(`completed_at = case when $${vals.length} = 'open' then null else now() end`);
  }
  if (sets.length === 0) return null;

  sets.push("revision = revision + 1");
  vals.push(patch.revision);
  const revisionParam = `$${vals.length}`;
  vals.push(id);
  const idParam = `$${vals.length}`;
  vals.push(user.email.toLowerCase());
  const ownership = ` and assignee = $${vals.length}`;

  const sql = `update bolna_assignments set ${sets.join(", ")}
      where id = ${idParam}${ownership} and state <> 'dropped' and revision = ${revisionParam}
      returning revision, id, state, outcome, remarks, added_to_db, wh_id`;
  const res = await transaction(async client => {
    await client.query("select set_config('bolna.actor',$1,true), set_config('bolna.employee_workflow','classic',true)", [user.email.toLowerCase()]);
    if (patch.state === "open") {
      await client.query("select pg_advisory_xact_lock(81620404)");
      const current = (await client.query<{ entity_type: EntityType; entity_id: string; state: string }>(
        `select entity_type,entity_id,state from bolna_assignments
          where id=$1 and revision=$2 and state<>'dropped' and assignee=$3 for update`,
        [id, patch.revision, user.email.toLowerCase()],
      )).rows[0];
      if (!current) throw new ApiError(409, "Assignment changed or is no longer editable. Refresh to review the latest version.");
      if (current.state !== "open") {
        const owner = await client.query(`select 1 from (${contactTargets('$1::text', '$2::uuid')}) contacts
          join bolna_assignments a using(entity_type,entity_id)
          where a.state='open' and a.id<>$3::bigint limit 1`, [current.entity_type, current.entity_id, id]);
        if (owner.rowCount) {
          throw new ApiError(409, "This phone number already has open work. Ask an admin to reassign it before reopening.");
        }
      }
    }
    return client.query<AssignmentRow>(sql, vals);
  });
  if (!res.rowCount) throw new ApiError(409, "Assignment changed or is no longer editable. Refresh to review the latest version.");
  return res.rows[0] ?? null;
}
