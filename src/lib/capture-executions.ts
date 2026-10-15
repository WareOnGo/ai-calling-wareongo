import type { PoolClient } from "pg";
import { executionSchema, TERMINAL_STATUSES } from "./bolna";

/** Capture actual provider dials and advance the inbox using the same ordering rule. */
export async function captureExecutions(client: PoolClient, deliveries: unknown[], origin = "webhook") {
  const executions = deliveries.map(value => executionSchema.parse(value));
  if (!executions.length) return [] as string[];
  if (new Set(executions.map(e => e.id)).size !== executions.length) throw new Error("Duplicate execution IDs in capture page");
  const json = JSON.stringify(executions);
  await client.query("select bolna_record_ai_evidence(value,$2) from jsonb_array_elements($1::jsonb)", [json, origin]);
  // Retained facts belong to this exact dial, never an earlier retry. In particular,
  // a sparse completed update must keep its earlier phone, transcript and duration.
  const queued = await client.query<{ id: string }>(`with deliveries as (
    select (value->>'id')::uuid id,value raw from jsonb_array_elements($1::jsonb)
  ), incoming as (
    select d.id,case when a.raw is null then d.raw
      when bolna_execution_newer(bolna_merge_ai_payload(a.raw,d.raw),a.raw) then bolna_merge_ai_payload(a.raw,d.raw)
      else a.raw end raw
    from deliveries d left join bolna_ai_attempts a on a.execution_id=d.id
      and a.provider_call_id=nullif(trim(d.raw#>>'{telephony_data,provider_call_id}'),'')
    where d.raw->>'status'=any($2::text[])
  ) insert into bolna_webhook_events(id,raw,status,next_attempt_at,retry_count)
    select i.id,i.raw,'pending',now(),bolna_retry_index(i.raw) from incoming i
    where not exists(select 1 from bolna_call_logs c where c.id=i.id and c.raw is not null
      and not bolna_execution_newer(i.raw,c.raw))
    order by i.id
    on conflict(id) do update set raw=excluded.raw,retry_count=excluded.retry_count,
      status='pending',attempts=0,next_attempt_at=now(),processed_at=null,
      lease_token=null,lease_until=null,last_error=null
      where bolna_execution_newer(excluded.raw,bolna_webhook_events.raw)
    returning id`, [json, [...TERMINAL_STATUSES]]);
  return queued.rows.map(row => row.id);
}
