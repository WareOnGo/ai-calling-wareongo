import { randomUUID } from "node:crypto";
import { query, transaction } from "./db";
import { executionSchema, normalize } from "./bolna";
import { envInt } from "./api";

type Event = { id: string; raw: unknown; attempts: number; lease_token: string };

export async function claimEvent(): Promise<Event | undefined> {
  // Attempts include crashed runs. Exhausted jobs stay visible for operator review.
  const res = await query<Event>(`with due as (
    select id from bolna_webhook_events
    where attempts < max_attempts and (
      (status in ('pending', 'failed') and next_attempt_at <= now()) or
      (status = 'processing' and coalesce(lease_until, '-infinity') <= now()))
    order by next_attempt_at, id for update skip locked limit 1
  ) update bolna_webhook_events e set status = 'processing', attempts = attempts + 1,
      lease_token = $1, lease_until = now() + interval '90 seconds'
    from due where e.id = due.id returning e.id, e.raw, e.attempts, e.lease_token`, [randomUUID()]);
  return res.rows[0];
}

export async function storeEvent(row: Event): Promise<boolean> {
  const c = normalize(executionSchema.parse(row.raw));
  return transaction(async client => {
    // A reclaimed claim fences the previous worker, including its call-log write.
    const owned = await client.query(`select id from bolna_webhook_events
      where id = $1 and lease_token = $2 and status = 'processing' and lease_until > now() for update`, [row.id, row.lease_token]);
    if (!owned.rowCount) return false;
    const number = c.call_type === "inbound" ? c.from_number : c.to_number;
    const digits = String(number ?? "").replace(/\D/g, "").slice(-10);
    let phoneId: string | null = null;
    if (digits.length === 10) {
      const phone = await client.query(`insert into raw_phone_numbers(phone_last10, phone) values ($1, $2)
        on conflict(phone_last10) do update set phone = coalesce(raw_phone_numbers.phone, excluded.phone) returning phone_id`, [digits, `+91${digits}`]);
      phoneId = phone.rows[0].phone_id;
    }
    const facts = { ...c, raw: row.raw, phone_id: phoneId };
    const columns = ["id", "agent_id", "batch_id", "status", "call_type", "from_number", "to_number", "duration_secs", "total_cost",
      "cost_breakdown", "recording_url", "hangup_by", "hangup_reason", "answered_by_vm", "transcript", "context_details", "raw", "call_created_at", "phone_id"] as const;
    const changed = `(bolna_call_logs.transcript is distinct from excluded.transcript or
      bolna_call_logs.status is distinct from excluded.status or bolna_call_logs.total_cost is distinct from excluded.total_cost)`;
    const inferenceColumns = ["llm_availability", "built_up_area_sqft", "carpet_area_sqft", "city_area", "expected_rent", "possession", "confidence", "notes", "enrichment", "inference_model"];
    await client.query(`insert into bolna_call_logs (${columns.join(",")}) values (${columns.map((_, i) => `$${i + 1}`).join(",")})
      on conflict(id) do update set ${columns.filter(k => k !== "id").map(k => `${k} = excluded.${k}`).join(",")},
      ${inferenceColumns.map(k => `${k} = case when ${changed} then null else bolna_call_logs.${k} end`).join(",")},
      enriched = case when ${changed} then false else bolna_call_logs.enriched end,
      inference_version = case when ${changed} then 0 else bolna_call_logs.inference_version end,
      needs_review = case when ${changed} then false else bolna_call_logs.needs_review end,
      inferred_district = case when ${changed} or bolna_call_logs.context_details is distinct from excluded.context_details then null else bolna_call_logs.inferred_district end,
      processed_at = now()`, columns.map(k => facts[k]));
    await client.query(`update bolna_webhook_events set status = 'processed', processed_at = now(), last_error = null,
      lease_token = null, lease_until = null where id = $1 and lease_token = $2`, [row.id, row.lease_token]);
    return true;
  });
}

export async function runEvents() {
  const deadline = Date.now() + 35_000;
  const results: { id: string; ok: boolean }[] = [];
  const limit = envInt("PROCESS_BATCH_SIZE", 20, 100);
  while (results.length < limit && Date.now() < deadline) {
    const row = await claimEvent();
    if (!row) break;
    try { results.push({ id: row.id, ok: await storeEvent(row) }); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        await query(`update bolna_webhook_events set status = 'failed', last_error = $3,
          next_attempt_at = now() + $4 * interval '1 minute', lease_token = null, lease_until = null
          where id = $1 and lease_token = $2`, [row.id, row.lease_token, message.slice(0, 1000), Math.min(2 ** row.attempts, 60)]);
      } catch (failure) { console.error("[process] failure update failed; lease will expire", failure); }
      results.push({ id: row.id, ok: false });
    }
  }
  return { claimed: results.length, succeeded: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results };
}
