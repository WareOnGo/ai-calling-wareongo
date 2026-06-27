-- Migrate call_logs from the generic enrichment shape to the property-verification
-- inference shape (modeled on the GW call-log-inference skill). Idempotent.

-- Drop the generic enrichment columns.
alter table call_logs
  drop column if exists summary,
  drop column if exists sentiment,
  drop column if exists key_points,
  drop column if exists follow_up_needed;

-- Add the LLM inference fields. We store the LLM's raw availability verdict in
-- llm_availability; the final, presentation availability (with the metadata
-- dead/Unclear overrides) is computed in the call_analysis view.
alter table call_logs
  add column if not exists llm_availability   text,
  add column if not exists built_up_area_sqft text,
  add column if not exists city_area          text,
  add column if not exists expected_rent      text,
  add column if not exists possession         text,
  add column if not exists confidence         text,
  add column if not exists notes              text,
  add column if not exists inference_version  int     not null default 0,
  add column if not exists inference_model    text,
  add column if not exists needs_review       boolean not null default false;

-- Normalized join key: last 10 digits of the customer's number
-- (recipient for outbound, caller for inbound). Pre-stages the master-phone FK.
alter table call_logs
  add column if not exists phone_last10 text generated always as (
    right(
      regexp_replace(
        coalesce(case when call_type = 'inbound' then from_number else to_number end, ''),
        '\D', '', 'g'
      ),
      10
    )
  ) stored;

create index if not exists idx_call_logs_phone_last10 on call_logs (phone_last10);

-- Drives the "enrich later" / re-infer selection: completed calls not yet
-- inferred at the current version. (Cost gate applied in the query.)
create index if not exists idx_call_logs_needs_inference
  on call_logs (total_cost desc)
  where status = 'completed' and enriched = false;
