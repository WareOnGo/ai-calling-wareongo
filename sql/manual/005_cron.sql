-- ============================================================================
-- Drive the worker from Supabase (pg_cron + pg_net) instead of an external cron.
--
-- MANUAL, POST-DEPLOY step — NOT run by `npm run db:init` (it lives in sql/manual/
-- because it needs your real Vercel URL + secret). Apply it in the Supabase SQL
-- editor once the app is deployed.
--
-- Replace <YOUR-APP> below, and set the process secret in the Vault block.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 1) Store the worker secret in Vault (run once). If it already exists, this is
--    a no-op; use vault.update_secret(id, '<new>') to rotate.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'process_secret') then
    perform vault.create_secret('REPLACE_WITH_PROCESS_SECRET', 'process_secret');
  end if;
end $$;

-- Helper: POST to the worker with the bearer secret pulled from Vault.
create or replace function call_process_endpoint() returns void
language plpgsql security definer as $$
begin
  perform net.http_post(
    url     := 'https://<YOUR-APP>.vercel.app/api/process',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'process_secret')
    )
  );
end $$;

-- 2) Event-driven: kick the worker the instant a webhook is queued (low latency).
create or replace function kick_processor() returns trigger
language plpgsql as $$
begin
  perform call_process_endpoint();
  return new;
end $$;

drop trigger if exists on_event_queued on webhook_events;
create trigger on_event_queued
  after insert on webhook_events
  for each row execute function kick_processor();

-- 3) Backstop: a slower poll that re-drives anything still pending/failed
--    (covers retries + any HTTP that pg_net dropped). cron.schedule upserts by name.
select cron.schedule(
  'drain-process-backstop',
  '*/3 * * * *',                      -- every 3 minutes
  $$ select call_process_endpoint(); $$
);

-- 4) Housekeeping: pg_net logs every request to net._http_response; trim it daily.
select cron.schedule(
  'prune-http-response-log',
  '0 3 * * *',                        -- 03:00 daily
  $$ delete from net._http_response where created < now() - interval '3 days'; $$
);

-- Inspect:
--   select * from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 20;
--   select status_code, count(*) from net._http_response group by 1;
