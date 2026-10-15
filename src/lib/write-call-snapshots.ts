import type { PoolClient } from "pg";
import { executionSchema, normalize } from "./bolna";

/** Only provider-owned columns are written. Manual annotations and assignments stay intact. */
export async function writeCallSnapshots(client: PoolClient, payloads: unknown[]) {
  if (!payloads.length) return 0;
  const executions = payloads.map(value => executionSchema.parse(value));
  const facts = executions.map(raw => ({ ...normalize(raw), raw }));
  if (new Set(facts.map(c => c.id)).size !== facts.length) throw new Error("Duplicate execution IDs in snapshot page");
  const phone = (c: typeof facts[number]) => String((c.call_type === "inbound" ? c.from_number : c.to_number) ?? "").replace(/\D/g, "").slice(-10);
  const phones = [...new Set(facts.map(phone).filter(value => value.length === 10))].sort();
  const saved = await client.query<{ phone_last10: string; phone_id: string }>(`insert into raw_phone_numbers(phone_last10,phone)
    select value,'+91'||value from unnest($1::text[]) value order by value
    on conflict(phone_last10) do update set phone=coalesce(raw_phone_numbers.phone,excluded.phone)
    returning phone_last10,phone_id`, [phones]);
  const ids = new Map(saved.rows.map(row => [row.phone_last10, row.phone_id]));
  const columns = ["id", "agent_id", "batch_id", "status", "call_type", "from_number", "to_number", "duration_secs", "total_cost",
    "cost_breakdown", "recording_url", "hangup_by", "hangup_reason", "answered_by_vm", "transcript", "context_details", "raw", "call_created_at", "phone_id"];
  const changed = `(bolna_call_logs.transcript is distinct from excluded.transcript or
    bolna_call_logs.status is distinct from excluded.status or bolna_call_logs.total_cost is distinct from excluded.total_cost)`;
  const inferenceColumns = ["llm_availability", "built_up_area_sqft", "carpet_area_sqft", "city_area", "expected_rent", "possession", "confidence", "notes", "enrichment", "inference_model"];
  const result = await client.query(`insert into bolna_call_logs (${columns.join(",")})
    select ${columns.join(",")} from jsonb_populate_recordset(null::bolna_call_logs,$1::jsonb) order by id
    on conflict(id) do update set ${columns.filter(k => k !== "id").map(k => `${k}=excluded.${k}`).join(",")},
      ${inferenceColumns.map(k => `${k}=case when ${changed} then null else bolna_call_logs.${k} end`).join(",")},
      enriched=case when ${changed} then false else bolna_call_logs.enriched end,
      inference_version=case when ${changed} then 0 else bolna_call_logs.inference_version end,
      needs_review=case when ${changed} then false else bolna_call_logs.needs_review end,
      inferred_district=case when ${changed} or bolna_call_logs.context_details is distinct from excluded.context_details then null else bolna_call_logs.inferred_district end,
      processed_at=now()
    where bolna_execution_newer(excluded.raw,bolna_call_logs.raw)`,
  [JSON.stringify(facts.map(c => ({ ...c, phone_id: ids.get(phone(c)) ?? null })))]);
  return result.rowCount ?? 0;
}
