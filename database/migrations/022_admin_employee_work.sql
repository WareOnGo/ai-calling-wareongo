-- Admins editing an employee's My Work use the same narrow classic contract.
-- Keep the real admin as bolna.actor for audit history, and verify their active
-- database role. The API separately scopes each read/write to the chosen employee.
-- Preserve the board contract, other validation and every trigger enable state.
CREATE OR REPLACE FUNCTION bolna_enforce_assignment_quality() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE issue jsonb; requires_call boolean; workflow text; actor text; editable text[];
BEGIN
 workflow:=current_setting('bolna.employee_workflow',true);
 actor:=current_setting('bolna.actor',true);
 editable:=CASE workflow
  WHEN 'classic' THEN ARRAY['outcome','remarks','added_to_db','wh_id','state','completed_at','revision']
  WHEN 'board' THEN ARRAY['outcome','remarks','added_to_db','wh_id','state','completed_at','revision',
    'stage','disposition','closure_reason','next_due_at','last_attempt_at','outcome_attempt_id']
 END;
 IF TG_OP='UPDATE' AND editable IS NOT NULL
  AND (actor=OLD.assignee
    OR EXISTS(SELECT 1 FROM bolna_app_users u WHERE u.email=actor AND u.role='admin' AND u.active))
  AND NEW.state IN ('open','done') AND OLD.state <> 'dropped'
  AND NEW.revision=OLD.revision+1
  AND (to_jsonb(NEW)-editable) = (to_jsonb(OLD)-editable) THEN
  RETURN NEW;
 END IF;
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
