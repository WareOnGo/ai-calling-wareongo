-- Caller owns the transaction. Does not enable sync or change cron cadence.
SELECT pg_advisory_xact_lock(81620404);
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.bolna_schema_migrations WHERE name='017_warehouse_sync_cursors.sql') THEN
    RAISE EXCEPTION 'Apply 017_warehouse_sync_cursors.sql before scheduling warehouse sync';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname='enrich-analysis') <> 1 THEN
    RAISE EXCEPTION 'Expected one existing enrich-analysis job';
  END IF;
  IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='enrich-analysis' AND btrim(command) NOT IN (
    'select call_enrich_endpoint();','select public.call_enrich_endpoint();','select public.call_enrich_and_warehouse_endpoint();')) THEN
    RAISE EXCEPTION 'A different enrich-analysis command exists; inspect it before replacing it';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.call_warehouse_sync_endpoint()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE worker_secret text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.bolna_warehouse_sync_state WHERE id=1 AND enabled
    AND next_attempt_at <= clock_timestamp() AND (lease_until IS NULL OR lease_until <= clock_timestamp())) THEN
    RETURN NULL;
  END IF;
  SELECT decrypted_secret INTO STRICT worker_secret FROM vault.decrypted_secrets WHERE name='process_secret';
  IF worker_secret IS NULL OR length(worker_secret)=0 THEN RAISE EXCEPTION 'Missing warehouse sync worker credential'; END IF;
  RETURN net.http_post(
    url := 'https://ai-calling-wareongo.vercel.app/api/warehouses/sync',body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || worker_secret),
    timeout_milliseconds := 110000
  );
END $$;

CREATE OR REPLACE FUNCTION public.call_enrich_and_warehouse_endpoint()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Each enqueue has its own subtransaction: failure in either cannot undo the
  -- other's queued request. These calls only enqueue asynchronous HTTP work.
  BEGIN
    -- The legacy enrichment helper resolves call_app_endpoint without a schema.
    -- Preserve that resolution while keeping the new credentialed helper private.
    PERFORM pg_catalog.set_config('search_path','public,pg_temp',true);
    PERFORM public.call_enrich_endpoint();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Enrichment enqueue failed (SQLSTATE %)', SQLSTATE;
  END;
  PERFORM pg_catalog.set_config('search_path','',true);
  BEGIN
    PERFORM public.call_warehouse_sync_endpoint();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Warehouse sync enqueue failed (SQLSTATE %)', SQLSTATE;
  END;
END $$;

REVOKE ALL ON FUNCTION public.call_warehouse_sync_endpoint(),public.call_enrich_and_warehouse_endpoint() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON FUNCTION public.call_warehouse_sync_endpoint(),public.call_enrich_and_warehouse_endpoint() FROM anon;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON FUNCTION public.call_warehouse_sync_endpoint(),public.call_enrich_and_warehouse_endpoint() FROM authenticated;
  END IF;
END $$;
SELECT cron.alter_job(jobid,command := 'select public.call_enrich_and_warehouse_endpoint();')
  FROM cron.job WHERE jobname='enrich-analysis';
