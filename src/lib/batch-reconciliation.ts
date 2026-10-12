import { z } from "zod";
import {createHash,randomUUID} from "node:crypto";
import { query, transaction } from "./db";
import { ApiError } from "./api";
import { normNum } from "./queue";
import {executionMetadataSchema,TERMINAL_STATUSES} from './bolna';

const snapshotSchema = z.object({
  batch_id: z.string(), status: z.string(), valid_contacts: z.number().int().nonnegative(),
}).passthrough();
const executionSchema = executionMetadataSchema;
type Execution = z.infer<typeof executionSchema>;
const RETRYABLE = new Set(["no-answer", "busy", "failed", "error"]);
function retryCount(e:Execution){
 const raw=e.retry_count??e.batch_run_details?.retried;
 if(raw===null||raw===undefined||raw==='')return -1;
 const n=Number(raw);return Number.isSafeInteger(n)&&n>=0?n:-1;
}

export function executionsFinished(expected: string[], executions: Execution[], providerCompleted = false): boolean {
  // Current Bolna batches finish as "completed" (including configured retries).
  // Legacy "executed" only proves dispatch, so it still needs retry exhaustion.
  // Neither a result count nor elapsed time establishes completion on its own.
  if (!executions.length) return false;
  if (executions.some(e => !TERMINAL_STATUSES.has(e.status))) return false;
  if (providerCompleted && executions.some(e => e.status === "call-disconnected" ||
    (typeof e.batch_run_details?.status === "string" && !["completed", "stopped", "canceled"].includes(e.batch_run_details.status)))) return false;
  return expected.every(phone => executions.some(e => normNum(e.telephony_data?.to_number) === phone &&
    (providerCompleted || !RETRYABLE.has(e.status) || retryCount(e) >= 3)));
}

async function providerGet(path: string, timeoutMs = 15_000): Promise<unknown> {
  if (!process.env.BOLNA_API_KEY) throw new ApiError(503, "Calling service is not configured");
  const res = await fetch(`https://api.bolna.ai${path}`, {
    headers: { Authorization: `Bearer ${process.env.BOLNA_API_KEY}` }, signal: AbortSignal.timeout(timeoutMs), cache: "no-store",
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
  const token=randomUUID();
  const lease=await query(`update call_batches set reconciliation_token=$2,reconciliation_lease_until=now()+interval '2 minutes',updated_at=now()
    where id=$1 and state not in ('completed','canceled') and (reconciliation_lease_until is null or reconciliation_lease_until<now()) returning id`,[id,token]);
  if(!lease.rowCount)throw new ApiError(409,'This batch is already being checked or was resolved.');
  try {
    const remote = snapshotSchema.parse(await providerGet(`/batches/${encodeURIComponent(batch.bolna_batch_id)}`));
    if (remote.batch_id !== batch.bolna_batch_id) throw new ApiError(502, "Calling service returned a different batch");
    let complete = false;
    if (["completed", "stopped", "executed"].includes(remote.status)) {
      // Large historical snapshots can exceed the short metadata-read timeout.
      const executions = z.array(executionSchema).max(80000).parse(await providerGet(`/batches/${encodeURIComponent(batch.bolna_batch_id)}/executions`, 45_000));
      if (executions.some(execution => execution.batch_id != null && execution.batch_id !== batch.bolna_batch_id)) {
        throw new ApiError(502, "Calling service returned executions from a different batch");
      }
      // A stable snapshot fingerprint makes cursors safe even when the provider
      // reorders deliveries or changes the snapshot between checks.
      const serialized=executions.map(execution=>({
        identity:`${execution.id??''}:${execution.telephony_data?.provider_call_id??''}`,
        payload:JSON.stringify(execution,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)
          ?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value),
      })).sort((a,b)=>a.identity.localeCompare(b.identity)||a.payload.localeCompare(b.payload)).map(e=>e.payload);
      const hash=createHash('sha256').update(serialized.join('\n')).digest('hex');
      let offset=Number((await query(`update call_batches set reconciliation_offset=case when reconciliation_hash=$3 then reconciliation_offset else 0 end,
        reconciliation_hash=$3 where id=$1 and reconciliation_token=$2 returning reconciliation_offset`,[id,token,hash])).rows[0]?.reconciliation_offset);
      if(!Number.isSafeInteger(offset)||offset<0)throw new ApiError(409,'Batch check was superseded.');
      // Each invocation does at most 1,000 upserts so large batches yield to
      // other cron work. The page and cursor commit together, not on job exit.
      for(let pages=0;offset<serialized.length&&pages<4;pages++){
        const end=Math.min(offset+250,serialized.length);
        await transaction(async client=>{
          const current=await client.query("select id from call_batches where id=$1 and reconciliation_token=$2 and state not in ('completed','canceled') for update",[id,token]);
          if(!current.rowCount)throw new ApiError(409,'Batch check was superseded.');
          await client.query("select bolna_record_ai_evidence(value,'reconcile') from jsonb_array_elements($1::jsonb)",['['+serialized.slice(offset,end).join(',')+']']);
          await client.query("update call_batches set reconciliation_offset=$3,reconciliation_lease_until=now()+interval '2 minutes',updated_at=now() where id=$1 and reconciliation_token=$2",[id,token,end]);
        });
        offset=end;
      }
      if(offset===executions.length){
        const items=await query<{contact_number:string}>("select contact_number from call_batch_items where batch_id=$1",[id]);
        const expected=[...new Set(items.rows.map(r=>normNum(r.contact_number)))];
        complete=expected.length>0&&remote.valid_contacts===expected.length&&executionsFinished(expected,executions,['completed','stopped'].includes(remote.status));
      }
    }
    return await transaction(async client => {
      const result = await client.query(`update call_batches set state = $2, updated_at = now(), last_error = null,
        completed_at = case when $2 in ('completed','canceled') then now() else completed_at end,
        resolution_note = case when $2='canceled' then coalesce(resolution_note,'Stopped in Bolna; all target executions verified finished.') else resolution_note end,
        reconciliation_token=null,reconciliation_lease_until=null
        where id = $1 and reconciliation_token=$3 and state not in ('completed', 'canceled') returning *`,
      [id, complete ? remote.status==='stopped'?'canceled':'completed' : ["scheduled", "queued", "running", "executed", "completed"].includes(remote.status) ? "scheduled" : "uncertain",token]);
      if (complete && result.rowCount) await client.query("delete from bolna_dispatch_reservations where batch_id = $1", [id]);
      return result.rows[0] ?? batch;
    });
  } finally {
    await query("update call_batches set reconciliation_token=null,reconciliation_lease_until=null where id=$1 and reconciliation_token=$2",[id,token]);
  }
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
  let succeeded = 0, checked = 0;const started=Date.now();
  for (const batch of batches.rows) {
    if(Date.now()-started>150_000)break;
    checked++;
    try { await reconcileBatch(batch.id); succeeded++; }
    catch (error) {
      await query("update call_batches set last_error = $2, updated_at = now() where id = $1", [batch.id, String(error).slice(0, 1000)]);
    }
  }
  return { checked, succeeded };
}

// A visible batch page also checks its active batches. The stored update time and
// existing reconciliation lease bound requests across tabs and concurrent admins.
export async function syncVisibleBatches(ids: string[]) {
  const candidates = await query<{id:string}>(`select id from call_batches
    where id=any($1::uuid[]) and state in ('scheduled','uncertain','failed') and bolna_batch_id is not null
      and (scheduled_at is null or scheduled_at<=now()) and updated_at<now()-interval '1 minute'
      and (reconciliation_lease_until is null or reconciliation_lease_until<now())
    order by updated_at,id limit 3`, [[...new Set(ids)]]);
  let completed = 0, failed = 0, checked = 0;const started=Date.now();
  for (const {id} of candidates.rows) {
    if(Date.now()-started>150_000)break;
    checked++;
    try { if ((await reconcileBatch(id)).state === 'completed') completed++; }
    catch (error) {
      if (error instanceof ApiError && error.status === 409) continue;
      failed++;
      await query(`update call_batches set last_error=$2,updated_at=now() where id=$1
        and state not in ('completed','canceled') and reconciliation_token is null`,
      [id,error instanceof Error?error.message.slice(0,1000):'Could not check batch status']);
    }
  }
  return {checked,completed,failed};
}
