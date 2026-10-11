create table bolna_provider_cache (
 key text primary key, wallet double precision, refreshed_at timestamptz,
 attempted_at timestamptz not null default now(), error text
);
alter table bolna_provider_cache enable row level security;
revoke all on bolna_provider_cache from public;
