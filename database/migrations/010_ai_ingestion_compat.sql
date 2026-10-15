-- AI ingestion only: usable on legacy 001-005 or existing 006-009 schemas.
-- Existing definitions from 006 are preserved; no assignment policy or trigger changes.

CREATE OR REPLACE FUNCTION bolna_numeric_measure(value text) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN regexp_replace(trim(value),'[,[:space:]]','','g') ~ '^[0-9]+(\.[0-9]+)?$'
    THEN regexp_replace(trim(value),'[,[:space:]]','','g')::numeric ELSE NULL END
$$;
CREATE OR REPLACE FUNCTION bolna_provider_time(value text) RETURNS timestamptz LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
BEGIN
 IF value ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)$' THEN RETURN value::timestamptz; END IF;
 IF value ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?$' THEN RETURN value::timestamp AT TIME ZONE 'UTC'; END IF;
 RETURN NULL;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION bolna_provider_time_newer(candidate text,previous text) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT bolna_provider_time(candidate)>bolna_provider_time(previous)
$$;

create or replace function bolna_retry_index(payload jsonb) returns integer language sql immutable parallel safe as $$
 select case when coalesce(payload->>'retry_count',payload#>>'{batch_run_details,retried}','0') ~ '^\d{1,9}$'
   then coalesce(payload->>'retry_count',payload#>>'{batch_run_details,retried}','0')::integer else 0 end
$$;

create or replace function bolna_status_rank(value text) returns integer language sql immutable parallel safe as $$
 select case when value='completed' then 9 when value in ('failed','busy','no-answer','canceled','stopped','error','balance-low') then 8
  when value='call-disconnected' then 7 when value='in-progress' then 6 when value='ringing' then 5 when value='initiated' then 4 else 1 end
$$;

CREATE OR REPLACE FUNCTION bolna_execution_newer(candidate jsonb,previous jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT previous IS NULL OR (candidate IS DISTINCT FROM previous AND CASE
  WHEN bolna_retry_index(candidate)<>bolna_retry_index(previous) THEN bolna_retry_index(candidate)>bolna_retry_index(previous)
  WHEN nullif(candidate#>>'{telephony_data,provider_call_id}','') IS DISTINCT FROM nullif(previous#>>'{telephony_data,provider_call_id}','')
   AND nullif(previous#>>'{telephony_data,provider_call_id}','') IS NOT NULL THEN
   coalesce(bolna_provider_time_newer(candidate->>'initiated_at',previous->>'initiated_at'),bolna_provider_time_newer(candidate->>'updated_at',previous->>'updated_at'),false)
  WHEN bolna_status_rank(candidate->>'status')<>bolna_status_rank(previous->>'status') THEN bolna_status_rank(candidate->>'status')>bolna_status_rank(previous->>'status')
  ELSE coalesce(bolna_provider_time_newer(candidate->>'updated_at',previous->>'updated_at'),false) END)
$$;

create table if not exists bolna_ai_attempts (
 execution_id uuid not null, provider_call_id text not null,
 provider text, agent_id text, batch_id text, phone_last10 text, direction text, status text,
 initiated_at timestamptz, execution_created_at timestamptz, provider_updated_at timestamptz,
 duration_seconds numeric, conversation_seconds numeric, confirmed_conversation boolean not null default false,
 first_observed_at timestamptz not null, last_observed_at timestamptz not null, raw jsonb not null,
 primary key(execution_id,provider_call_id)
);
create index if not exists bolna_ai_attempts_contact on bolna_ai_attempts(phone_last10,initiated_at desc);
create index if not exists bolna_ai_attempts_batch on bolna_ai_attempts(batch_id,initiated_at desc);

CREATE OR REPLACE FUNCTION bolna_merge_ai_payload(previous jsonb,candidate jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT previous || jsonb_strip_nulls(candidate) || jsonb_build_object('telephony_data',
 coalesce(nullif(previous->'telephony_data','null'::jsonb),'{}'::jsonb)
  || coalesce(jsonb_strip_nulls(nullif(candidate->'telephony_data','null'::jsonb)),'{}'::jsonb))
 || CASE WHEN jsonb_typeof(previous->'batch_run_details')='object' OR jsonb_typeof(candidate->'batch_run_details')='object'
  THEN jsonb_build_object('batch_run_details',
   coalesce(nullif(previous->'batch_run_details','null'::jsonb),'{}'::jsonb)
    || coalesce(jsonb_strip_nulls(nullif(candidate->'batch_run_details','null'::jsonb)),'{}'::jsonb))
  ELSE '{}'::jsonb END
$$;

-- Derive contact identity from the accepted snapshot, never from a partial delivery.
CREATE OR REPLACE FUNCTION bolna_ai_contact_phone(payload jsonb) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT nullif(right(regexp_replace(coalesce(
  CASE WHEN payload#>>'{telephony_data,call_type}'='inbound' THEN payload#>>'{telephony_data,from_number}'
   ELSE payload#>>'{telephony_data,to_number}' END,payload->>'user_number',''),'\D','','g'),10),'')
$$;

CREATE OR REPLACE FUNCTION bolna_confirmed_ai_conversation(payload jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce(payload->>'status'='completed' AND bolna_numeric_measure(payload->>'conversation_duration')>0
 AND coalesce(payload->>'answered_by_voice_mail','false')<>'true' AND coalesce(payload->>'transcript','') ~* '(^|\n)\s*user\s*:',false)
$$;

create or replace function bolna_record_ai_evidence(payload jsonb, origin text default 'webhook', observed timestamptz default now()) returns void language plpgsql as $$
declare eid uuid; provider_id text; direction text; phone text;
begin
 if coalesce(payload->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return; end if;
 eid := (payload->>'id')::uuid;
 provider_id := nullif(trim(payload#>>'{telephony_data,provider_call_id}'),'');
 if provider_id is null or length(provider_id)>1000 or payload->>'status' in ('balance-low','scheduled','queued','rescheduled','canceled','stopped') then return; end if;
 direction:=payload#>>'{telephony_data,call_type}';
 phone:=bolna_ai_contact_phone(payload);
 insert into bolna_ai_attempts as current (
  execution_id,provider_call_id,provider,agent_id,batch_id,phone_last10,direction,status,initiated_at,execution_created_at,provider_updated_at,
  duration_seconds,conversation_seconds,confirmed_conversation,first_observed_at,last_observed_at,raw)
 values(eid,provider_id,coalesce(payload#>>'{telephony_data,provider}',payload->>'provider'),payload->>'agent_id',payload->>'batch_id',nullif(phone,''),direction,payload->>'status',
  bolna_provider_time(payload->>'initiated_at'),bolna_provider_time(payload->>'created_at'),bolna_provider_time(payload->>'updated_at'),
  bolna_numeric_measure(payload#>>'{telephony_data,duration}'),bolna_numeric_measure(payload->>'conversation_duration'),
  bolna_confirmed_ai_conversation(payload),
  observed,observed,payload)
 on conflict(execution_id,provider_call_id) do update set
  provider=coalesce(excluded.provider,current.provider),agent_id=coalesce(excluded.agent_id,current.agent_id),batch_id=coalesce(excluded.batch_id,current.batch_id),
  phone_last10=bolna_ai_contact_phone(bolna_merge_ai_payload(current.raw,excluded.raw)),direction=coalesce(excluded.direction,current.direction),status=coalesce(excluded.status,current.status),
  initiated_at=coalesce(excluded.initiated_at,current.initiated_at),execution_created_at=coalesce(excluded.execution_created_at,current.execution_created_at),provider_updated_at=coalesce(excluded.provider_updated_at,current.provider_updated_at),
  duration_seconds=coalesce(excluded.duration_seconds,current.duration_seconds),conversation_seconds=coalesce(excluded.conversation_seconds,current.conversation_seconds),confirmed_conversation=bolna_confirmed_ai_conversation(bolna_merge_ai_payload(current.raw,excluded.raw)),
  last_observed_at=excluded.last_observed_at,raw=bolna_merge_ai_payload(current.raw,excluded.raw)
 where bolna_execution_newer(bolna_merge_ai_payload(current.raw,excluded.raw),current.raw);
end $$;

ALTER TABLE bolna_ai_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bolna_ai_attempts FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON bolna_ai_attempts FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON bolna_ai_attempts FROM authenticated; END IF;
END $$;
