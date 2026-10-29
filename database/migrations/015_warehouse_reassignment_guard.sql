-- 014 is already applied. Keep this correction forward-only: the shared legacy
-- dashboard disables the general ownership trigger, so this guard must also
-- cover an in-place change of caller. Ordinary edits to an existing task survive.
CREATE OR REPLACE FUNCTION bolna_guard_warehouse_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state <> 'open' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND (OLD.state,OLD.entity_type,OLD.entity_id,OLD.assignee) IS NOT DISTINCT FROM
    (NEW.state,NEW.entity_type,NEW.entity_id,NEW.assignee) THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(81620404);
  IF EXISTS (SELECT 1 FROM bolna_warehouse_matches w WHERE w.entity_type=NEW.entity_type AND w.entity_id=NEW.entity_id) THEN
    RAISE EXCEPTION 'This number has a warehouse already added to DB and cannot be assigned.'
      USING ERRCODE='23514',DETAIL='{"code":"WAREHOUSE_ALREADY_ADDED","field":"phone","message":"This number has a warehouse already added to DB and cannot be assigned."}';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER bolna_warehouse_assignment_guard ON bolna_assignments;
CREATE TRIGGER bolna_warehouse_assignment_guard BEFORE INSERT OR UPDATE OF state,entity_type,entity_id,assignee ON bolna_assignments
  FOR EACH ROW EXECUTE FUNCTION bolna_guard_warehouse_assignment();
