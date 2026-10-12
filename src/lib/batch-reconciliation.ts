import { z } from "zod";
import { query, transaction } from "./db";
import { ApiError } from "./api";
import { normNum } from "./queue";

const snapshotSchema = z.object({
  batch_id: z.string(), status: z.string(), valid_contacts: z.number().int().nonnegative(),
}).passthrough();
const executionSchema = z.object({
  status: z.string(), retry_count: z.number().int().nonnegative().optional(),
  batch_run_details: z.object({ retried: z.number().int().nonnegative().optional() }).passthrough().optional(),
  telephony_data: z.object({ to_number: z.string().nullable().optional() }).passthrough().nullable().optional(),
}).passthrough();
type Execution = z.infer<typeof executionSchema>;
const TERMINAL = new Set(["completed", "call-disconnected", "failed", "busy", "no-answer", "canceled", "stopped", "error", "balance-low"]);
const RETRYABLE = new Set(["no-answer", "busy", "failed", "error"]);

export function executionsFinished(expected: string[], executions: Execution[]): boolean {
  // A failed attempt can have a delayed retry. Without exhaustion metadata we keep
  // the reservation; elapsed time and a terminal webhook alone are not sufficient.
  if (!executions.length) return false;
  if (executions.some(e => !TERMINAL.has(e.status))) return false;
  return expected.every(phone => executions.some(e => normNum(e.telephony_data?.to_number) === phone &&
    (!RETRYABLE.has(e.status) || (e.retry_count ?? e.batch_run_details?.retried ?? -1) >= 3)));
}

async function providerGet(path: string): Promise<unknown> {
  if (!process.env.BOLNA_API_KEY) throw new ApiError(503, "Calling service is not configured");
  const res = await fetch(`https://api.bolna.ai${path}`, {
    headers: { Authorization: `Bearer ${process.env.BOLNA_API_KEY}` }, signal: AbortSignal.timeout(15_000), cache: "no-store",
  });
  if (!res.ok) throw new ApiError(502, `Calling service status check failed (${res.status})`);
  return res.json();
}

export async function reconcileBatch(id: string) {
  const batch = (await query(`select * from call_batches where id = $1`, [id])).rows[0];
  if (!batch) throw new ApiError(404, "Batch not found");
  if (["completed", "canceled"].includes(batch.state)) return batch;
  if (["sending", "creating", "scheduling"].includes(batch.state) && Date.now() - new Date(batch.updated_at).getTime() < 300_000) {
    throw new ApiError(409, "Dispatch is still in progress; check again after it finishes");
  }
  if (!batch.bolna_batch_id) throw new ApiError(409, "No provider ID was saved. Verify the batch in Bolna and resolve it manually.");
  const remote = snapshotSchema.parse(await providerGet(`/batches/${encodeURIComponent(batch.bolna_batch_id)}`));
  if (remote.batch_id !== batch.bolna_batch_id) throw new ApiError(502, "Calling service returned a different batch");
  let complete = false;
  if (remote.status === "executed") {
    const executions = z.array(executionSchema).max(80000).parse(await providerGet(`/batches/${encodeURIComponent(batch.bolna_batch_id)}/executions`));
    const items = await query<{ contact_number: string }>("select contact_number from call_batch_items where batch_id = $1", [id]);
    const expected = [...new Set(items.rows.map(r => normNum(r.contact_number)))];
    complete = expected.length > 0 && remote.valid_contacts === expected.length && executionsFinished(expected, executions);
  }
  return transaction(async client => {
    const result = await client.query(`update call_batches set state = $2, updated_at = now(), last_error = null,
      completed_at = case when $2 = 'completed' then now() else completed_at end
      where id = $1 and state not in ('completed', 'canceled') returning *`,
    [id, complete ? "completed" : ["scheduled", "queued", "executed"].includes(remote.status) ? "scheduled" : "uncertain"]);
    if (complete && result.rowCount) await client.query("delete from bolna_dispatch_reservations where batch_id = $1", [id]);
    return result.rows[0] ?? batch;
  });
}

export async function resolveBatch(id: string, state: "completed" | "canceled", note: string, actor: string) {
  return transaction(async client => {
    const result = await client.query(`update call_batches set state = $2, resolution_note = $3, resolved_by = $4,
      completed_at = now(), updated_at = now(), last_error = null
      where id = $1 and state not in ('completed', 'canceled')
        and not (state in ('sending', 'creating', 'scheduling') and updated_at > now() - interval '5 minutes') returning id`, [id, state, note, actor]);
    if (!result.rowCount) throw new ApiError(409, "Batch is sending, already resolved, or no longer available");
    await client.query("delete from bolna_dispatch_reservations where batch_id = $1", [id]);
  });
}

export async function reconcileBatches() {
  await query(`update call_batches set state = 'uncertain', last_error = 'Dispatch interrupted; confirmation required'
    where state in ('sending', 'creating', 'scheduling') and updated_at < now() - interval '5 minutes'`);
  const batches = await query<{ id: string }>(`select id from call_batches where state in ('uncertain', 'scheduled')
    and bolna_batch_id is not null order by updated_at, id limit 5`);
  let succeeded = 0;
  for (const batch of batches.rows) {
    try { await reconcileBatch(batch.id); succeeded++; }
    catch (error) {
      await query("update call_batches set last_error = $2, updated_at = now() where id = $1", [batch.id, String(error).slice(0, 1000)]);
    }
  }
  return { checked: batches.rows.length, succeeded };
}
