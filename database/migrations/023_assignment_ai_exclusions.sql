-- Record optional AI-history exclusions alongside the other allocation decisions.
ALTER TABLE bolna_assignment_batch_items DROP CONSTRAINT bolna_assignment_batch_items_disposition_check;
ALTER TABLE bolna_assignment_batch_items ADD CONSTRAINT bolna_assignment_batch_items_disposition_check
  CHECK (disposition IN ('assign','reassign','owned','duplicate','missing_phone','warehouse_exists','excluded_ai'));
