CREATE FUNCTION bolna_valid_warehouse(value text) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT coalesce(length(trim(value)) BETWEEN 1 AND 100 AND lower(trim(value)) NOT IN ('na','n/a','none','unknown','tbd','-'),false)
$$;
-- Record initial state from this release forward; older missing timestamps stay
-- unknown. Never synthesize an old verification time from an arbitrary note edit.
CREATE OR REPLACE FUNCTION bolna_audit_assignment_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO bolna_assignment_changes(assignment_id,actor,before_values,after_values)
 VALUES(NEW.id,nullif(current_setting('bolna.actor',true),''),CASE WHEN TG_OP='INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END,to_jsonb(NEW));
 RETURN NULL;
END $$;
CREATE TRIGGER bolna_assignment_initial_audit AFTER INSERT ON bolna_assignments FOR EACH ROW EXECUTE FUNCTION bolna_audit_assignment_change();
CREATE INDEX bolna_assignment_changes_history ON bolna_assignment_changes(assignment_id,id);
