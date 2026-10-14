export type AiAttemptSummary = {
  total: number;
  outbound: number;
  inbound: number;
  conversations: number;
  result: "Available" | "Unavailable" | "Unclear" | null;
};

// A retained dial can appear under multiple executions/listings. Deduplicate by
// normalized contact + provider call ID, retaining genuine repeat calls. Calls
// without a number stay execution-scoped instead of merging unrelated contacts.
// `where` is a trusted SQL expression from the read layer, never request input.
export function distinctAiAttemptsSql(where: string) {
  return `select distinct on (coalesce(nullif(ai_attempt.phone_last10,''),ai_attempt.execution_id::text),ai_attempt.provider_call_id) ai_attempt.*
    from bolna_ai_attempts ai_attempt where ${where}
    order by coalesce(nullif(ai_attempt.phone_last10,''),ai_attempt.execution_id::text),ai_attempt.provider_call_id,
      bolna_status_rank(ai_attempt.status) desc,ai_attempt.provider_updated_at desc nulls last,ai_attempt.last_observed_at desc,ai_attempt.execution_id`;
}

// The same scope as aiHistory: a listing's linked numbers, or one execution.
// Arguments are trusted SQL expressions supplied by the read layer, never input.
export function aiAttemptScopeSql(entity: "record" | "call", id: string) {
  const contacts = `in (select phone_last10 from bolna_assignment_contacts where entity_type='record' and entity_id=${id})`;
  return entity === "record" ? `ai_attempt.phone_last10 ${contacts}` : `ai_attempt.execution_id=${id}`;
}

export function aiAttemptsExistSql(entity: "record" | "call", id: string) {
  return `exists(select 1 from bolna_ai_attempts ai_attempt where ${aiAttemptScopeSql(entity,id)})`;
}

export function aiAttemptSummarySql(entity: "record" | "call", id: string) {
  const attempts = aiAttemptScopeSql(entity,id);
  const calls = entity === "record" ? `ac.phone_id in (select phone_id from raw_phones where master_id=${id})` : `ac.id=${id}`;
  return `select count(*)::int as total,
    count(*) filter (where ai.direction='outbound')::int as outbound,
    count(*) filter (where ai.direction='inbound')::int as inbound,
    count(*) filter (where ai.confirmed_conversation)::int as conversations,
    (select case max(case bolna_availability(ac.status,ac.llm_availability)
      when 'Available' then 3 when 'Unavailable' then 2 when 'Unclear' then 1 end)
      when 3 then 'Available' when 2 then 'Unavailable' when 1 then 'Unclear' end
      from bolna_call_logs ac where ${calls} and ac.status is distinct from 'balance-low') as result
    from (${distinctAiAttemptsSql(attempts)}) ai`;
}
