-- Extend the manual vocabulary without changing retained events or assignment policy.
ALTER TABLE bolna_assignments DROP CONSTRAINT bolna_assignments_disposition_check;
ALTER TABLE bolna_assignments ADD CONSTRAINT bolna_assignments_disposition_check
  CHECK (disposition IN ('connected','no_answer','busy','switched_off','callback','awaiting_confirmation','invalid_number','owner_unresponsive','leased_out','no_property_for_rent'));

ALTER TABLE bolna_manual_attempts DROP CONSTRAINT bolna_manual_attempts_disposition_check;
ALTER TABLE bolna_manual_attempts ADD CONSTRAINT bolna_manual_attempts_disposition_check
  CHECK (disposition IN ('connected','no_answer','busy','switched_off','callback','awaiting_confirmation','invalid_number','owner_unresponsive','leased_out','no_property_for_rent'));

CREATE OR REPLACE FUNCTION bolna_retry_dispositions() RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT ARRAY['no_answer','busy','switched_off','callback','awaiting_confirmation','owner_unresponsive']::text[]
$$;
