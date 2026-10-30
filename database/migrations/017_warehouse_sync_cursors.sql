-- 016 was already deployed disabled; keep its checksum intact.
ALTER TABLE bolna_warehouse_sync_state
  ADD COLUMN initialized boolean NOT NULL DEFAULT false,
  ADD COLUMN warehouse_cursor integer NOT NULL DEFAULT 0 CHECK (warehouse_cursor >= 0),
  ADD COLUMN audit_cursor_at timestamp without time zone,
  ADD COLUMN audit_cursor_id text,
  ADD COLUMN recheck_cursor integer NOT NULL DEFAULT 0 CHECK (recheck_cursor >= 0),
  ADD CONSTRAINT bolna_warehouse_audit_cursor_complete CHECK ((audit_cursor_at IS NULL) = (audit_cursor_id IS NULL));
