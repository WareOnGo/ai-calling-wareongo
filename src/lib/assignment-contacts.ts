import type { PoolClient } from "pg";
import type { EntityType } from "./scope";

// Use the existing normalized phone keys across both channels, including every
// alternate listing number. The fallback covers calls with only a phone_id.
// This query works on baseline + 001–005; no handoff migration is required.
export const CONTACT_PHONES_SQL = `
  select 'record'::text entity_type, rp.master_id entity_id, p.phone_last10
    from raw_phones rp join raw_phone_numbers p using(phone_id)
    where p.phone_last10 ~ '^[0-9]{10}$'
  union all
  select 'call', c.id, c.phone_last10 from bolna_call_logs c
    where c.phone_last10 ~ '^[0-9]{10}$'
  union all
  select 'call', c.id, p.phone_last10 from bolna_call_logs c
    join raw_phone_numbers p using(phone_id)
    where coalesce(c.phone_last10,'') !~ '^[0-9]{10}$' and p.phone_last10 ~ '^[0-9]{10}$'`;

// Expressions are source-code constants, never request input.
export function contactTargets(entity: EntityType, idExpr: string): string {
  const phones = `select phone_last10 from (${CONTACT_PHONES_SQL}) target
    where target.entity_type='${entity}' and target.entity_id=${idExpr}`;
  // Join each related table through its phone index. Joining two expanded UNION
  // relations made PostgreSQL scan the entire contact set for every grid row.
  return `select '${entity}'::text entity_type, ${idExpr} entity_id
    union select 'record',rp.master_id from (${phones}) target
      join raw_phone_numbers p using(phone_last10) join raw_phones rp using(phone_id)
    union select 'call',c.id from (${phones}) target
      join bolna_call_logs c using(phone_last10)
    union select 'call',c.id from (${phones}) target
      join raw_phone_numbers p using(phone_last10) join bolna_call_logs c using(phone_id)
      where coalesce(c.phone_last10,'') !~ '^[0-9]{10}$'`;
}

/** Shared by grids, counts, exports and "assign all matching". */
export function contactOwnershipFilter(entity: EntityType, idExpr: string, assignee: string, params: unknown[]): string {
  let owner = "";
  if (assignee !== "none") { params.push(assignee.toLowerCase()); owner = `and a.assignee=$${params.length}`; }
  const ownedPhones = `select distinct owned.phone_last10 from bolna_assignments a
    join (${CONTACT_PHONES_SQL}) owned using(entity_type,entity_id)
    where a.state<>'dropped' ${owner}`;
  const owned = `select a.entity_id from bolna_assignments a
      where a.entity_type='${entity}' and a.state<>'dropped' ${owner}
    union all select target.entity_id from (${CONTACT_PHONES_SQL}) target
      where target.entity_type='${entity}' and target.phone_last10 in (${ownedPhones})`;
  // Deduplicate phone history and entity IDs before membership checks. Otherwise
  // repeated calls inflate the join and can cause a rescan for every source row.
  // All three entity_id sources are NOT NULL, so NOT IN cannot lose null-phone rows.
  return `${idExpr} ${assignee === "none" ? "not in" : "in"}
    (select distinct entity_id from (${owned}) contact_owned)`;
}

// Serialize ownership creation only: bulk assignment and reopening. Notes,
// outcomes, completion, reads and previews never acquire this lock. Checking and
// inserting on one transaction prevents different row IDs winning the same phone.
export async function lockAssignmentOwnership(client: PoolClient) {
  await client.query("select pg_advisory_xact_lock(81620404)");
}

export async function assignmentPhones(client: PoolClient, entity: EntityType, ids: string[]) {
  return (await client.query<{ entity_id: string; phone_last10: string }>(
    `select distinct entity_id,phone_last10 from (${CONTACT_PHONES_SQL}) contacts
      where entity_type=$1 and entity_id=any($2::uuid[]) order by entity_id,phone_last10`, [entity, ids],
  )).rows;
}

export type ContactAssignment = { id: string; entity_type: EntityType; entity_id: string; assignee: string; state: string; phones: string[] };
export async function contactAssignments(client: PoolClient, entity: EntityType, ids: string[], phones: string[]) {
  return (await client.query<ContactAssignment>(
    `select a.id::text,a.entity_type,a.entity_id,a.assignee,a.state,
      coalesce(array_agg(distinct c.phone_last10) filter(where c.phone_last10 is not null),'{}') phones
     from bolna_assignments a left join (${CONTACT_PHONES_SQL}) c using(entity_type,entity_id)
     where a.state<>'dropped' and a.id in (
       select id from bolna_assignments where entity_type=$1 and entity_id=any($2::uuid[])
       union select related.id from (${CONTACT_PHONES_SQL}) p
         join bolna_assignments related using(entity_type,entity_id) where p.phone_last10=any($3::text[])
     ) group by a.id order by a.id`, [entity, ids, phones],
  )).rows;
}
