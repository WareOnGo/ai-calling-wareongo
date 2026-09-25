-- Fresh databases already receive this optional field from baseline.sql. Older
-- installations can predate it, and baseline adoption must not skip the addition.
-- Processing/enrichment invalidate it when the transcript or area changes.
ALTER TABLE bolna_call_logs ADD COLUMN IF NOT EXISTS inferred_district text;
