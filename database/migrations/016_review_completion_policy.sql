-- Canonical policy: positive integer warehouse references and explicit call evidence.
CREATE OR REPLACE FUNCTION bolna_valid_warehouse(value text) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT coalesce(length(trim(value)) BETWEEN 1 AND 100 AND trim(value) ~ '^[1-9][0-9]*$',false)
$$;
CREATE FUNCTION bolna_assignment_issue(p_state text,p_outcome text,p_wh text,p_remarks text,p_disposition text,p_closure text)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE
  WHEN p_state <> 'done' THEN NULL
  WHEN p_disposition IN ('no_answer','busy','switched_off','callback','awaiting_confirmation') THEN
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
CREATE OR REPLACE FUNCTION bolna_assignment_quality(p_state text,p_outcome text,p_wh text,p_remarks text,p_disposition text,p_closure text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT bolna_assignment_issue(p_state,p_outcome,p_wh,p_remarks,p_disposition,p_closure)->>'message'
$$;
CREATE FUNCTION bolna_completion_issue(p_id bigint,p_state text,p_outcome text,p_wh text,p_remarks text,p_closure text)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE last_disposition text;
BEGIN
 IF p_state <> 'done' THEN RETURN NULL; END IF;
 SELECT disposition INTO last_disposition FROM bolna_effective_manual_attempts WHERE assignment_id=p_id ORDER BY occurred_at DESC,created_at DESC,id DESC LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('code','CALL_REQUIRED','field','manual_attempt','message','Log an actual manual call before marking this task done.'); END IF;
 RETURN bolna_assignment_issue(p_state,p_outcome,p_wh,p_remarks,last_disposition,p_closure);
END $$;
CREATE OR REPLACE FUNCTION bolna_enforce_assignment_quality() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE issue jsonb;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.state,NEW.outcome,NEW.wh_id,NEW.remarks,NEW.disposition,NEW.closure_reason)
  IS NOT DISTINCT FROM (OLD.state,OLD.outcome,OLD.wh_id,OLD.remarks,OLD.disposition,OLD.closure_reason) THEN RETURN NEW; END IF;
 -- Reopening preserves legacy evidence; changing a reference must use the new format.
 IF nullif(trim(NEW.wh_id),'') IS NOT NULL AND (TG_OP='INSERT' OR NEW.wh_id IS DISTINCT FROM OLD.wh_id) AND NOT bolna_valid_warehouse(NEW.wh_id) THEN
  issue:=jsonb_build_object('code','INVALID_WAREHOUSE_ID','field','wh_id','message','Warehouse ID must be a positive integer.');
 ELSE issue:=bolna_completion_issue(NEW.id,NEW.state,NEW.outcome,NEW.wh_id,NEW.remarks,NEW.closure_reason); END IF;
 IF issue IS NOT NULL THEN RAISE EXCEPTION '%',issue->>'message' USING ERRCODE='23514',DETAIL=issue::text; END IF;
 RETURN NEW;
END $$;
