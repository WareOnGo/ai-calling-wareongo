import { query } from './db';
import type { Viewer } from './scope';
import { recordAccess } from './record-access';
import { ApiError } from './api';
import { agentLabel } from './agents';
import { distinctAiAttemptsSql } from './ai-summary';

export type AiAttempt = {
  execution_id: string; provider_call_id: string; phone_last10: string | null;
  direction: string | null; status: string | null; provider: string | null;
  agent_id: string | null; agent_label: string | null; batch_id: string | null;
  initiated_at: string | null; provider_initiated_at: string | null;
  execution_created_at: string | null; first_observed_at: string;
  duration_seconds: string | null; conversation_seconds: string | null;
  confirmed_conversation: boolean; interval_seconds: string | null;
  availability: string | null; notes: string | null; transcript: string | null; recording_url: string | null;
};
export type AiHistory = {
  rows: AiAttempt[]; total: number; page: number; pages: number; outbound: number;
  inbound: number; conversations: number; contacts: number; unknownExecutions: number;
  scope: 'contact' | 'execution'; batch: string | null; phones: string[]; phone: string | null;
};

export async function aiHistory(viewer: Viewer, entity: 'call' | 'record', id: string,
  options: { page?: number; scope?: 'contact' | 'execution'; batch?: string; phone?: string } = {}): Promise<AiHistory> {
  const { phones } = await recordAccess(viewer, entity, id);
  // Employees following up one execution cannot expand into other callers' tasks.
  const scope = entity === 'record' || viewer.isAdmin && options.scope === 'contact' ? 'contact' : 'execution';
  const requestedPhone = options.phone?.trim();
  const phone = requestedPhone ? requestedPhone.replace(/\D/g, '').slice(-10) : null;
  if (requestedPhone && (!phone || !phones.includes(phone))) throw new ApiError(400, 'Choose a phone number linked to this contact.');
  const params: unknown[] = [id], batch = options.batch?.trim() || null;
  const contact = `in (select phone_last10 from bolna_assignment_contacts where entity_type='${entity}' and entity_id=$1::uuid)`;
  let where = scope === 'execution' ? 'ai_attempt.execution_id=$1::uuid' : `ai_attempt.phone_last10 ${contact}`;
  let unknown = scope === 'execution' ? 'cl.id=$1::uuid' : `cl.phone_last10 ${contact}`;
  if (batch) {
    if (batch.length > 1000) throw new ApiError(400, 'Invalid batch');
    params.push(batch); where += ` and ai_attempt.batch_id=$${params.length}`; unknown += ` and cl.batch_id=$${params.length}`;
  }
  if (phone) {
    params.push(phone); where += ` and ai_attempt.phone_last10=$${params.length}`; unknown += ` and cl.phone_last10=$${params.length}`;
  }
  const unique = distinctAiAttemptsSql(where);
  const summary = (await query(`select count(*)::int total,count(*) filter(where direction='outbound')::int outbound,
    count(*) filter(where direction='inbound')::int inbound,count(*) filter(where confirmed_conversation)::int conversations,
    count(distinct phone_last10)::int contacts,
    (select count(*)::int from bolna_call_logs cl where ${unknown} and cl.status is distinct from 'balance-low'
      and not exists(select 1 from bolna_ai_attempts a where a.execution_id=cl.id)) as unknown_executions
    from (${unique}) calls`, params)).rows[0];
  const unknownExecutions = Number(summary.unknown_executions);
  const pages = Math.max(1, Math.ceil(summary.total / 50));
  const page = Math.min(pages, Math.max(1, Math.floor(Number.isFinite(options.page) ? options.page! : 1)));
  // Intervals and deduplication happen before pagination. Enrichment belongs to
  // a call only when the saved execution still identifies that exact dial.
  // Never repeat a later call's notes/result on earlier retries.
  const rows = summary.total === 0 ? [] : (await query<AiAttempt>(`with unique_calls as (${unique}), dated as (
    select a.*,extract(epoch from (initiated_at-lag(initiated_at) over(partition by phone_last10,direction
      order by initiated_at nulls last,execution_id,provider_call_id)))::text as interval_seconds from unique_calls a
  ), paged as (select * from dated order by initiated_at desc nulls last,first_observed_at desc,execution_id,provider_call_id
    limit 50 offset ${(page - 1) * 50})
  select a.execution_id::text,a.provider_call_id,a.phone_last10,a.direction,a.status,a.provider,a.agent_id,a.batch_id,
    a.initiated_at::text,a.raw->>'initiated_at' as provider_initiated_at,a.execution_created_at::text,a.first_observed_at::text,
    a.duration_seconds::text,a.conversation_seconds::text,a.confirmed_conversation,a.interval_seconds,
    case when c.id is not null then bolna_availability(a.status,c.llm_availability) end as availability,c.notes,
    coalesce(nullif(a.raw->>'transcript',''),c.transcript) as transcript,
    coalesce(nullif(a.raw#>>'{telephony_data,recording_url}',''),nullif(a.raw->>'recording_url',''),c.recording_url) as recording_url
  from paged a left join bolna_call_logs c on c.id=a.execution_id
    and nullif(trim(c.raw#>>'{telephony_data,provider_call_id}'),'')=a.provider_call_id
    and c.phone_last10 is not distinct from a.phone_last10
  order by a.initiated_at desc nulls last,a.first_observed_at desc,a.execution_id,a.provider_call_id`, params)).rows;
  for (const row of rows) {
    const label = agentLabel(row.agent_id);
    row.agent_label = label === 'Hindi' || label === 'English' ? label : null;
  }
  return { rows, total: summary.total, page, pages, outbound: summary.outbound, inbound: summary.inbound,
    conversations: summary.conversations, contacts: summary.contacts, unknownExecutions, scope, batch, phones, phone };
}
