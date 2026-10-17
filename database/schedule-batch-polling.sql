-- Run through schedule-batch-polling.mjs after deploying the polling handler.
-- The runner owns the transaction; a dry run rolls back both DDL and cron changes.
select pg_advisory_xact_lock(81620404);

do $$
begin
  if not exists(select 1 from public.bolna_schema_migrations where name='011_batch_polling.sql') then
    raise exception 'Apply 011_batch_polling.sql before scheduling polling';
  end if;
  if exists(select 1 from cron.job where jobname='reconcile-batches'
    and command <> 'select public.call_batch_reconcile_endpoint();') then
    raise exception 'A different reconcile-batches job already exists; inspect it before replacing it';
  end if;
end $$;

create or replace function public.call_batch_reconcile_endpoint()
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  worker_secret text;
begin
  select decrypted_secret into strict worker_secret
    from vault.decrypted_secrets where name='process_secret';
  if worker_secret is null or length(worker_secret)=0 then
    raise exception 'Missing batch polling worker credential';
  end if;
  return net.http_post(
    url := 'https://ai-calling-wareongo.vercel.app/api/batches/reconcile',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || worker_secret),
    timeout_milliseconds := 280000
  );
end $$;

-- Only the database owner running this cron should invoke the credentialed job.
revoke all on function public.call_batch_reconcile_endpoint() from public;
do $$
begin
  if exists(select 1 from pg_roles where rolname='anon') then
    revoke all on function public.call_batch_reconcile_endpoint() from anon;
  end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then
    revoke all on function public.call_batch_reconcile_endpoint() from authenticated;
  end if;
end $$;

select cron.schedule('reconcile-batches','*/5 * * * *','select public.call_batch_reconcile_endpoint();');
