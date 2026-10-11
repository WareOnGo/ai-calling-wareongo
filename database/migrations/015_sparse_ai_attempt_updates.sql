-- Sparse updates for the same provider call must retain known identity/timing.
-- Original deliveries remain immutable in bolna_execution_evidence. Projection raw
-- merges fields from accepted deliveries; it is not itself an original delivery.
CREATE OR REPLACE FUNCTION bolna_merge_ai_payload(previous jsonb,candidate jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT previous || jsonb_strip_nulls(candidate) || jsonb_build_object('telephony_data',
 coalesce(previous->'telephony_data','{}'::jsonb) || coalesce(jsonb_strip_nulls(candidate->'telephony_data'),'{}'::jsonb))
$$;
CREATE OR REPLACE FUNCTION bolna_confirmed_ai_conversation(payload jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce(payload->>'status'='completed' AND bolna_numeric_measure(payload->>'conversation_duration')>0
 AND coalesce(payload->>'answered_by_voice_mail','false')<>'true' AND coalesce(payload->>'transcript','') ~* '(^|\n)\s*user\s*:',false)
$$;
create or replace function bolna_record_ai_evidence(payload jsonb, origin text default 'webhook', observed timestamptz default now()) returns void language plpgsql as $$
declare eid uuid; evidence bigint; provider_id text; direction text; phone text;
begin
 if coalesce(payload->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return; end if;
 eid := (payload->>'id')::uuid;
 insert into bolna_execution_evidence(execution_id,payload_hash,raw,source,received_at)
 values(eid,encode(digest(payload::text,'sha256'),'hex'),payload,origin,observed)
 on conflict do nothing returning id into evidence;
 if evidence is null then return; end if;
 provider_id := nullif(trim(payload#>>'{telephony_data,provider_call_id}'),'');
 if provider_id is null or length(provider_id)>1000 or payload->>'status' in ('balance-low','scheduled','queued','rescheduled','canceled','stopped') then return; end if;
 direction:=payload#>>'{telephony_data,call_type}';
 phone:=right(regexp_replace(coalesce(case when direction='inbound' then payload#>>'{telephony_data,from_number}' else payload#>>'{telephony_data,to_number}' end,payload->>'user_number',''),'\D','','g'),10);
 insert into bolna_ai_attempts as current (
  execution_id,provider_call_id,evidence_id,provider,agent_id,batch_id,phone_last10,direction,status,initiated_at,execution_created_at,provider_updated_at,
  duration_seconds,conversation_seconds,confirmed_conversation,first_observed_at,last_observed_at,raw)
 values(eid,provider_id,evidence,coalesce(payload#>>'{telephony_data,provider}',payload->>'provider'),payload->>'agent_id',payload->>'batch_id',nullif(phone,''),direction,payload->>'status',
  bolna_zoned_time(payload->>'initiated_at'),bolna_zoned_time(payload->>'created_at'),bolna_zoned_time(payload->>'updated_at'),
  bolna_numeric_measure(payload#>>'{telephony_data,duration}'),bolna_numeric_measure(payload->>'conversation_duration'),
  bolna_confirmed_ai_conversation(payload),
  observed,observed,payload)
 on conflict(execution_id,provider_call_id) do update set
  evidence_id=excluded.evidence_id,provider=coalesce(excluded.provider,current.provider),agent_id=coalesce(excluded.agent_id,current.agent_id),batch_id=coalesce(excluded.batch_id,current.batch_id),
  phone_last10=coalesce(excluded.phone_last10,current.phone_last10),direction=coalesce(excluded.direction,current.direction),status=coalesce(excluded.status,current.status),
  initiated_at=coalesce(excluded.initiated_at,current.initiated_at),execution_created_at=coalesce(excluded.execution_created_at,current.execution_created_at),provider_updated_at=coalesce(excluded.provider_updated_at,current.provider_updated_at),
  duration_seconds=coalesce(excluded.duration_seconds,current.duration_seconds),conversation_seconds=coalesce(excluded.conversation_seconds,current.conversation_seconds),confirmed_conversation=bolna_confirmed_ai_conversation(bolna_merge_ai_payload(current.raw,excluded.raw)),
  last_observed_at=excluded.last_observed_at,raw=bolna_merge_ai_payload(current.raw,excluded.raw)
 where bolna_execution_newer(bolna_merge_ai_payload(current.raw,excluded.raw),current.raw);
end $$;

-- Run recovery only after the final adapter is installed. A retained delivery can
-- lack status/timing while still containing provider identity and a transcript.
-- Recover identities actually present in payloads; overwritten retries stay unknown.
select bolna_record_ai_evidence(raw,'retained',processed_at) from bolna_call_logs where raw is not null;
select bolna_record_ai_evidence(raw,'retained',received_at) from bolna_webhook_events;
