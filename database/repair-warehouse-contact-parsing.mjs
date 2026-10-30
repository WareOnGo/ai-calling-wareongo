import { createHash } from 'node:crypto';
import { IMPORT_NAME, warehouseContacts } from './warehouse-contact-backfill.mjs';

export const PARSING_REPAIR_NAME = 'wag-warehouse-contact-parsing-v2';
const key = row => `${row.phone_last10}:${row.warehouse_id}`;

// Replay the old parser solely to identify its errors. Never use these values
// for new imports. A valid alternate token can still support the same pair.
export function warehouseParsingCorrections(warehouses) {
  const accepted = new Set(warehouseContacts(warehouses).map(key));
  const rejected = new Map();
  for (const warehouse of warehouses) {
    for (const field of ['contactNumber', 'alt_phone_number']) {
      for (const token of String(warehouse[field] || '').split(/[,;/|\r\n]+/)) {
        const digits = token.replace(/\D/g, '');
        if (digits.length < 10 || digits.length > 15) continue;
        const pair = { phone_last10: digits.slice(-10), warehouse_id: warehouse.id };
        if (accepted.has(key(pair))) continue;
        const entry = rejected.get(key(pair)) || { ...pair, source_tokens: [] };
        entry.source_tokens.push({ field, value: token });
        rejected.set(key(pair), entry);
      }
    }
  }
  return [...rejected.values()].sort((a, b) => a.phone_last10.localeCompare(b.phone_last10) || a.warehouse_id - b.warehouse_id);
}

// Caller owns the transaction. The same code is used for rollback rehearsal and
// application. This is a one-time parsing repair, not a warehouse refresh.
export async function repairWarehouseContactParsing(client, warehouses, snapshotAt) {
  await client.query('select pg_advisory_xact_lock(81620404)');
  const previous = (await client.query('select summary from bolna_warehouse_imports where name=$1', [PARSING_REPAIR_NAME])).rows[0];
  if (previous) return { ...previous.summary.result, alreadyApplied: true };
  if (!(await client.query('select 1 from bolna_warehouse_imports where name=$1', [IMPORT_NAME])).rowCount)
    throw new Error('The original warehouse import must exist before its parsing repair');
  if (!warehouseContacts(warehouses).length) throw new Error('Refusing an empty valid warehouse snapshot');

  const corrections = warehouseParsingCorrections(warehouses);
  const rows = (await client.query(`select w.* from bolna_warehouse_contacts w
    join jsonb_to_recordset($1::jsonb) as x(phone_last10 text,warehouse_id int)
      using(phone_last10,warehouse_id)
    where w.import_name=$2 order by w.phone_last10,w.warehouse_id for update of w`,
    [JSON.stringify(corrections), IMPORT_NAME])).rows;
  const phones = [...new Set(rows.map(row => row.phone_last10))];
  // The audited errors are unused. If that has changed, do not silently leave
  // dependent saved WHIDs or verification flags behind after removing a match.
  const used = (await client.query(`select
    exists(select 1 from raw_phone_numbers where phone_last10=any($1::text[])) or
    exists(select 1 from bolna_assignment_contacts where phone_last10=any($1::text[])) or
    exists(select 1 from call_batch_items where right(regexp_replace(contact_number,'[^0-9]','','g'),10)=any($1::text[]))
    as used`, [phones])).rows[0].used;
  if (used) throw new Error('Parsing correction affects existing contacts; review their dependent saved fields before applying');

  const count = async () => (await client.query('select count(*)::int n from bolna_warehouse_contacts')).rows[0].n;
  const before = await count();
  const removed = await client.query(`delete from bolna_warehouse_contacts w
    using jsonb_to_recordset($1::jsonb) as x(phone_last10 text,warehouse_id int)
    where w.phone_last10=x.phone_last10 and w.warehouse_id=x.warehouse_id and w.import_name=$2`,
    [JSON.stringify(rows), IMPORT_NAME]);
  if (removed.rowCount !== rows.length) throw new Error('Warehouse associations changed during parsing repair');
  const result = { repair: PARSING_REPAIR_NAME, snapshotAt, sourceWarehouses: warehouses.length,
    rejectedSourcePairs: corrections.length, removedAssociations: rows.length,
    associationsBefore: before, associationsAfter: await count(), affectedExistingContacts: 0 };
  const rejectedByKey = new Map(corrections.map(row => [key(row), row]));
  // Preserve exact removed rows and source evidence in the existing private ledger.
  // The CLI returns counts only, keeping phone values out of operational logs.
  const archive = rows.map(row => ({ association: row, source_tokens: rejectedByKey.get(key(row)).source_tokens }));
  const sourceHash = createHash('sha256').update(JSON.stringify(warehouses)).digest('hex');
  await client.query('insert into bolna_warehouse_imports(name,snapshot_at,source_sha256,summary) values($1,$2,$3,$4::jsonb)',
    [PARSING_REPAIR_NAME, snapshotAt, sourceHash, JSON.stringify({ result, removed_associations: archive })]);
  return result;
}
