import { randomUUID } from "node:crypto";
import { query, transaction } from "./db";
import { executionSchema } from "./bolna";
import { writeCallSnapshots } from "./write-call-snapshots";
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
  const raw = executionSchema.parse(row.raw);
  return transaction(async client => {
    // A reclaimed claim fences the previous worker, including its call-log write.
    const owned = await client.query(`select id from bolna_webhook_events
      where id = $1 and lease_token = $2 and status = 'processing' and lease_until > now() for update`, [row.id, row.lease_token]);
    if (!owned.rowCount) return false;
    await client.query("select bolna_record_ai_evidence($1::jsonb,'worker')", [raw]);
    await writeCallSnapshots(client, [raw]);
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
