-- Apply before deploying the application. Existing data is retained.
ALTER TABLE bolna_assignments ADD COLUMN revision integer NOT NULL DEFAULT 0;
ALTER TABLE bolna_call_logs ADD COLUMN revision integer NOT NULL DEFAULT 0;
ALTER TABLE bolna_webhook_events ADD COLUMN lease_token uuid;
ALTER TABLE bolna_webhook_events ADD COLUMN lease_until timestamptz;
CREATE INDEX idx_bolna_events_lease ON bolna_webhook_events(lease_until) WHERE status = 'processing';
-- Old workers had no leases; make their abandoned claims recoverable.
UPDATE bolna_webhook_events SET status = 'failed', next_attempt_at = now(), last_error = 'Recovered legacy processing claim'
 WHERE status = 'processing';

CREATE TABLE bolna_call_jobs (
  call_id uuid NOT NULL REFERENCES bolna_call_logs(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('inference', 'district')),
  input_hash text NOT NULL,
  version integer NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_until timestamptz,
  last_error text,
  completed_at timestamptz,
  PRIMARY KEY (call_id, kind)
);
CREATE INDEX idx_bolna_call_jobs_due ON bolna_call_jobs(available_at) WHERE completed_at IS NULL;
CREATE INDEX idx_bolna_call_logs_batch_phone ON bolna_call_logs(batch_id, phone_last10);

ALTER TABLE call_batches ADD COLUMN intent_key uuid;
ALTER TABLE call_batches ADD COLUMN request_hash text;
ALTER TABLE call_batches ADD COLUMN last_error text;
ALTER TABLE call_batches ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE call_batches ADD COLUMN completed_at timestamptz;
ALTER TABLE call_batches ADD COLUMN resolution_note text;
ALTER TABLE call_batches ADD COLUMN resolved_by text;
CREATE UNIQUE INDEX uq_call_batches_intent ON call_batches(intent_key);
CREATE TABLE bolna_dispatch_reservations (
  phone_last10 text PRIMARY KEY CHECK (phone_last10 ~ '^[0-9]{10}$'),
  batch_id uuid NOT NULL REFERENCES call_batches(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bolna_reservations_batch ON bolna_dispatch_reservations(batch_id);
-- Historical duplicate batches remain visible. Reserve each phone once; the runtime
-- also checks legacy active items so releasing one batch cannot free another's phone.
INSERT INTO bolna_dispatch_reservations(phone_last10, batch_id)
 SELECT DISTINCT ON (right(regexp_replace(i.contact_number, '\D', '', 'g'), 10))
   right(regexp_replace(i.contact_number, '\D', '', 'g'), 10), i.batch_id
 FROM call_batch_items i JOIN call_batches b ON b.id = i.batch_id
 WHERE b.state IN ('sending', 'scheduled') AND length(regexp_replace(i.contact_number, '\D', '', 'g')) >= 10
 ORDER BY right(regexp_replace(i.contact_number, '\D', '', 'g'), 10), b.created_at, b.id
 ON CONFLICT DO NOTHING;

-- One classification policy for both raw listings and call analysis.
CREATE FUNCTION bolna_availability(call_status text, verdict text) RETURNS text
 LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE WHEN call_status IN ('busy', 'no-answer') THEN 'dead number - do not call'
   WHEN call_status IN ('completed', 'call-disconnected') THEN coalesce(nullif(trim(verdict), ''), 'Unclear')
   ELSE 'Unclear' END
$$;
