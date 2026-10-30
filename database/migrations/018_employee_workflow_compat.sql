-- Retain the established My Work editing contract while deploying the admin overhaul.
-- This transaction-local opt-in is set only after authenticating the task owner.
-- It permits no insert, reassignment, deletion, or changes to manual-call history.
-- Ownership/warehouse guards and audit triggers still run. Existing trigger enable
-- states are deliberately unchanged, including on the shared legacy deployment.
CREATE OR REPLACE FUNCTION bolna_enforce_assignment_quality() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE issue jsonb; requires_call boolean;
BEGIN
 IF TG_OP='UPDATE'
  AND current_setting('bolna.employee_workflow',true)='classic'
  AND current_setting('bolna.actor',true)=OLD.assignee
  AND NEW.state IN ('open','done') AND OLD.state <> 'dropped'
  AND NEW.revision=OLD.revision+1
  AND (to_jsonb(NEW)-ARRAY['outcome','remarks','added_to_db','wh_id','state','completed_at','revision'])
      = (to_jsonb(OLD)-ARRAY['outcome','remarks','added_to_db','wh_id','state','completed_at','revision']) THEN
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
