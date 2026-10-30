-- Apply ONLY to WAG, after creating the dedicated callongo_warehouse_reader role.
-- Expose change identifiers, never audit actor details or before/after phone values.
CREATE VIEW public.callongo_warehouse_changes WITH (security_barrier=true) AS
WITH candidates AS (
  SELECT id AS event_id,"createdAt" AS changed_at,
    CASE WHEN entity='warehouse' THEN "entityId" ELSE metadata->>'warehouseId' END AS warehouse_key
  FROM public.audit_logs
  WHERE (entity='warehouse' AND (
    action IN ('CREATE','DELETE') OR (action='UPDATE' AND (
      -- Legacy entries without a trustworthy field list are rechecked too.
      coalesce(jsonb_typeof(metadata->'updatedFields'),'null') <> 'array'
      OR (metadata->'updatedFields') ?| ARRAY['contactNumber','alt_phone_number']
    ))
  )) OR (entity='staged_warehouse' AND action='APPROVE')
), typed AS (
  SELECT event_id,changed_at,CASE WHEN warehouse_key ~ '^[1-9][0-9]{0,9}$' THEN
    CASE WHEN warehouse_key::bigint <= 2147483647 THEN warehouse_key::integer END END AS warehouse_id
  FROM candidates
)
SELECT event_id,changed_at,warehouse_id FROM typed WHERE warehouse_id IS NOT NULL;
REVOKE ALL ON public.callongo_warehouse_changes FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON public.callongo_warehouse_changes FROM anon; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON public.callongo_warehouse_changes FROM authenticated; END IF;
END $$;
GRANT SELECT ON public.callongo_warehouse_changes TO callongo_warehouse_reader;
