-- Calling ownership is shared across raw listings and AI follow-up records.
-- Keep all listings/history; only new allocation is deduplicated by contact.
CREATE VIEW bolna_assignment_contacts AS
  SELECT DISTINCT 'record'::text AS entity_type, rp.master_id AS entity_id, p.phone_last10
    FROM raw_phones rp JOIN raw_phone_numbers p USING (phone_id)
   WHERE p.phone_last10 ~ '^[0-9]{10}$'
  UNION
  SELECT 'call'::text, c.id,
         right(regexp_replace(coalesce(CASE WHEN c.call_type = 'inbound' THEN c.from_number ELSE c.to_number END, ''), '\D', '', 'g'), 10)
    FROM bolna_call_logs c
   WHERE right(regexp_replace(coalesce(CASE WHEN c.call_type = 'inbound' THEN c.from_number ELSE c.to_number END, ''), '\D', '', 'g'), 10) ~ '^[0-9]{10}$';

CREATE TABLE bolna_assignment_contact_claims (
  phone_last10 text PRIMARY KEY CHECK (phone_last10 ~ '^[0-9]{10}$'),
  assignee text NOT NULL REFERENCES bolna_app_users(email),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Existing overlaps are preserved for review. New writes consult all open work.
INSERT INTO bolna_assignment_contact_claims(phone_last10, assignee)
SELECT DISTINCT ON (v.phone_last10) v.phone_last10, a.assignee
  FROM bolna_assignments a JOIN bolna_assignment_contacts v USING (entity_type, entity_id)
 WHERE a.state = 'open' ORDER BY v.phone_last10, a.assigned_at, a.id;

CREATE FUNCTION bolna_sync_assignment_contacts() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE wanted integer; claimed integer;
BEGIN
  PERFORM pg_advisory_xact_lock(81620404);
  IF TG_OP = 'UPDATE' AND (NEW.entity_type, NEW.entity_id, NEW.assignee) IS DISTINCT FROM (OLD.entity_type, OLD.entity_id, OLD.assignee) THEN
    RAISE EXCEPTION 'Assignment targets and owners are immutable; reassign with a new episode' USING ERRCODE = '23514';
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.state = 'open' THEN
    SELECT count(*) INTO wanted FROM bolna_assignment_contacts WHERE entity_type = NEW.entity_type AND entity_id = NEW.entity_id;
    INSERT INTO bolna_assignment_contact_claims(phone_last10, assignee)
      SELECT phone_last10, NEW.assignee FROM bolna_assignment_contacts WHERE entity_type = NEW.entity_type AND entity_id = NEW.entity_id
      ON CONFLICT (phone_last10) DO UPDATE SET assignee = excluded.assignee
        WHERE bolna_assignment_contact_claims.assignee = excluded.assignee;
    GET DIAGNOSTICS claimed = ROW_COUNT;
    IF claimed <> wanted THEN
      RAISE EXCEPTION 'A linked phone is already assigned to another caller' USING ERRCODE = '23505';
    END IF;
  END IF;
  IF TG_OP <> 'INSERT' AND OLD.state = 'open' THEN
    DELETE FROM bolna_assignment_contact_claims p
      WHERE p.phone_last10 IN (SELECT phone_last10 FROM bolna_assignment_contacts WHERE entity_type = OLD.entity_type AND entity_id = OLD.entity_id)
        AND NOT EXISTS (SELECT 1 FROM bolna_assignments a JOIN bolna_assignment_contacts v USING (entity_type, entity_id)
                         WHERE a.state = 'open' AND v.phone_last10 = p.phone_last10);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER bolna_assignment_contacts_sync AFTER INSERT OR DELETE OR UPDATE OF state, entity_type, entity_id, assignee
  ON bolna_assignments FOR EACH ROW EXECUTE FUNCTION bolna_sync_assignment_contacts();

ALTER TABLE bolna_assignment_contact_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bolna_assignment_contacts, bolna_assignment_contact_claims FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON bolna_assignment_contacts, bolna_assignment_contact_claims FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON bolna_assignment_contacts, bolna_assignment_contact_claims FROM authenticated;
  END IF;
END $$;
