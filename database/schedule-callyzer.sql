-- Run with schedule-callyzer.mjs after deploying /api/callyzer/sync.
select pg_advisory_xact_lock(81620405);
do $$ begin
  if not exists(select 1 from public.bolna_schema_migrations where name='013_callyzer.sql') then
    raise exception 'Apply 013_callyzer.sql before scheduling Callyzer';
  end if;
  if exists(select 1 from cron.job where jobname='sync-callyzer' and command<>'select public.call_callyzer_sync_endpoint();') then
    raise exception 'A different sync-callyzer job already exists; inspect it before replacing it';
  end if;
end $$;

create or replace function public.call_callyzer_sync_endpoint()
returns bigint language plpgsql security definer set search_path = '' as $$
declare worker_secret text;
begin
  select decrypted_secret into strict worker_secret from vault.decrypted_secrets where name='process_secret';
  if worker_secret is null or length(worker_secret)=0 then raise exception 'Missing Callyzer worker credential'; end if;
  return net.http_post(
    url := 'https://ai-calling-wareongo.vercel.app/api/callyzer/sync', body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || worker_secret),
    timeout_milliseconds := 55000
  );
end $$;
revoke all on function public.call_callyzer_sync_endpoint() from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='anon') then revoke all on function public.call_callyzer_sync_endpoint() from anon; end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then revoke all on function public.call_callyzer_sync_endpoint() from authenticated; end if;
end $$;
select cron.schedule('sync-callyzer','*/5 * * * *','select public.call_callyzer_sync_endpoint();');
