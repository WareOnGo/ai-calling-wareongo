-- Review follow-up: preserve legacy edits, simplify retained provider evidence,
-- and keep ownership checks on live contact mappings. No production backfill guesses.
ALTER TABLE bolna_assignments ADD COLUMN outcome_attempt_id uuid,
 ADD COLUMN legacy_onboarding boolean NOT NULL DEFAULT false;
ALTER TABLE bolna_assignments DROP CONSTRAINT bolna_assignments_closure_reason_check;
ALTER TABLE bolna_assignments ADD CONSTRAINT bolna_assignments_closure_reason_check
 CHECK(closure_reason IN ('resolved','escalated','invalid_number_verified','exhausted'));

-- New writes require integer IDs; reporting preserves already-recorded references.
CREATE FUNCTION bolna_recorded_warehouse(value text) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT coalesce(length(trim(value)) BETWEEN 1 AND 100 AND lower(trim(value)) NOT IN ('na','n/a','none','unknown','tbd','-'),false)
$$;
CREATE FUNCTION bolna_retry_dispositions() RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT ARRAY['no_answer','busy','switched_off','callback','awaiting_confirmation']::text[]
$$;

-- Move legacy call-row verification only into its exact, latest assignment.
-- Never copy between separate listings sharing a phone, overwrite a reference,
-- or manufacture a verification timestamp from the migration time.
ALTER TABLE bolna_assignments DISABLE TRIGGER bolna_assignment_quality_guard;
ALTER TABLE bolna_assignments DISABLE TRIGGER bolna_assignment_audit;
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
ALTER TABLE bolna_assignments ENABLE TRIGGER bolna_assignment_audit;
ALTER TABLE bolna_assignments ENABLE TRIGGER bolna_assignment_quality_guard;

CREATE OR REPLACE FUNCTION bolna_enforce_assignment_quality() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE issue jsonb;
BEGIN
 IF nullif(trim(NEW.wh_id),'') IS NOT NULL AND (TG_OP='INSERT' OR trim(NEW.wh_id) IS DISTINCT FROM trim(OLD.wh_id))
  AND NOT bolna_valid_warehouse(NEW.wh_id) THEN
  issue:=jsonb_build_object('code','INVALID_WAREHOUSE_ID','field','wh_id','message','Warehouse ID must be a positive integer.');
 ELSIF NEW.state='done' AND (TG_OP='INSERT' OR OLD.state IS DISTINCT FROM 'done') THEN
  issue:=bolna_completion_issue(NEW.id,NEW.state,NEW.outcome,NEW.wh_id,NEW.remarks,NEW.closure_reason);
 END IF;
 IF issue IS NOT NULL THEN RAISE EXCEPTION '%',issue->>'message' USING ERRCODE='23514',DETAIL=issue::text; END IF;
 RETURN NEW;
END $$;

-- Contact claims duplicated the same live-owner test. Keep one ownership guard.
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
DROP TABLE bolna_assignment_contact_claims;
DROP TABLE bolna_provider_cache;

-- Keep one merged record per actual provider dial. Original webhook payloads
-- remain in the existing webhook inbox; a second immutable delivery ledger adds
-- no information used by the application and prevents normal retention.
ALTER TABLE bolna_ai_attempts DROP COLUMN evidence_id;
DROP TABLE bolna_execution_evidence;
DROP FUNCTION bolna_immutable_evidence();

CREATE FUNCTION bolna_local_dial_time(value text) RETURNS timestamp LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
BEGIN
 IF value IS NULL OR value !~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?$' THEN RETURN NULL; END IF;
 RETURN value::timestamp;
EXCEPTION WHEN others THEN RETURN NULL;
END $$;
CREATE FUNCTION bolna_provider_time_newer(candidate text,previous text) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE WHEN bolna_zoned_time(candidate) IS NOT NULL AND bolna_zoned_time(previous) IS NOT NULL
  THEN bolna_zoned_time(candidate)>bolna_zoned_time(previous)
  WHEN bolna_local_dial_time(candidate) IS NOT NULL AND bolna_local_dial_time(previous) IS NOT NULL
  THEN bolna_local_dial_time(candidate)>bolna_local_dial_time(previous) END
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

CREATE OR REPLACE FUNCTION bolna_assignment_issue(p_state text,p_outcome text,p_wh text,p_remarks text,p_disposition text,p_closure text)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE
  WHEN p_state <> 'done' THEN NULL
  WHEN p_closure='exhausted' AND p_disposition=ANY(bolna_retry_dispositions()) THEN
   CASE WHEN length(trim(coalesce(p_remarks,'')))>=10 AND trim(coalesce(p_remarks,'')) ~ '\S+\s+\S+' THEN NULL
   ELSE jsonb_build_object('code','EXHAUSTION_REASON_REQUIRED','field','remarks','message','Explain why these recorded follow-ups are exhausted (at least 10 characters).') END
  WHEN p_closure='exhausted' THEN
   jsonb_build_object('code','EXHAUSTION_ATTEMPT_REQUIRED','field','manual_attempt','message','Exhausted closure requires a recorded unsuccessful follow-up attempt.')
  WHEN p_disposition=ANY(bolna_retry_dispositions()) THEN
   jsonb_build_object('code','FOLLOW_UP_REQUIRED','field','manual_attempt','message','Follow-up is still required. Keep this task open and record the next call.')
  WHEN p_outcome='Available' AND NOT bolna_valid_warehouse(p_wh) THEN
   jsonb_build_object('code','WAREHOUSE_ID_REQUIRED','field','wh_id','message','Available work requires a positive integer Warehouse ID before it can be done.')
  WHEN p_disposition='invalid_number' AND (p_closure IS DISTINCT FROM 'invalid_number_verified' OR length(trim(coalesce(p_remarks,'')))<10 OR trim(coalesce(p_remarks,'')) !~ '\S+\s+\S+') THEN
   jsonb_build_object('code','INVALID_NUMBER_EVIDENCE','field','remarks','message','Verify the invalid number and explain the evidence before completing this task.')
  WHEN p_disposition='invalid_number' AND p_closure='invalid_number_verified' THEN NULL
  WHEN p_outcome IS NULL THEN
   jsonb_build_object('code','RESULT_REQUIRED','field','outcome','message','Choose a manual result before marking this task done.')
  WHEN p_outcome='Unclear' AND (coalesce(p_closure,'') NOT IN ('resolved','escalated') OR length(trim(coalesce(p_remarks,'')))<10 OR trim(coalesce(p_remarks,'')) !~ '\S+\s+\S+' OR trim(coalesce(p_remarks,'')) ~* '^(rnr|busy|no answer|call ?back( later)?|will (check|call).*|awaiting confirmation)[.! ]*$') THEN
   jsonb_build_object('code','CLOSURE_EXPLANATION_REQUIRED','field','remarks','message','Unclear work needs a closure reason and a substantive explanation; a callback promise is pending work.')
  ELSE NULL END
$$;

create or replace function bolna_record_ai_evidence(payload jsonb, origin text default 'webhook', observed timestamptz default now()) returns void language plpgsql as $$
declare eid uuid; provider_id text; direction text; phone text;
begin
 if coalesce(payload->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return; end if;
 eid := (payload->>'id')::uuid;
 provider_id := nullif(trim(payload#>>'{telephony_data,provider_call_id}'),'');
 if provider_id is null or length(provider_id)>1000 or payload->>'status' in ('balance-low','scheduled','queued','rescheduled','canceled','stopped') then return; end if;
 direction:=payload#>>'{telephony_data,call_type}';
 phone:=right(regexp_replace(coalesce(case when direction='inbound' then payload#>>'{telephony_data,from_number}' else payload#>>'{telephony_data,to_number}' end,payload->>'user_number',''),'\D','','g'),10);
 insert into bolna_ai_attempts as current (
  execution_id,provider_call_id,provider,agent_id,batch_id,phone_last10,direction,status,initiated_at,execution_created_at,provider_updated_at,
  duration_seconds,conversation_seconds,confirmed_conversation,first_observed_at,last_observed_at,raw)
 values(eid,provider_id,coalesce(payload#>>'{telephony_data,provider}',payload->>'provider'),payload->>'agent_id',payload->>'batch_id',nullif(phone,''),direction,payload->>'status',
  bolna_zoned_time(payload->>'initiated_at'),bolna_zoned_time(payload->>'created_at'),bolna_zoned_time(payload->>'updated_at'),
  bolna_numeric_measure(payload#>>'{telephony_data,duration}'),bolna_numeric_measure(payload->>'conversation_duration'),
  bolna_confirmed_ai_conversation(payload),
  observed,observed,payload)
 on conflict(execution_id,provider_call_id) do update set
  provider=coalesce(excluded.provider,current.provider),agent_id=coalesce(excluded.agent_id,current.agent_id),batch_id=coalesce(excluded.batch_id,current.batch_id),
  phone_last10=coalesce(excluded.phone_last10,current.phone_last10),direction=coalesce(excluded.direction,current.direction),status=coalesce(excluded.status,current.status),
  initiated_at=coalesce(excluded.initiated_at,current.initiated_at),execution_created_at=coalesce(excluded.execution_created_at,current.execution_created_at),provider_updated_at=coalesce(excluded.provider_updated_at,current.provider_updated_at),
  duration_seconds=coalesce(excluded.duration_seconds,current.duration_seconds),conversation_seconds=coalesce(excluded.conversation_seconds,current.conversation_seconds),confirmed_conversation=bolna_confirmed_ai_conversation(bolna_merge_ai_payload(current.raw,excluded.raw)),
  last_observed_at=excluded.last_observed_at,raw=bolna_merge_ai_payload(current.raw,excluded.raw)
 where bolna_execution_newer(bolna_merge_ai_payload(current.raw,excluded.raw),current.raw);
end $$;

