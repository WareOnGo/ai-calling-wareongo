ALTER TABLE bolna_assignments
  ADD COLUMN disposition text CHECK (disposition IN ('connected','no_answer','busy','switched_off','callback','awaiting_confirmation','invalid_number')),
  ADD COLUMN next_due_at timestamptz,
  ADD COLUMN closure_reason text CHECK (closure_reason IN ('resolved','escalated','invalid_number_verified'));

-- One canonical completion policy, used by the API and direct database writes.
CREATE FUNCTION bolna_assignment_quality(p_state text,p_outcome text,p_wh text,p_remarks text,p_disposition text,p_closure text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_state <> 'done' THEN NULL
    WHEN p_disposition IN ('no_answer','busy','switched_off','callback','awaiting_confirmation')
      THEN 'Follow-up is still required. Keep this task open and record the next call.'
    WHEN p_outcome = 'Available' AND (nullif(trim(p_wh),'') IS NULL OR length(trim(p_wh)) > 100
      OR lower(trim(p_wh)) IN ('na','n/a','none','unknown','tbd','-'))
      THEN 'Available work requires a valid Warehouse ID before it can be done.'
    WHEN p_disposition = 'invalid_number' AND (p_closure IS DISTINCT FROM 'invalid_number_verified'
      OR length(trim(coalesce(p_remarks,''))) < 10 OR trim(coalesce(p_remarks,'')) !~ '\S+\s+\S+')
      THEN 'Verify the invalid number and explain the evidence before completing this task.'
    WHEN p_disposition = 'invalid_number' AND p_closure = 'invalid_number_verified' THEN NULL
    WHEN p_outcome IS NULL THEN 'Choose a manual result before marking this task done.'
    WHEN p_outcome = 'Unclear' AND (coalesce(p_closure,'') NOT IN ('resolved','escalated')
      OR length(trim(coalesce(p_remarks,''))) < 10 OR trim(coalesce(p_remarks,'')) !~ '\S+\s+\S+')
      THEN 'Unclear work needs a closure reason and an explanation of at least 10 characters.'
    ELSE NULL
  END
$$;
CREATE FUNCTION bolna_enforce_assignment_quality() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE issue text;
BEGIN
  -- Legacy invalid completions remain reviewable. An unrelated note/batch change
  -- must not silently rewrite history or prevent the operator from reopening it.
  IF TG_OP = 'UPDATE' AND (NEW.state,NEW.outcome,NEW.wh_id,NEW.remarks,NEW.disposition,NEW.closure_reason)
    IS NOT DISTINCT FROM (OLD.state,OLD.outcome,OLD.wh_id,OLD.remarks,OLD.disposition,OLD.closure_reason) THEN RETURN NEW; END IF;
  issue := bolna_assignment_quality(NEW.state,NEW.outcome,NEW.wh_id,NEW.remarks,NEW.disposition,NEW.closure_reason);
  IF issue IS NOT NULL THEN RAISE EXCEPTION '%',issue USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bolna_assignment_quality_guard BEFORE INSERT OR UPDATE ON bolna_assignments
  FOR EACH ROW EXECUTE FUNCTION bolna_enforce_assignment_quality();

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
CREATE FUNCTION bolna_audit_assignment_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO bolna_assignment_changes(assignment_id,actor,before_values,after_values)
    VALUES(NEW.id,nullif(current_setting('bolna.actor',true),''),to_jsonb(OLD),to_jsonb(NEW));
  RETURN NULL;
END $$;
CREATE TRIGGER bolna_assignment_audit AFTER UPDATE ON bolna_assignments FOR EACH ROW EXECUTE FUNCTION bolna_audit_assignment_change();
CREATE TRIGGER bolna_assignment_change_immutable BEFORE UPDATE OR DELETE ON bolna_assignment_changes FOR EACH ROW EXECUTE FUNCTION bolna_append_only_event();
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
