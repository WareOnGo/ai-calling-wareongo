-- App compatibility rollback for 3eca75b and 8fb7597.
-- Run only against a database with handoff migrations 006–008 already applied.
-- Keep all data, new tables, indexes, audit triggers and migration ledger entries.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(81620403);

DO $$ BEGIN
  IF (SELECT count(*) FROM bolna_schema_migrations WHERE name IN (
    '006_handoff_schema.sql', '007_handoff_backfill.sql', '008_handoff_search_indexes.sql'
  )) <> 3 THEN
    RAISE EXCEPTION 'Expected the fully applied handoff schema; review this database before rollback';
  END IF;
END $$;

-- The restored app has neither manual-attempt logging nor shared-phone allocation.
-- Retain the triggers for a future forward deployment, but stop enforcing them.
ALTER TABLE bolna_assignments DISABLE TRIGGER bolna_assignment_quality_guard;
ALTER TABLE bolna_assignments DISABLE TRIGGER bolna_assignment_contacts_sync;

-- Restore the classification function installed by 001_reliability.sql.
CREATE OR REPLACE FUNCTION bolna_availability(call_status text, verdict text) RETURNS text
 LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE WHEN call_status IN ('busy', 'no-answer') THEN 'dead number - do not call'
   WHEN call_status IN ('completed', 'call-disconnected') THEN coalesce(nullif(trim(verdict), ''), 'Unclear')
   ELSE 'Unclear' END
$$;
COMMIT;
