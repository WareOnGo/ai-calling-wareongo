import type { PoolClient } from 'pg';

// Arguments are trusted SQL expressions from the read layer, never user input.
export function warehouseMatchSql(entity: string, id: string) {
  return `exists(select 1 from bolna_warehouse_matches w where w.entity_type=${entity} and w.entity_id=${id})`;
}

export function warehouseIdsSql(entity: string, id: string) {
  return `array(select distinct w.warehouse_id from bolna_warehouse_matches w
    where w.entity_type=${entity} and w.entity_id=${id} order by w.warehouse_id)`;
}

export async function warehousesByPhone(client: Pick<PoolClient, 'query'>, phones: string[]) {
  const rows = (await client.query<{ phone_last10: string; warehouse_ids: number[] }>(
    `select phone_last10,array_agg(warehouse_id order by warehouse_id) warehouse_ids
     from bolna_warehouse_contacts where phone_last10=any($1::text[]) group by phone_last10`, [phones])).rows;
  return new Map(rows.map(row => [row.phone_last10, row.warehouse_ids]));
}
