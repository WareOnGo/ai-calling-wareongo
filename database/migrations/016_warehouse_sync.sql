-- Scheduling is a separate rollout step after the worker and its credential exist.
CREATE TABLE bolna_warehouse_sync_state (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,
  interval_seconds integer NOT NULL DEFAULT 3600 CHECK (interval_seconds BETWEEN 600 AND 86400),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_snapshot_at timestamptz,
  source_sha256 text,
  lease_token uuid,
  lease_until timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0,
  last_error_code text,
  last_summary jsonb NOT NULL DEFAULT '{}',
  CHECK ((lease_token IS NULL) = (lease_until IS NULL))
);
INSERT INTO bolna_warehouse_sync_state DEFAULT VALUES;

CREATE TABLE bolna_warehouse_sync_runs (
  id uuid PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('running','succeeded','failed','abandoned')),
  snapshot_at timestamptz,
  source_sha256 text,
  summary jsonb NOT NULL DEFAULT '{}',
  error_code text
);
CREATE INDEX bolna_warehouse_sync_runs_started_idx ON bolna_warehouse_sync_runs(started_at DESC);

-- Missing source pairs remain effective exclusions until explicitly reviewed.
CREATE TABLE bolna_warehouse_sync_reviews (
  phone_last10 text NOT NULL,
  warehouse_id integer NOT NULL,
  reason text NOT NULL DEFAULT 'missing_from_source' CHECK (reason = 'missing_from_source'),
  first_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  snapshot_at timestamptz NOT NULL,
  resolved_at timestamptz,
  PRIMARY KEY (phone_last10, warehouse_id),
  FOREIGN KEY (phone_last10, warehouse_id) REFERENCES bolna_warehouse_contacts(phone_last10, warehouse_id)
);
CREATE INDEX bolna_warehouse_sync_reviews_pending_idx ON bolna_warehouse_sync_reviews(last_seen_at)
  WHERE resolved_at IS NULL;

ALTER TABLE bolna_warehouse_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolna_warehouse_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolna_warehouse_sync_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bolna_warehouse_sync_state,bolna_warehouse_sync_runs,bolna_warehouse_sync_reviews FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON bolna_warehouse_sync_state,bolna_warehouse_sync_runs,bolna_warehouse_sync_reviews FROM anon;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON bolna_warehouse_sync_state,bolna_warehouse_sync_runs,bolna_warehouse_sync_reviews FROM authenticated;
  END IF;
END $$;
