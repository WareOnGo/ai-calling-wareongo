-- Resolve only the specified indexed phones; avoid expanding the whole contact view.
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
DECLARE phones text[]; wanted integer; claimed integer;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (NEW.entity_type,NEW.entity_id,NEW.assignee) IS DISTINCT FROM (OLD.entity_type,OLD.entity_id,OLD.assignee) THEN
   RAISE EXCEPTION 'Assignment targets and owners are immutable; reassign with a new episode' USING ERRCODE='23514';
  END IF;
  -- Note edits and repeated same-state saves do not change contact ownership.
  IF NEW.state=OLD.state THEN RETURN NULL; END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(81620404);
 IF TG_OP<>'DELETE' AND NEW.state='open' THEN
  SELECT array_agg(DISTINCT phone_last10) INTO phones FROM bolna_assignment_contacts
    WHERE entity_type=NEW.entity_type AND entity_id=NEW.entity_id;
  IF EXISTS(SELECT 1 FROM bolna_open_owners_for_phones(phones) o WHERE o.assignee<>NEW.assignee) THEN
   RAISE EXCEPTION 'A linked phone is already assigned to another caller' USING ERRCODE='23505';
  END IF;
  -- An import/provider correction can move a phone association. Stale cache rows
  -- must not prevent assignment after the actual old ownership has disappeared.
  DELETE FROM bolna_assignment_contact_claims p WHERE p.phone_last10=ANY(phones) AND p.assignee<>NEW.assignee
   AND NOT EXISTS(SELECT 1 FROM bolna_open_owners_for_phones(ARRAY[p.phone_last10]) o WHERE o.assignee<>NEW.assignee);
  wanted:=coalesce(cardinality(phones),0);
  INSERT INTO bolna_assignment_contact_claims(phone_last10,assignee)
   SELECT unnest(phones),NEW.assignee ON CONFLICT(phone_last10) DO UPDATE SET assignee=excluded.assignee
    WHERE bolna_assignment_contact_claims.assignee=excluded.assignee;
  GET DIAGNOSTICS claimed=ROW_COUNT;
  IF claimed<>wanted THEN RAISE EXCEPTION 'A linked phone is already assigned to another caller' USING ERRCODE='23505'; END IF;
 END IF;
 IF TG_OP<>'INSERT' AND OLD.state='open' THEN
  DELETE FROM bolna_assignment_contact_claims p WHERE p.phone_last10 IN
   (SELECT phone_last10 FROM bolna_assignment_contacts WHERE entity_type=OLD.entity_type AND entity_id=OLD.entity_id)
   AND NOT EXISTS(SELECT 1 FROM bolna_open_owners_for_phones(ARRAY[p.phone_last10]));
 END IF;
 RETURN NULL;
END $$;
