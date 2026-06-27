-- Inferred district/city for calls whose source DB record had no `area`.
-- Filled by /api/district (LLM) from the transcript + city_area hint.
alter table call_logs add column if not exists inferred_district text;

-- '' means "we tried and couldn't determine it"; NULL means "not yet attempted".
create index if not exists idx_call_logs_needs_district
  on call_logs (id)
  where inferred_district is null;
