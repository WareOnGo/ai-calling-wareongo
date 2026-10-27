-- Unreleased handoff schema, consolidated from the reviewed 006–019 sequence.
-- Baseline and migrations 001–005 are unchanged. Recovery and online indexes run separately.

-- Both branches are already unique per (entity_type,entity_id,phone): raw_phones
-- has a unique listing/phone pair and calls have unique IDs. UNION ALL lets the
-- planner push entity/phone predicates into the indexed base relations.
CREATE OR REPLACE VIEW bolna_assignment_contacts AS
  SELECT 'record'::text AS entity_type, rp.master_id AS entity_id, p.phone_last10
    FROM raw_phones rp JOIN raw_phone_numbers p USING (phone_id)
   WHERE p.phone_last10 ~ '^[0-9]{10}$'
  UNION ALL
  SELECT 'call'::text, c.id, c.phone_last10
    FROM bolna_call_logs c WHERE c.phone_last10 ~ '^[0-9]{10}$';

CREATE TABLE bolna_assignment_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_key uuid NOT NULL,
  created_by text NOT NULL REFERENCES bolna_app_users(email),
  created_at timestamptz NOT NULL DEFAULT now(),
  entity_type text NOT NULL CHECK (entity_type IN ('record','call')),
  distribution text NOT NULL CHECK (distribution IN ('single','round_robin')),
  assignees text[] NOT NULL,
  selection jsonb NOT NULL,
  request_hash text NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}',
  UNIQUE(created_by,intent_key)
);
ALTER TABLE bolna_assignments ADD COLUMN batch_id uuid REFERENCES bolna_assignment_batches(id);
CREATE INDEX bolna_assignments_batch_idx ON bolna_assignments(batch_id) WHERE batch_id IS NOT NULL;
CREATE TABLE bolna_assignment_batch_items (
  batch_id uuid NOT NULL REFERENCES bolna_assignment_batches(id),
  entity_id uuid NOT NULL,
  assignment_id bigint REFERENCES bolna_assignments(id),
  disposition text NOT NULL CHECK (disposition IN ('assign','reassign','owned','duplicate','missing_phone')),
  assignee text,
  phones text[] NOT NULL,
  previous_owners jsonb NOT NULL DEFAULT '[]',
  PRIMARY KEY(batch_id,entity_id)
);
CREATE INDEX bolna_assignment_batches_created_idx ON bolna_assignment_batches(created_at DESC,id);
ALTER TABLE bolna_assignment_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolna_assignment_batch_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bolna_assignment_batches, bolna_assignment_batch_items FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON bolna_assignment_batches, bolna_assignment_batch_items FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON bolna_assignment_batches, bolna_assignment_batch_items FROM authenticated;
  END IF;
END $$;

ALTER TABLE bolna_assignments
  ADD COLUMN disposition text CHECK (disposition IN ('connected','no_answer','busy','switched_off','callback','awaiting_confirmation','invalid_number')),
  ADD COLUMN next_due_at timestamptz,
  ADD COLUMN closure_reason text CHECK (closure_reason IN ('resolved','escalated','invalid_number_verified','exhausted'));

ALTER TABLE bolna_assignments ADD COLUMN outcome_attempt_id uuid, ADD COLUMN legacy_onboarding boolean NOT NULL DEFAULT false;

CREATE TABLE bolna_manual_attempts (
  id uuid PRIMARY KEY,
  assignment_id bigint NOT NULL REFERENCES bolna_assignments(id),
  actor text NOT NULL REFERENCES bolna_app_users(email),
  assignee text NOT NULL REFERENCES bolna_app_users(email),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  disposition text NOT NULL CHECK (disposition IN ('connected','no_answer','busy','switched_off','callback','awaiting_confirmation','invalid_number')),
  outcome text CHECK (outcome IN ('Available','Unavailable','Unclear')),
  notes text,
  next_due_at timestamptz,
  duration_seconds integer CHECK (duration_seconds BETWEEN 0 AND 86400),
  duration_source text NOT NULL DEFAULT 'self_reported' CHECK (duration_source='self_reported'),
  corrects_id uuid UNIQUE REFERENCES bolna_manual_attempts(id),
  request_hash text NOT NULL,
  CHECK (disposition NOT IN ('callback','awaiting_confirmation') OR next_due_at IS NOT NULL),
  CHECK (next_due_at IS NULL OR next_due_at >= occurred_at)
);
CREATE INDEX bolna_manual_attempts_assignment_idx ON bolna_manual_attempts(assignment_id,occurred_at DESC,created_at DESC);
CREATE INDEX bolna_manual_attempts_assignee_time_idx ON bolna_manual_attempts(assignee,occurred_at);
CREATE INDEX bolna_assignments_due_idx ON bolna_assignments(assignee,next_due_at) WHERE state='open' AND next_due_at IS NOT NULL;
CREATE VIEW bolna_effective_manual_attempts AS SELECT e.* FROM bolna_manual_attempts e
  WHERE NOT EXISTS(SELECT 1 FROM bolna_manual_attempts correction WHERE correction.corrects_id=e.id);
CREATE FUNCTION bolna_append_only_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'History is append-only; record a correction event' USING ERRCODE='23514'; END $$;
CREATE TRIGGER bolna_manual_attempt_immutable BEFORE UPDATE OR DELETE ON bolna_manual_attempts
  FOR EACH ROW EXECUTE FUNCTION bolna_append_only_event();

CREATE TABLE bolna_assignment_changes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  assignment_id bigint NOT NULL REFERENCES bolna_assignments(id),
  actor text,
  changed_at timestamptz NOT NULL DEFAULT now(),
  before_values jsonb NOT NULL,
  after_values jsonb NOT NULL
);

-- Unknown/unparsed measurements remain NULL rather than becoming zero.
CREATE FUNCTION bolna_numeric_measure(value text) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN regexp_replace(trim(value),'[,[:space:]]','','g') ~ '^[0-9]+(\.[0-9]+)?$'
    THEN regexp_replace(trim(value),'[,[:space:]]','','g')::numeric ELSE NULL END
$$;
CREATE FUNCTION bolna_rent_mentioned(value text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(trim(coalesce(value,''))) NOT IN ('','na','n/a','none','null','unknown','not mentioned','not available','-','tbd')
$$;

CREATE OR REPLACE FUNCTION bolna_valid_warehouse(value text) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT coalesce(length(trim(value)) BETWEEN 1 AND 100 AND trim(value) ~ '^[1-9][0-9]*$',false)
$$;

CREATE FUNCTION bolna_recorded_warehouse(value text) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT coalesce(length(trim(value)) BETWEEN 1 AND 100 AND lower(trim(value)) NOT IN ('na','n/a','none','unknown','tbd','-'),false)
$$;

CREATE FUNCTION bolna_retry_dispositions() RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT ARRAY['no_answer','busy','switched_off','callback','awaiting_confirmation']::text[]
$$;

-- Every Done edit retains completion quality. Only the first transition requires a logged call.
CREATE FUNCTION bolna_assignment_issue(p_state text,p_outcome text,p_wh text,p_remarks text,p_disposition text,p_closure text)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE
  WHEN p_state <> 'done' THEN NULL
  WHEN p_outcome='Available' AND NOT bolna_valid_warehouse(p_wh) THEN
   jsonb_build_object('code','WAREHOUSE_ID_REQUIRED','field','wh_id','message','Available work requires a positive integer Warehouse ID before it can be done.')
  WHEN p_outcome='Unclear' AND (coalesce(p_closure,'') NOT IN ('resolved','escalated','exhausted','invalid_number_verified') OR length(trim(coalesce(p_remarks,'')))<10 OR trim(coalesce(p_remarks,'')) !~ '\S+\s+\S+' OR trim(coalesce(p_remarks,'')) ~* '^(rnr|busy|no answer|call ?back( later)?|will (check|call).*|awaiting confirmation)[.! ]*$') THEN
   jsonb_build_object('code','CLOSURE_EXPLANATION_REQUIRED','field','remarks','message','Unclear work needs a closure reason and a substantive explanation; a callback promise is pending work.')
  WHEN p_closure='exhausted' AND p_disposition=ANY(bolna_retry_dispositions()) THEN
   CASE WHEN length(trim(coalesce(p_remarks,'')))>=10 AND trim(coalesce(p_remarks,'')) ~ '\S+\s+\S+' THEN NULL
   ELSE jsonb_build_object('code','EXHAUSTION_REASON_REQUIRED','field','remarks','message','Explain why these recorded follow-ups are exhausted (at least 10 characters).') END
  WHEN p_closure='exhausted' THEN
   jsonb_build_object('code','EXHAUSTION_ATTEMPT_REQUIRED','field','manual_attempt','message','Exhausted closure requires a recorded unsuccessful follow-up attempt.')
  WHEN p_disposition=ANY(bolna_retry_dispositions()) THEN
   jsonb_build_object('code','FOLLOW_UP_REQUIRED','field','manual_attempt','message','Follow-up is still required. Keep this task open and record the next call.')
  WHEN p_disposition='invalid_number' AND (p_closure IS DISTINCT FROM 'invalid_number_verified' OR length(trim(coalesce(p_remarks,'')))<10 OR trim(coalesce(p_remarks,'')) !~ '\S+\s+\S+') THEN
   jsonb_build_object('code','INVALID_NUMBER_EVIDENCE','field','remarks','message','Verify the invalid number and explain the evidence before completing this task.')
  WHEN p_disposition='invalid_number' AND p_closure='invalid_number_verified' THEN NULL
  WHEN p_outcome IS NULL THEN
   jsonb_build_object('code','RESULT_REQUIRED','field','outcome','message','Choose a manual result before marking this task done.')
  ELSE NULL END
$$;
CREATE FUNCTION bolna_assignment_quality(p_state text,p_outcome text,p_wh text,p_remarks text,p_disposition text,p_closure text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT bolna_assignment_issue(p_state,p_outcome,p_wh,p_remarks,p_disposition,p_closure)->>'message'
$$;
CREATE FUNCTION bolna_completion_issue(p_id bigint,p_state text,p_outcome text,p_wh text,p_remarks text,p_closure text,p_require_call boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE last_disposition text;
BEGIN
 IF p_state <> 'done' THEN RETURN NULL; END IF;
 SELECT disposition INTO last_disposition FROM bolna_effective_manual_attempts WHERE assignment_id=p_id ORDER BY occurred_at DESC,created_at DESC,id DESC LIMIT 1;
 IF NOT FOUND AND p_require_call THEN
  RETURN jsonb_build_object('code','CALL_REQUIRED','field','manual_attempt','message','Log an actual manual call before marking this task done.');
 END IF;
 RETURN bolna_assignment_issue(p_state,p_outcome,p_wh,p_remarks,last_disposition,p_closure);
END $$;
CREATE FUNCTION bolna_enforce_assignment_quality() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE issue jsonb; requires_call boolean;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.state,NEW.outcome,NEW.wh_id,NEW.remarks,NEW.disposition,NEW.closure_reason)
  IS NOT DISTINCT FROM (OLD.state,OLD.outcome,OLD.wh_id,OLD.remarks,OLD.disposition,OLD.closure_reason) THEN RETURN NEW; END IF;
 IF nullif(trim(NEW.wh_id),'') IS NOT NULL AND (TG_OP='INSERT' OR trim(NEW.wh_id) IS DISTINCT FROM trim(OLD.wh_id))
  AND NOT bolna_valid_warehouse(NEW.wh_id) THEN
  issue:=jsonb_build_object('code','INVALID_WAREHOUSE_ID','field','wh_id','message','Warehouse ID must be a positive integer.');
 ELSIF NEW.state='done' THEN
  requires_call:=TG_OP='INSERT' OR OLD.state IS DISTINCT FROM 'done';
  issue:=bolna_completion_issue(NEW.id,NEW.state,NEW.outcome,NEW.wh_id,NEW.remarks,NEW.closure_reason,requires_call);
 END IF;
 IF issue IS NOT NULL THEN RAISE EXCEPTION '%',issue->>'message' USING ERRCODE='23514',DETAIL=issue::text; END IF;
 RETURN NEW;
END $$;

-- Preserve legacy onboarding only on its exact existing assignment, without inventing history.
WITH legacy AS (
 SELECT DISTINCT ON(c.id) a.id,c.wh_id,c.added_to_db
 FROM bolna_call_logs c JOIN bolna_assignments a ON a.entity_type='call' AND a.entity_id=c.id AND a.state<>'dropped'
 WHERE (c.added_to_db OR nullif(trim(c.wh_id),'') IS NOT NULL)
 ORDER BY c.id,(a.state='open') DESC,a.assigned_at DESC,a.id DESC
)
UPDATE bolna_assignments a SET wh_id=coalesce(nullif(trim(a.wh_id),''),l.wh_id),
 added_to_db=a.added_to_db OR l.added_to_db,legacy_onboarding=true,revision=revision+1
FROM legacy l WHERE a.id=l.id
 AND (nullif(trim(a.wh_id),'') IS NULL OR trim(a.wh_id)=trim(l.wh_id))
 AND NOT EXISTS(SELECT 1 FROM bolna_assignment_changes h WHERE h.assignment_id=a.id
   AND h.before_values<>'{}'::jsonb AND (h.before_values->>'wh_id',h.before_values->>'added_to_db')
   IS DISTINCT FROM (h.after_values->>'wh_id',h.after_values->>'added_to_db'));

CREATE OR REPLACE FUNCTION bolna_audit_assignment_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO bolna_assignment_changes(assignment_id,actor,before_values,after_values)
 VALUES(NEW.id,nullif(current_setting('bolna.actor',true),''),CASE WHEN TG_OP='INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END,to_jsonb(NEW));
 RETURN NULL;
END $$;

CREATE TRIGGER bolna_assignment_audit AFTER UPDATE ON bolna_assignments FOR EACH ROW EXECUTE FUNCTION bolna_audit_assignment_change();

CREATE TRIGGER bolna_assignment_initial_audit AFTER INSERT ON bolna_assignments FOR EACH ROW EXECUTE FUNCTION bolna_audit_assignment_change();
CREATE INDEX bolna_assignment_changes_history ON bolna_assignment_changes(assignment_id,id);

CREATE TRIGGER bolna_assignment_change_immutable BEFORE UPDATE OR DELETE ON bolna_assignment_changes FOR EACH ROW EXECUTE FUNCTION bolna_append_only_event();

CREATE TRIGGER bolna_assignment_quality_guard BEFORE INSERT OR UPDATE ON bolna_assignments FOR EACH ROW EXECUTE FUNCTION bolna_enforce_assignment_quality();

CREATE VIEW bolna_assignment_quality_review AS SELECT a.*,
  bolna_assignment_quality(state,outcome,wh_id,remarks,disposition,closure_reason) AS quality_issue,
  coalesce(remarks,'') ~* '\m(rnr|busy|switched off|call back|callback|will check)\M' AS possible_unresolved_followup
  FROM bolna_assignments a WHERE state='done' AND
    (bolna_assignment_quality(state,outcome,wh_id,remarks,disposition,closure_reason) IS NOT NULL
      OR coalesce(remarks,'') ~* '\m(rnr|busy|switched off|call back|callback|will check)\M');

ALTER TABLE bolna_manual_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolna_assignment_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bolna_manual_attempts,bolna_effective_manual_attempts,bolna_assignment_changes,bolna_assignment_quality_review FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON bolna_manual_attempts,bolna_effective_manual_attempts,bolna_assignment_changes,bolna_assignment_quality_review FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON bolna_manual_attempts,bolna_effective_manual_attempts,bolna_assignment_changes,bolna_assignment_quality_review FROM authenticated;
  END IF;
END $$;

CREATE FUNCTION bolna_open_owners_for_phones(phones text[]) RETURNS TABLE(assignee text)
LANGUAGE sql STABLE AS $$
 SELECT a.assignee FROM raw_phone_numbers p JOIN raw_phones rp USING(phone_id)
 JOIN bolna_assignments a ON a.entity_type='record' AND a.entity_id=rp.master_id AND a.state='open'
 WHERE p.phone_last10=ANY(phones)
 UNION
 SELECT a.assignee FROM bolna_call_logs c JOIN bolna_assignments a
 ON a.entity_type='call' AND a.entity_id=c.id AND a.state='open' WHERE c.phone_last10=ANY(phones)
$$;

CREATE OR REPLACE FUNCTION bolna_sync_assignment_contacts() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE phones text[];
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (NEW.entity_type,NEW.entity_id,NEW.assignee) IS DISTINCT FROM (OLD.entity_type,OLD.entity_id,OLD.assignee) THEN
   RAISE EXCEPTION 'Assignment targets and owners are immutable; reassign with a new episode' USING ERRCODE='23514';
  END IF;
  IF NEW.state=OLD.state THEN RETURN NULL; END IF;
 END IF;
 IF TG_OP<>'DELETE' AND NEW.state='open' THEN
  PERFORM pg_advisory_xact_lock(81620404);
  SELECT array_agg(DISTINCT phone_last10) INTO phones FROM bolna_assignment_contacts
   WHERE entity_type=NEW.entity_type AND entity_id=NEW.entity_id;
  IF EXISTS(SELECT 1 FROM bolna_open_owners_for_phones(phones) o WHERE o.assignee<>NEW.assignee) THEN
   RAISE EXCEPTION 'A linked phone is already assigned to another caller' USING ERRCODE='23505';
  END IF;
 END IF;
 RETURN NULL;
END $$;

CREATE TRIGGER bolna_assignment_contacts_sync AFTER INSERT OR DELETE OR UPDATE OF state, entity_type, entity_id, assignee ON bolna_assignments FOR EACH ROW EXECUTE FUNCTION bolna_sync_assignment_contacts();

-- Provider timestamps without an offset are UTC by the application's time policy.
-- Explicit offsets retain their instant; timestamptz never depends on session TimeZone.
CREATE FUNCTION bolna_provider_time(value text) RETURNS timestamptz LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
BEGIN
 IF value ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)$' THEN RETURN value::timestamptz; END IF;
 IF value ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?$' THEN RETURN value::timestamp AT TIME ZONE 'UTC'; END IF;
 RETURN NULL;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN NULL;
END $$;
CREATE FUNCTION bolna_provider_time_newer(candidate text,previous text) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT bolna_provider_time(candidate)>bolna_provider_time(previous)
$$;

create function bolna_retry_index(payload jsonb) returns integer language sql immutable parallel safe as $$
 select case when coalesce(payload->>'retry_count',payload#>>'{batch_run_details,retried}','0') ~ '^\d{1,9}$'
   then coalesce(payload->>'retry_count',payload#>>'{batch_run_details,retried}','0')::integer else 0 end
$$;

create function bolna_status_rank(value text) returns integer language sql immutable parallel safe as $$
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

create table bolna_ai_attempts (
 execution_id uuid not null, provider_call_id text not null,
 provider text, agent_id text, batch_id text, phone_last10 text, direction text, status text,
 initiated_at timestamptz, execution_created_at timestamptz, provider_updated_at timestamptz,
 duration_seconds numeric, conversation_seconds numeric, confirmed_conversation boolean not null default false,
 first_observed_at timestamptz not null, last_observed_at timestamptz not null, raw jsonb not null,
 primary key(execution_id,provider_call_id)
);
create index bolna_ai_attempts_contact on bolna_ai_attempts(phone_last10,initiated_at desc);
create index bolna_ai_attempts_batch on bolna_ai_attempts(batch_id,initiated_at desc);

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
CREATE FUNCTION bolna_ai_contact_phone(payload jsonb) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
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

create or replace function bolna_availability(call_status text, verdict text) returns text language sql immutable parallel safe as $$
 select case when call_status in ('completed','call-disconnected') then coalesce(nullif(trim(verdict),''),'Unclear') else 'Unclear' end
$$;

CREATE OR REPLACE FUNCTION bolna_search_text(VARIADIC parts text[]) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT array_to_string(parts,E'\n') $$;

-- Cursor and lease are committed with each page; a process exit can resume safely.
ALTER TABLE call_batches ADD COLUMN reconciliation_hash text,
 ADD COLUMN reconciliation_offset integer NOT NULL DEFAULT 0 CHECK(reconciliation_offset>=0),
 ADD COLUMN reconciliation_token uuid, ADD COLUMN reconciliation_lease_until timestamptz;
ALTER TABLE bolna_ai_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bolna_assignment_contacts,bolna_ai_attempts FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON bolna_assignment_contacts,bolna_ai_attempts FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON bolna_assignment_contacts,bolna_ai_attempts FROM authenticated; END IF;
END $$;
