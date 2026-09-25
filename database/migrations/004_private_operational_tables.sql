-- Supabase may grant API roles access to new public-schema tables by default.
-- These are server-owned tables, reached only after the dashboard authorizes a
-- user. The configured database owner continues to access them normally.
ALTER TABLE bolna_schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolna_call_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolna_dispatch_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolna_dispatch_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON bolna_schema_migrations, bolna_call_jobs,
  bolna_dispatch_reservations, bolna_dispatch_requests, bolna_call_analysis FROM PUBLIC;

DO $$
DECLARE api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      -- The owner-executed analysis view can otherwise bypass the underlying RLS.
      -- Both old and new dashboard versions query it using the database owner.
      EXECUTE format('REVOKE ALL ON bolna_schema_migrations, bolna_call_jobs, bolna_dispatch_reservations, bolna_dispatch_requests, bolna_call_analysis FROM %I', api_role);
    END IF;
  END LOOP;
END $$;
