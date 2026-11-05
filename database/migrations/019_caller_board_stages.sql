-- Caller board: every task carries a pipeline stage and the time it last changed.
-- Stage slugs and their board columns:
--   inbound=1, rnr=2A, rejected=2B, awaiting_details=2C, details_collected=3,
--   warehouse_created=4, junk=5.
-- Existing tasks are backfilled from what callers actually record in production:
-- the result dropdown, warehouse ID/Added flag and free-text remarks. Call status,
-- closure reason and logged manual calls are almost never set, so they are not used.
-- The backfill does not change state, outcome, remarks, ownership or warehouse fields.

CREATE FUNCTION bolna_infer_stage(p_outcome text, p_wh_id text, p_added_to_db boolean, p_remarks text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
-- stage-inference:begin
SELECT CASE
  WHEN bolna_valid_warehouse(p_wh_id) OR coalesce(p_added_to_db, false) THEN 'warehouse_created'
  -- Agents, brokers and repeated/duplicate numbers stay in Inbound for review.
  WHEN f.hold THEN 'inbound'
  WHEN f.junk THEN 'junk'
  WHEN p_outcome = 'Unavailable' THEN 'rejected'
  WHEN p_outcome = 'Available' THEN CASE WHEN f.details THEN 'details_collected' ELSE 'awaiting_details' END
  WHEN p_outcome = 'Unclear' THEN CASE WHEN f.callback THEN 'awaiting_details' ELSE 'rnr' END
  -- No result chosen: use what the remarks say, else the task has not been worked.
  WHEN f.rnr THEN 'rnr'
  WHEN f.callback THEN 'awaiting_details'
  WHEN f.rejected THEN 'rejected'
  WHEN f.details THEN 'details_collected'
  ELSE 'inbound'
END
FROM (SELECT
  r ~* '(\magents?\M|broker|repeated (no|num)|duplicate)' AS hold,
  r ~* '(wrong (no|num)|invalid|invaild|does ?n.?t exist|does not exist|not in use|no such (no|num))' AS junk,
  r ~* '(\mrnr|\mring|not (picking|picked|answering|reachable|responding|connecting|lifting)|no (response|answer)|did ?n.?t pick|switch(ed)? ?off|\mbusy|unreachable|out of (coverage|network)|cut the call|call disconnected|calls? barred|no incoming)' AS rnr,
  r ~* '(call ?back|will (call|check|confirm|update|share|send|get back|inform|revert)|follow ?up|\mlater\M|tomorrow|whatsapp|(send|share) details|details awaited|waiting for)' AS callback,
  r ~* '(leased|rented|occupied|\msold\M|not interested|no (space|property|warehouse|vacancy)|not for rent|not available|unavailable|does not have any property|already (given|rented|leased))' AS rejected,
  r ~* '(sq ?ft|square f|per sq|acre|\mdocks?\M|kva|height|[0-9] ?(ft|feet)\M|lakh|\mrs\.? ?[0-9]|rent [0-9]|[0-9] ?k\M)' AS details
  FROM (SELECT coalesce(p_remarks, '') AS r) s) f
-- stage-inference:end
$$;

ALTER TABLE bolna_assignments ADD COLUMN stage text, ADD COLUMN updated_at timestamptz;

-- One audit row per task, attributed to the backfill rather than a person.
-- updated_at is the latest known change: audit history (kept since 11 Oct 2026),
-- the last call attempt, completion or assignment time.
SELECT set_config('bolna.actor', 'stage-backfill', true);
UPDATE bolna_assignments a SET
  stage = bolna_infer_stage(a.outcome, a.wh_id, a.added_to_db, a.remarks),
  updated_at = greatest(a.assigned_at, a.completed_at, a.last_attempt_at,
    (SELECT max(c.changed_at) FROM bolna_assignment_changes c WHERE c.assignment_id = a.id));
SELECT set_config('bolna.actor', '', true);

ALTER TABLE bolna_assignments
  ALTER COLUMN stage SET DEFAULT 'inbound',
  ALTER COLUMN stage SET NOT NULL,
  ADD CONSTRAINT bolna_assignments_stage_check CHECK (stage IN
    ('inbound','rnr','rejected','awaiting_details','details_collected','warehouse_created','junk')),
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET NOT NULL;

CREATE FUNCTION bolna_touch_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF row(NEW.*) IS DISTINCT FROM row(OLD.*) THEN NEW.updated_at := now(); END IF;
  RETURN NEW;
END $$;
-- BEFORE triggers fire in name order. This name sorts after bolna_assignment_quality_guard,
-- so 018's classic-edit comparison still sees updated_at unchanged.
CREATE TRIGGER bolna_assignment_touch BEFORE UPDATE ON bolna_assignments
  FOR EACH ROW EXECUTE FUNCTION bolna_touch_assignment();

-- Board columns: one caller's tasks per stage, most recently changed first.
CREATE INDEX bolna_assignments_board_idx ON bolna_assignments(assignee, stage, updated_at DESC)
  WHERE state <> 'dropped';
