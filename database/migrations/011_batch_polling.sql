-- Compatible with legacy production and the preview's existing reconciliation columns.
-- No assignment policies, provider dispatch settings or reservations are changed.
ALTER TABLE call_batches
  ADD COLUMN IF NOT EXISTS reconciliation_hash text,
  ADD COLUMN IF NOT EXISTS reconciliation_offset integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reconciliation_token uuid,
  ADD COLUMN IF NOT EXISTS reconciliation_lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS reconciliation_after_id uuid,
  ADD COLUMN IF NOT EXISTS reconciliation_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconciliation_provider_state text,
  ADD COLUMN IF NOT EXISTS reconciliation_counts jsonb;
