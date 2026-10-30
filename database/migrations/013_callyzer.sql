-- Device activity stays separate from manual attempts and business outcomes.
alter table public.bolna_app_users
  add column callyzer_number text,
  add column callyzer_tracking_since timestamptz,
  add column callyzer_device jsonb;
alter table public.bolna_app_users add constraint callyzer_link_check check (
  (callyzer_number is null) = (callyzer_tracking_since is null) and
  (callyzer_number is null or callyzer_number ~ '^[1-9][0-9]{0,3}-[0-9]{6,14}$')
);
create unique index bolna_users_callyzer_number on public.bolna_app_users(callyzer_number) where callyzer_number is not null;

create table public.callyzer_calls (
  account_key text not null,
  source_id text not null,
  employee_number text not null,
  caller_email text references public.bolna_app_users(email),
  client_name text,
  client_number text,
  occurred_at timestamptz not null,
  duration_seconds integer check(duration_seconds >= 0),
  call_type text not null check(call_type in ('Incoming','Outgoing','Missed','Rejected')),
  call_method text not null check(call_method in ('PhoneCall','WhatsAppCall')),
  call_mode text not null check(call_mode in ('Voice','Video')),
  provider_synced_at timestamptz,
  provider_modified_at timestamptz,
  imported_at timestamptz not null default now(),
  primary key(account_key, source_id)
);
create index callyzer_calls_caller_time on public.callyzer_calls(account_key,caller_email,occurred_at desc,source_id);
create index callyzer_calls_unlinked on public.callyzer_calls(employee_number,occurred_at) where caller_email is null;

create table public.callyzer_sync_state (
  account_key text primary key,
  streams jsonb not null default '{}'::jsonb,
  lease_token uuid,
  lease_until timestamptz,
  next_request_at timestamptz,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  failures integer not null default 0,
  next_attempt_at timestamptz
);

-- Only the server's database role may read employee call data or run syncs.
alter table public.callyzer_calls enable row level security;
alter table public.callyzer_sync_state enable row level security;
revoke all on public.callyzer_calls, public.callyzer_sync_state from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='anon') then
    revoke all on public.callyzer_calls, public.callyzer_sync_state from anon;
  end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then
    revoke all on public.callyzer_calls, public.callyzer_sync_state from authenticated;
  end if;
end $$;
