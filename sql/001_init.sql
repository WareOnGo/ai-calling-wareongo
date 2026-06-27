-- Bolna Processing schema
-- Run once against your Supabase database (psql or the Supabase SQL editor).

-- ============================================================
-- Table 1: webhook_events  (raw landing zone + job queue)
-- The insert into this table is the durability boundary: once a row is here,
-- the event can never be lost. The /api/process worker drains it.
-- ============================================================
create table if not exists webhook_events (
  id              uuid primary key,                          -- Bolna execution id (idempotency key)
  raw             jsonb       not null,                      -- full webhook payload, untouched
  status          text        not null default 'pending',   -- pending | processing | processed | failed
  attempts        int         not null default 0,
  max_attempts    int         not null default 8,
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  received_at     timestamptz not null default now(),
  processed_at    timestamptz
);

-- Index that the worker's "due rows" query uses.
create index if not exists idx_webhook_events_due
  on webhook_events (next_attempt_at)
  where status in ('pending', 'failed');

-- ============================================================
-- Table 2: call_logs  (cleaned + OpenAI-enriched output)
-- ============================================================
create table if not exists call_logs (
  id               uuid primary key,            -- Bolna execution id
  agent_id         uuid,
  batch_id         text,
  status           text,
  call_type        text,                        -- inbound | outbound
  from_number      text,
  to_number        text,
  duration_secs    int,
  total_cost       numeric,                     -- cents
  cost_breakdown   jsonb,
  recording_url    text,
  hangup_by        text,
  hangup_reason    text,
  answered_by_vm   boolean,
  transcript       text,

  -- OpenAI enrichment
  summary          text,
  sentiment        text,                        -- positive | neutral | negative
  key_points       jsonb,
  follow_up_needed boolean,
  enrichment       jsonb,                       -- full enrichment object (for forward-compat)
  enriched         boolean not null default false, -- true once OpenAI enrichment has run

  -- Bolna-native extras
  context_details  jsonb,

  raw              jsonb,                        -- full payload kept for safety
  call_created_at  timestamptz,
  processed_at     timestamptz not null default now()
);

create index if not exists idx_call_logs_agent on call_logs (agent_id);
create index if not exists idx_call_logs_created on call_logs (call_created_at desc);
-- Finds rows still needing OpenAI enrichment (the "enrich later" pass).
create index if not exists idx_call_logs_unenriched
  on call_logs (call_created_at)
  where enriched = false;
