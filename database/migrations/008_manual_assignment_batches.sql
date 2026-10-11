CREATE TABLE bolna_assignment_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_key uuid NOT NULL,
  created_by text NOT NULL REFERENCES bolna_app_users(email),
  created_at timestamptz NOT NULL DEFAULT now(),
  entity_type text NOT NULL CHECK (entity_type IN ('record','call')),
  distribution text NOT NULL CHECK (distribution IN ('single','round_robin')),
  assignees text[] NOT NULL,
  selection jsonb NOT NULL,
  request_hash text NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}',
  UNIQUE(created_by,intent_key)
);
ALTER TABLE bolna_assignments ADD COLUMN batch_id uuid REFERENCES bolna_assignment_batches(id);
CREATE INDEX bolna_assignments_batch_idx ON bolna_assignments(batch_id) WHERE batch_id IS NOT NULL;
CREATE TABLE bolna_assignment_batch_items (
  batch_id uuid NOT NULL REFERENCES bolna_assignment_batches(id),
  entity_id uuid NOT NULL,
  assignment_id bigint REFERENCES bolna_assignments(id),
  disposition text NOT NULL CHECK (disposition IN ('assign','reassign','owned','duplicate','missing_phone')),
  assignee text,
  phones text[] NOT NULL,
  previous_owners jsonb NOT NULL DEFAULT '[]',
  PRIMARY KEY(batch_id,entity_id)
);
CREATE INDEX bolna_assignment_batches_created_idx ON bolna_assignment_batches(created_at DESC,id);
ALTER TABLE bolna_assignment_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolna_assignment_batch_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bolna_assignment_batches, bolna_assignment_batch_items FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON bolna_assignment_batches, bolna_assignment_batch_items FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON bolna_assignment_batches, bolna_assignment_batch_items FROM authenticated;
  END IF;
END $$;
