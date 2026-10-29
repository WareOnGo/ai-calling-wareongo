-- One-time WAG snapshot is loaded separately by backfill-warehouse-contacts.mjs.
-- Keep every warehouse for a number; an owner can have several properties.
CREATE TABLE bolna_warehouse_imports (
  name text PRIMARY KEY,
  snapshot_at timestamptz NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  source_sha256 text NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE bolna_warehouse_contacts (
  phone_last10 text NOT NULL CHECK (phone_last10 ~ '^[0-9]{10}$'),
  warehouse_id integer NOT NULL CHECK (warehouse_id > 0),
  source_fields text[] NOT NULL,
  import_name text NOT NULL REFERENCES bolna_warehouse_imports(name),
  PRIMARY KEY (phone_last10, warehouse_id)
);
CREATE INDEX bolna_warehouse_contacts_warehouse_idx ON bolna_warehouse_contacts(warehouse_id);

-- Include the full raw dataset, unassigned numbers, and retained call phones.
CREATE VIEW bolna_warehouse_matches AS
  SELECT c.entity_type,c.entity_id,c.phone_last10,w.warehouse_id
  FROM bolna_assignment_contacts c JOIN bolna_warehouse_contacts w USING(phone_last10)
  UNION ALL
  SELECT 'call',c.id,p.phone_last10,w.warehouse_id
  FROM bolna_call_logs c JOIN raw_phone_numbers p USING(phone_id)
  JOIN bolna_warehouse_contacts w ON w.phone_last10=p.phone_last10
  WHERE coalesce(c.phone_last10,'') !~ '^[0-9]{10}$';

ALTER TABLE bolna_assignment_batch_items DROP CONSTRAINT bolna_assignment_batch_items_disposition_check;
ALTER TABLE bolna_assignment_batch_items ADD CONSTRAINT bolna_assignment_batch_items_disposition_check
  CHECK (disposition IN ('assign','reassign','owned','duplicate','missing_phone','warehouse_exists'));
ALTER TABLE bolna_dispatch_requests ADD COLUMN warehouse_exists integer NOT NULL DEFAULT 0;

-- Existing episodes remain editable. New allocations and reopening are blocked,
-- even through an older client or a direct write that bypasses the preview.
CREATE FUNCTION bolna_guard_warehouse_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state <> 'open' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND (OLD.state,OLD.entity_type,OLD.entity_id) IS NOT DISTINCT FROM
    (NEW.state,NEW.entity_type,NEW.entity_id) THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(81620404);
  IF EXISTS (SELECT 1 FROM bolna_warehouse_matches w WHERE w.entity_type=NEW.entity_type AND w.entity_id=NEW.entity_id) THEN
    RAISE EXCEPTION 'This number has a warehouse already added to DB and cannot be assigned.'
      USING ERRCODE='23514',DETAIL='{"code":"WAREHOUSE_ALREADY_ADDED","field":"phone","message":"This number has a warehouse already added to DB and cannot be assigned."}';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bolna_warehouse_assignment_guard BEFORE INSERT OR UPDATE OF state,entity_type,entity_id ON bolna_assignments
  FOR EACH ROW EXECUTE FUNCTION bolna_guard_warehouse_assignment();

CREATE FUNCTION bolna_guard_warehouse_ai_batch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(81620404);
  IF EXISTS (SELECT 1 FROM bolna_warehouse_contacts WHERE phone_last10=right(regexp_replace(NEW.contact_number,'[^0-9]','','g'),10))
    OR EXISTS (SELECT 1 FROM bolna_warehouse_matches WHERE entity_type='record'
      AND entity_id=CASE WHEN NEW.record_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NEW.record_id::uuid END) THEN
    RAISE EXCEPTION 'This number has a warehouse already added to DB and cannot be queued for AI calls.'
      USING ERRCODE='23514',DETAIL='{"code":"WAREHOUSE_ALREADY_ADDED","field":"phone","message":"This number has a warehouse already added to DB and cannot be queued for AI calls."}';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bolna_warehouse_ai_batch_guard BEFORE INSERT OR UPDATE OF contact_number,record_id ON call_batch_items
  FOR EACH ROW EXECUTE FUNCTION bolna_guard_warehouse_ai_batch();

ALTER TABLE bolna_warehouse_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolna_warehouse_imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bolna_warehouse_contacts,bolna_warehouse_imports,bolna_warehouse_matches FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON bolna_warehouse_contacts,bolna_warehouse_imports,bolna_warehouse_matches FROM anon;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON bolna_warehouse_contacts,bolna_warehouse_imports,bolna_warehouse_matches FROM authenticated;
  END IF;
END $$;
