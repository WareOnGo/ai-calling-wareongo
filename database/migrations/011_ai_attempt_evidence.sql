-- Immutable provider deliveries and one projection per identifiable provider call.
-- No guessed retry timestamps or retry_count + 1 totals.
create function bolna_zoned_time(value text) returns timestamptz language plpgsql immutable parallel safe as $$
begin
  if value is null or value !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$' then return null; end if;
  return value::timestamptz;
exception when others then return null;
end $$;
create function bolna_retry_index(payload jsonb) returns integer language sql immutable parallel safe as $$
 select case when coalesce(payload->>'retry_count',payload#>>'{batch_run_details,retried}','0') ~ '^\d{1,9}$'
   then coalesce(payload->>'retry_count',payload#>>'{batch_run_details,retried}','0')::integer else 0 end
$$;
create function bolna_status_rank(value text) returns integer language sql immutable parallel safe as $$
 select case when value='completed' then 9 when value in ('failed','busy','no-answer','canceled','stopped','error','balance-low') then 8
  when value='call-disconnected' then 7 when value='in-progress' then 6 when value='ringing' then 5 when value='initiated' then 4 else 1 end
$$;
create function bolna_execution_newer(candidate jsonb, previous jsonb) returns boolean language sql immutable parallel safe as $$
 select previous is null or (candidate is distinct from previous and case
  when bolna_retry_index(candidate) <> bolna_retry_index(previous) then bolna_retry_index(candidate)>bolna_retry_index(previous)
  when nullif(candidate#>>'{telephony_data,provider_call_id}','') is distinct from nullif(previous#>>'{telephony_data,provider_call_id}','')
       and nullif(previous#>>'{telephony_data,provider_call_id}','') is not null then
    coalesce(bolna_zoned_time(candidate->>'initiated_at')>bolna_zoned_time(previous->>'initiated_at'),
             bolna_zoned_time(candidate->>'updated_at')>bolna_zoned_time(previous->>'updated_at'),false)
  when bolna_status_rank(candidate->>'status') <> bolna_status_rank(previous->>'status') then bolna_status_rank(candidate->>'status')>bolna_status_rank(previous->>'status')
  else coalesce(bolna_zoned_time(candidate->>'updated_at')>bolna_zoned_time(previous->>'updated_at'),false) end)
$$;
create table bolna_execution_evidence (
 id bigserial primary key, execution_id uuid not null, payload_hash text not null, raw jsonb not null,
 source text not null check(source in ('webhook','worker','retained','reconcile')), received_at timestamptz not null default now(),
 unique(execution_id,payload_hash)
);
create index bolna_execution_evidence_execution on bolna_execution_evidence(execution_id,received_at);
create table bolna_ai_attempts (
 execution_id uuid not null, provider_call_id text not null, evidence_id bigint not null references bolna_execution_evidence(id),
 provider text, agent_id text, batch_id text, phone_last10 text, direction text, status text,
 initiated_at timestamptz, execution_created_at timestamptz, provider_updated_at timestamptz,
 duration_seconds numeric, conversation_seconds numeric, confirmed_conversation boolean not null default false,
 first_observed_at timestamptz not null, last_observed_at timestamptz not null, raw jsonb not null,
 primary key(execution_id,provider_call_id)
);
create index bolna_ai_attempts_contact on bolna_ai_attempts(phone_last10,initiated_at desc);
create index bolna_ai_attempts_batch on bolna_ai_attempts(batch_id,initiated_at desc);
create function bolna_record_ai_evidence(payload jsonb, origin text default 'webhook', observed timestamptz default now()) returns void language plpgsql as $$
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
  payload->>'status'='completed' and coalesce(bolna_numeric_measure(payload->>'conversation_duration')>0,false)
    and coalesce(payload->>'answered_by_voice_mail','false')<>'true' and coalesce(payload->>'transcript','') ~* '(^|\n)\s*user\s*:',
  observed,observed,payload)
 on conflict(execution_id,provider_call_id) do update set
  evidence_id=excluded.evidence_id,provider=excluded.provider,agent_id=excluded.agent_id,batch_id=excluded.batch_id,
  phone_last10=excluded.phone_last10,direction=excluded.direction,status=excluded.status,
  initiated_at=coalesce(excluded.initiated_at,current.initiated_at),execution_created_at=coalesce(excluded.execution_created_at,current.execution_created_at),provider_updated_at=excluded.provider_updated_at,
  duration_seconds=excluded.duration_seconds,conversation_seconds=excluded.conversation_seconds,confirmed_conversation=excluded.confirmed_conversation,
  last_observed_at=excluded.last_observed_at,raw=excluded.raw
 where bolna_execution_newer(excluded.raw,current.raw);
end $$;
create function bolna_immutable_evidence() returns trigger language plpgsql as $$
begin raise exception 'Provider evidence is append-only'; end $$;
create trigger bolna_evidence_immutable before update or delete on bolna_execution_evidence for each row execute function bolna_immutable_evidence();
alter table bolna_execution_evidence enable row level security;
alter table bolna_ai_attempts enable row level security;
revoke all on bolna_execution_evidence,bolna_ai_attempts from public;
-- Retained payloads are recovered in 015, after sparse-update handling is installed.
create or replace function bolna_availability(call_status text, verdict text) returns text language sql immutable parallel safe as $$
 select case when call_status in ('completed','call-disconnected') then coalesce(nullif(trim(verdict),''),'Unclear') else 'Unclear' end
$$;
