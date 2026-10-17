import { z } from "zod";
import {createHash,randomUUID} from "node:crypto";
import { query, transaction } from "./db";
import { ApiError } from "./api";
import { normNum } from "./queue";
import {executionMetadataSchema,executionSchema,TERMINAL_STATUSES} from './bolna';
import {applyExecutionSnapshots} from './apply-execution-snapshots';

const snapshotSchema = z.object({
  batch_id: z.string(), status: z.string(), valid_contacts: z.number().int().nonnegative(),
}).passthrough();
type Execution = z.infer<typeof executionMetadataSchema>;
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
  if (executions.some(e => !TERMINAL_STATUSES.has(e.status) || e.status === "call-disconnected")) return false;
  if (providerCompleted && executions.some(e =>
    typeof e.batch_run_details?.status === "string" && !["completed", "stopped", "canceled"].includes(e.batch_run_details.status))) return false;
  return expected.every(phone => executions.some(e => normNum(e.telephony_data?.to_number ?? (typeof e.user_number === 'string' ? e.user_number : undefined)) === phone &&
    (providerCompleted || !RETRYABLE.has(e.status) || retryCount(e) >= 3)));
}

async function providerGet(path: string, timeoutMs = 15_000): Promise<unknown> {
  if (!process.env.BOLNA_API_KEY) throw new ApiError(503, "Calling service is not configured");
  const res = await fetch(`https://api.bolna.ai${path}`, {
    method: "GET", headers: { Authorization: `Bearer ${process.env.BOLNA_API_KEY}` }, signal: AbortSignal.timeout(timeoutMs), cache: "no-store",
  });
  if (!res.ok) throw new ApiError(502, `Calling service status check failed (${res.status})`);
  // This account's paginated batch endpoint returns 404. Bound the documented
  // legacy snapshot read, then import at most 1,000 executions per invocation.
  const reader=res.body?.getReader();
  if(!reader)throw new ApiError(502,'Calling service returned an empty response');
  const chunks:Uint8Array[]=[];let bytes=0;
  try {
    while(true){const part=await reader.read();if(part.done)break;
      bytes+=part.value.byteLength;
      if(bytes>100*1024*1024)throw new ApiError(502,'Batch snapshot exceeds the 100 MiB polling limit');
      chunks.push(part.value);
    }
  } finally {await reader.cancel();}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function reconcileBatch(id: string, automatic=false) {
  const batch = (await query(`select * from call_batches where id = $1`, [id])).rows[0];
  if (!batch) throw new ApiError(404, "Batch not found");
  if (["completed", "canceled"].includes(batch.state)) return batch;
  if (["sending", "creating", "scheduling"].includes(batch.state) && Date.now() - new Date(batch.updated_at).getTime() < 300_000) {
    throw new ApiError(409, "Dispatch is still in progress; check again after it finishes");
  }
  if (!batch.bolna_batch_id) throw new ApiError(409, "No provider ID was saved. Verify the batch in Bolna and resolve it manually.");
  const token=randomUUID(),deadline=Date.now()+75_000;
  const lease=await query(`update call_batches set reconciliation_token=$2,reconciliation_lease_until=now()+interval '3 minutes',updated_at=now()
    where id=$1 and state not in ('completed','canceled') and (reconciliation_lease_until is null or reconciliation_lease_until<now())
      and (not $3::boolean or updated_at<date_bin(interval '5 minutes',now(),timestamptz '2000-01-01')) returning id`,[id,token,automatic]);
  if(!lease.rowCount)throw new ApiError(409,'This batch is already being checked or was resolved.');
  try {
    const remote = snapshotSchema.parse(await providerGet(`/batches/${encodeURIComponent(batch.bolna_batch_id)}`));
    if (remote.batch_id !== batch.bolna_batch_id) throw new ApiError(502, "Calling service returned a different batch");
    let complete = false;
    const finishing=["completed", "stopped", "executed"].includes(remote.status);
    if (["scheduled", "queued", "running", "completed", "stopped", "executed", "failed"].includes(remote.status)) {
      const executions = z.array(executionSchema).max(80000).parse(await providerGet(`/batches/${encodeURIComponent(batch.bolna_batch_id)}/executions`, Math.max(1,Math.min(45_000,deadline-Date.now()))));
      if (executions.some(execution => (execution.batch_id != null && execution.batch_id !== batch.bolna_batch_id) ||
        (batch.agent_id && execution.agent_id != null && execution.agent_id !== batch.agent_id))) {
        throw new ApiError(502, "Calling service returned executions from a different batch");
      }
      if(new Set(executions.map(e=>e.id)).size!==executions.length)throw new ApiError(502,'Calling service returned duplicate execution IDs');
      // A stable snapshot fingerprint makes cursors safe even when the provider
      // reorders deliveries or changes the snapshot between checks.
      const snapshots=executions.map(execution=>({...execution,batch_id:batch.bolna_batch_id})).sort((a,b)=>a.id.localeCompare(b.id));
      const serialized=snapshots.map(execution=>JSON.stringify(execution,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)
          ?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value),
      );
      const hash=finishing?createHash('sha256').update(serialized.join('\n')).digest('hex'):null;
      // Active snapshots change continuously. Resume by stable execution ID so
      // updates at the front cannot starve older pages. Wrap for a fresh sweep.
      const cursor=(await query<{reconciliation_after_id:string|null}>(`select reconciliation_after_id from call_batches where id=$1 and reconciliation_token=$2`,[id,token])).rows[0];
      if(!cursor)throw new ApiError(409,'Batch check was superseded.');
      const after=cursor.reconciliation_after_id?snapshots.findIndex(e=>e.id>cursor.reconciliation_after_id!):0;
      let offset=finishing?Number((await query(`update call_batches set reconciliation_offset=case when reconciliation_hash=$3 then reconciliation_offset else 0 end,
        reconciliation_hash=$3,reconciliation_after_id=null where id=$1 and reconciliation_token=$2 returning reconciliation_offset`,[id,token,hash])).rows[0]?.reconciliation_offset):Math.max(0,after);
      if(!Number.isSafeInteger(offset)||offset<0)throw new ApiError(409,'Batch check was superseded.');
      // Each invocation does at most 1,000 upserts so large batches yield to
      // other cron work. The page and cursor commit together, not on job exit.
      let deferred=false;
      for(let pages=0;offset<serialized.length&&pages<4&&Date.now()<deadline;pages++){
        const end=Math.min(offset+250,serialized.length);
        const applied=await transaction(async client=>{
          const current=await client.query("select id from call_batches where id=$1 and reconciliation_token=$2 and reconciliation_lease_until>now() and state not in ('completed','canceled') for update",[id,token]);
          if(!current.rowCount)throw new ApiError(409,'Batch check was superseded.');
          const result=await applyExecutionSnapshots(client,snapshots.slice(offset,end),'reconcile',true);
          if(!result.deferred)await client.query(`update call_batches set reconciliation_offset=$3,
            reconciliation_hash=$4,reconciliation_after_id=$5,reconciliation_lease_until=now()+interval '3 minutes',updated_at=now()
            where id=$1 and reconciliation_token=$2`,[id,token,end,hash,finishing||end===snapshots.length?null:snapshots[end-1].id]);
          return result;
        });
        if(applied.deferred){deferred=true;break;}
        offset=end;
      }
      if(finishing&&!deferred&&offset===executions.length){
        const items=await query<{contact_number:string}>("select contact_number from call_batch_items where batch_id=$1",[id]);
        const expected=[...new Set(items.rows.map(r=>normNum(r.contact_number)))];
        complete=expected.length>0&&remote.valid_contacts===expected.length&&executionsFinished(expected,executions,['completed','stopped'].includes(remote.status));
      }
    }
    return await transaction(async client => {
      const result = await client.query(`update call_batches set state = $2, updated_at = now(), last_error = null,
        completed_at = case when $2 in ('completed','canceled') then now() else completed_at end,
        resolution_note = case when $2='canceled' then coalesce(resolution_note,'Stopped in Bolna; all target executions verified finished.') else resolution_note end,
        reconciliation_checked_at=now(),reconciliation_provider_state=$4,reconciliation_counts=$5,
        reconciliation_token=null,reconciliation_lease_until=null
        where id = $1 and reconciliation_token=$3 and reconciliation_lease_until>now() and state not in ('completed', 'canceled') returning *`,
      [id, complete ? remote.status==='stopped'?'canceled':'completed' : ["scheduled", "queued", "running", "executed", "completed"].includes(remote.status) ? "scheduled" : "uncertain",token,remote.status,remote.execution_status??null]);
      if (complete && result.rowCount) await client.query("delete from bolna_dispatch_reservations where batch_id = $1", [id]);
      return result.rows[0] ?? batch;
    });
  } catch(error) {
    await query(`update call_batches set last_error=$3,updated_at=now() where id=$1 and reconciliation_token=$2
      and state not in ('completed','canceled')`,[id,token,error instanceof z.ZodError?'Calling service returned an invalid execution snapshot':error instanceof Error?error.message.slice(0,1000):'Could not check batch status']);
    throw error;
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
  const batches = await query<{ id: string }>(`select id from call_batches where state in ('uncertain', 'scheduled', 'failed')
    and bolna_batch_id is not null and (scheduled_at is null or scheduled_at<=now())
    and updated_at<date_bin(interval '5 minutes',now(),timestamptz '2000-01-01') and (reconciliation_lease_until is null or reconciliation_lease_until<now())
    order by updated_at, id limit 5`);
  let succeeded = 0, checked = 0;const started=Date.now();
  for (const batch of batches.rows) {
    if(Date.now()-started>180_000)break;
    try { await reconcileBatch(batch.id,true); checked++; succeeded++; }
    catch (error) {
      if(error instanceof ApiError&&error.status===409)continue;
      checked++;
    }
  }
  return { checked, succeeded };
}

// One automatic check per five-minute window across cron, tabs and admins.
// A rolling five-minute cooldown would skip every other cron tick because the
// previous poll finishes a few seconds after the tick that started it.
export async function syncVisibleBatches(ids: string[]) {
  const candidates = await query<{id:string}>(`select id from call_batches
    where id=any($1::uuid[]) and state in ('scheduled','uncertain','failed') and bolna_batch_id is not null
      and (scheduled_at is null or scheduled_at<=now())
      and updated_at<date_bin(interval '5 minutes',now(),timestamptz '2000-01-01')
      and (reconciliation_lease_until is null or reconciliation_lease_until<now())
    order by updated_at,id limit 3`, [[...new Set(ids)]]);
  let completed = 0, failed = 0, checked = 0;const started=Date.now();
  for (const {id} of candidates.rows) {
    if(Date.now()-started>150_000)break;
    try { if ((await reconcileBatch(id,true)).state === 'completed') completed++; checked++; }
    catch (error) {
      if (error instanceof ApiError && error.status === 409) continue;
      checked++;failed++;
    }
  }
  return {checked,completed,failed};
}
