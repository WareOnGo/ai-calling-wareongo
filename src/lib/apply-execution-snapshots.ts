import type { PoolClient } from "pg";
import { executionSchema, isTerminal } from "./bolna";
import { captureExecutions } from "./capture-executions";
import { writeCallSnapshots } from "./write-call-snapshots";

/** Shared poll/recovery writer. The caller owns the transaction and batch lease. */
export async function applyExecutionSnapshots(client: PoolClient, payloads: unknown[], origin: string, retainPrevious = false) {
  const executions = payloads.map(value => executionSchema.parse(value));
  if (retainPrevious && executions.length) {
    // Preserve an older dial before its execution/inbox snapshot is replaced.
    await client.query(`select bolna_record_ai_evidence(raw,'poll-retained') from (
      select raw from bolna_call_logs where id=any($1::uuid[])
      union all select raw from bolna_webhook_events where id=any($1::uuid[])
    ) retained where raw is not null`, [executions.map(e => e.id)]);
  }
  await captureExecutions(client, executions, origin);
  const ids = executions.filter(e => isTerminal(e.status)).map(e => e.id);
  // An unchanged active worker keeps its lease. A newer snapshot has already
  // fenced the obsolete worker in captureExecutions; both paths use one writer.
  const ready = (await client.query<{ id: string; raw: unknown }>(`select id,raw from bolna_webhook_events
    where id=any($1::uuid[]) and (status in ('pending','failed') or
      (status='processing' and coalesce(lease_until,'-infinity')<=now()))
    order by id for update skip locked`, [ids])).rows;
  const written = await writeCallSnapshots(client, ready.map(row => row.raw));
  await client.query(`update bolna_webhook_events set status='processed',processed_at=now(),last_error=null,
    attempts=attempts+1,lease_token=null,lease_until=null where id=any($1::uuid[])`, [ready.map(row => row.id)]);
  const deferred = Number((await client.query(`select count(*) n from bolna_webhook_events
    where id=any($1::uuid[]) and status<>'processed'`, [ids])).rows[0].n);
  return { written, deferred };
}
