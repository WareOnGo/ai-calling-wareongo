-- Work recorded outside the caller board keeps the task's board stage in step.
-- The board sets stage itself (bolna.employee_workflow = 'board'). My Work, admin
-- edits and logged manual calls never did, so a task finished there kept its old
-- stage: hidden from the board and missing from the funnel's warehouse credit.
--
-- A non-board update now re-places the task with 019's bolna_infer_stage() when
--   * the result (outcome) changes,
--   * the task gains or loses a warehouse (a valid WHID or the Added flag), or
--   * a task still in Inbound gets notes or is finished or reopened.
-- Notes-only edits and finishing a task already past Inbound keep its stage, so My
-- Work never pulls a card out of a column the caller chose on the board. A writer
-- that sets stage itself, unassigned (dropped) tasks and inserts are left alone.
-- The trigger changes only stage: revision, the other fields and permissions are
-- untouched, and the audit row for the write records the new stage with its actor.
-- Its name sorts after bolna_assignment_quality_guard, so 018's classic-edit
-- comparison still sees the stage unchanged where the guard is enabled, and before
-- bolna_assignment_touch. Existing trigger enable states are unchanged.

CREATE FUNCTION bolna_sync_assignment_stage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('bolna.employee_workflow', true) IS NOT DISTINCT FROM 'board'
    OR NEW.state = 'dropped' OR NEW.stage IS DISTINCT FROM OLD.stage THEN
    RETURN NEW;
  END IF;
  IF NEW.outcome IS DISTINCT FROM OLD.outcome
    OR (bolna_valid_warehouse(NEW.wh_id) OR coalesce(NEW.added_to_db, false))
       <> (bolna_valid_warehouse(OLD.wh_id) OR coalesce(OLD.added_to_db, false))
    OR OLD.stage = 'inbound'
       AND (NEW.remarks IS DISTINCT FROM OLD.remarks OR NEW.state IS DISTINCT FROM OLD.state) THEN
    NEW.stage := bolna_infer_stage(NEW.outcome, NEW.wh_id, NEW.added_to_db, NEW.remarks);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER bolna_assignment_stage_sync
  BEFORE UPDATE OF outcome, wh_id, added_to_db, remarks, state ON bolna_assignments
  FOR EACH ROW EXECUTE FUNCTION bolna_sync_assignment_stage();

-- One-off catch-up for work saved since 019: re-place every live task whose stage
-- only ever came from the 019 backfill (or the Inbound default) and no longer
-- matches its fields. Tasks the board has moved keep their stage. updated_at keeps
-- the time of the real change, so caught-up cards do not jump to the top of their
-- columns; the touch trigger is paused for this statement only. Audit rows name the
-- 'stage-sync' actor.
-- stage-resync:begin
SELECT set_config('bolna.actor', 'stage-sync', true);
ALTER TABLE bolna_assignments DISABLE TRIGGER bolna_assignment_touch;
UPDATE bolna_assignments a SET stage = bolna_infer_stage(a.outcome, a.wh_id, a.added_to_db, a.remarks)
 WHERE a.state <> 'dropped'
   AND a.stage <> bolna_infer_stage(a.outcome, a.wh_id, a.added_to_db, a.remarks)
   AND NOT EXISTS (SELECT 1 FROM bolna_assignment_changes c
     WHERE c.assignment_id = a.id AND c.before_values <> '{}'::jsonb
       AND c.actor IS DISTINCT FROM 'stage-backfill'
       AND (c.before_values ->> 'stage') IS DISTINCT FROM (c.after_values ->> 'stage'));
ALTER TABLE bolna_assignments ENABLE TRIGGER bolna_assignment_touch;
SELECT set_config('bolna.actor', '', true);
-- stage-resync:end
