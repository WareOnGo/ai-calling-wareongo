import { createHash } from 'node:crypto';

export const IMPORT_NAME = 'wag-warehouse-contacts-v1';

export function warehouseContacts(warehouses) {
  const pairs = new Map();
  for (const warehouse of warehouses) {
    if (!Number.isSafeInteger(warehouse.id) || warehouse.id <= 0) throw new Error('Invalid integer warehouse ID');
    for (const field of ['contactNumber', 'alt_phone_number']) {
      for (const token of String(warehouse[field] || '').split(/[,;/|\r\n]+/)) {
        const digits = token.replace(/\D/g, '');
        if (digits.length < 10 || digits.length > 15) continue;
        const phone = digits.slice(-10), key = `${phone}:${warehouse.id}`;
        const pair = pairs.get(key) || { phone_last10: phone, warehouse_id: warehouse.id, source_fields: [] };
        if (!pair.source_fields.includes(field)) pair.source_fields.push(field);
        pairs.set(key, pair);
      }
    }
  }
  return [...pairs.values()].sort((a,b) => a.phone_last10.localeCompare(b.phone_last10) || a.warehouse_id-b.warehouse_id);
}

// Caller owns the transaction. Dry runs can roll back the same code as apply.
// No periodic job, remote credentials, or source DB writes are installed.
export async function backfillWarehouseContacts(client, warehouses, snapshotAt) {
  await client.query('select pg_advisory_xact_lock(81620404)');
  const previous = (await client.query('select summary from bolna_warehouse_imports where name=$1', [IMPORT_NAME])).rows[0];
  if (previous) return { ...previous.summary, alreadyApplied: true };
  const contacts = warehouseContacts(warehouses);
  if (!contacts.length) throw new Error('Refusing an empty warehouse snapshot');
  const sourceHash = createHash('sha256').update(JSON.stringify(contacts)).digest('hex');
  await client.query(`insert into bolna_warehouse_imports(name,snapshot_at,source_sha256) values($1,$2,$3)`, [IMPORT_NAME, snapshotAt, sourceHash]);
  await client.query(`insert into bolna_warehouse_contacts(phone_last10,warehouse_id,source_fields,import_name)
    select phone_last10,warehouse_id,source_fields,$2 from jsonb_to_recordset($1::jsonb)
    as x(phone_last10 text,warehouse_id int,source_fields text[])`, [JSON.stringify(contacts), IMPORT_NAME]);
  await client.query("select set_config('bolna.actor','warehouse-contact-backfill',true)");

  // Fill only an empty, unambiguous WHID. All IDs remain in the phone association.
  // Existing notes, outcomes, owners, states, timestamps and nonempty IDs survive.
  const assignments = await client.query(`with matches as (
    select a.id,array_agg(distinct w.warehouse_id order by w.warehouse_id) ids
    from bolna_assignments a join bolna_warehouse_matches w using(entity_type,entity_id) group by a.id
  ), proposed as (
    select a.id,case when nullif(trim(a.wh_id),'') is null and cardinality(m.ids)=1
      and bolna_completion_issue(a.id,a.state,a.outcome,m.ids[1]::text,a.remarks,a.closure_reason,false) is null
      then m.ids[1]::text else a.wh_id end wh_id
    from bolna_assignments a join matches m using(id)
  ) update bolna_assignments a set wh_id=p.wh_id,added_to_db=true,revision=a.revision+1
    from proposed p where p.id=a.id and (a.wh_id is distinct from p.wh_id or not a.added_to_db) returning a.id`);
  const calls = await client.query(`with matches as (
    select entity_id,array_agg(distinct warehouse_id order by warehouse_id) ids
    from bolna_warehouse_matches where entity_type='call' group by entity_id
  ), proposed as (
    select c.id,case when nullif(trim(c.wh_id),'') is null and cardinality(m.ids)=1 then m.ids[1]::text else c.wh_id end wh_id
    from bolna_call_logs c join matches m on m.entity_id=c.id
  ) update bolna_call_logs c set wh_id=p.wh_id,added_to_db=true,revision=c.revision+1
    from proposed p where p.id=c.id and (c.wh_id is distinct from p.wh_id or not c.added_to_db) returning c.id`);
  const counts = (await client.query(`select
    (select count(distinct phone_last10)::int from bolna_warehouse_contacts) warehouse_numbers,
    (select count(*)::int from raw_phone_numbers p where exists(select 1 from bolna_warehouse_contacts w where w.phone_last10=p.phone_last10)) matched_raw_numbers,
    (select count(distinct entity_id)::int from bolna_warehouse_matches where entity_type='record') matched_raw_records,
    (select count(*)::int from bolna_assignments a where exists(select 1 from bolna_warehouse_matches w where w.entity_type=a.entity_type and w.entity_id=a.entity_id)) matched_assignments,
    (select count(*)::int from bolna_assignments a where nullif(trim(a.wh_id),'') is null and exists(select 1 from bolna_warehouse_matches w where w.entity_type=a.entity_type and w.entity_id=a.entity_id)) matched_assignments_without_single_whid`)).rows[0];
  const summary = { sourceWarehouses: warehouses.length, associations: contacts.length, ...counts,
    assignmentsUpdated: assignments.rowCount, callsUpdated: calls.rowCount, snapshotAt, sourceHash };
  await client.query('update bolna_warehouse_imports set summary=$2::jsonb where name=$1', [IMPORT_NAME, JSON.stringify(summary)]);
  return summary;
}
