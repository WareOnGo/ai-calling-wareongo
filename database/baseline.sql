-- App-owned schema only. Fresh databases only; see database/README.md.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE "public"."bolna_call_logs" (
    "id" UUID NOT NULL,
    "agent_id" UUID,
    "batch_id" TEXT,
    "status" TEXT,
    "call_type" TEXT,
    "from_number" TEXT,
    "to_number" TEXT,
    "duration_secs" INTEGER,
    "total_cost" DECIMAL,
    "cost_breakdown" JSONB,
    "recording_url" TEXT,
    "hangup_by" TEXT,
    "hangup_reason" TEXT,
    "answered_by_vm" BOOLEAN,
    "transcript" TEXT,
    "enrichment" JSONB,
    "context_details" JSONB,
    "raw" JSONB,
    "call_created_at" TIMESTAMPTZ(6),
    "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enriched" BOOLEAN NOT NULL DEFAULT false,
    "llm_availability" TEXT,
    "built_up_area_sqft" TEXT,
    "city_area" TEXT,
    "expected_rent" TEXT,
    "possession" TEXT,
    "confidence" TEXT,
    "notes" TEXT,
    "inference_version" INTEGER NOT NULL DEFAULT 0,
    "inference_model" TEXT,
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    
    
    
    
    
    
    "phone_last10" TEXT GENERATED ALWAYS AS ("right"(regexp_replace(COALESCE(
CASE
    WHEN (call_type = 'inbound'::text) THEN from_number
    ELSE to_number
END, ''::text), '\D'::text, ''::text, 'g'::text), 10)) STORED,
    "m_call_status" TEXT,
    "called_by" TEXT,
    "added_to_db" BOOLEAN NOT NULL DEFAULT false,
    "wh_id" TEXT,
    "phone_id" BIGINT,

    CONSTRAINT "bolna_call_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."bolna_webhook_events" (
    "id" UUID NOT NULL,
    "raw" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 8,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "bolna_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."call_batch_items" (
    "id" BIGSERIAL NOT NULL,
    "batch_id" UUID NOT NULL,
    "record_id" TEXT,
    "name" TEXT,
    "contact_number" TEXT NOT NULL,
    "area" TEXT,
    "cat" TEXT,

    CONSTRAINT "call_batch_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."call_batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "agent_id" TEXT,
    "scheduled_at" TIMESTAMPTZ(6),
    "state" TEXT NOT NULL DEFAULT 'stubbed',
    "bolna_batch_id" TEXT,
    "filters" JSONB,
    "total" INTEGER NOT NULL DEFAULT 0,
    "callable" INTEGER NOT NULL DEFAULT 0,
    "excluded_by_cat" INTEGER NOT NULL DEFAULT 0,
    "held_region" INTEGER NOT NULL DEFAULT 0,
    "skipped_no_number" INTEGER NOT NULL DEFAULT 0,
    "already_queued" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "call_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."raw_phone_numbers" (
    "phone_id" BIGSERIAL NOT NULL,
    "phone_last10" TEXT NOT NULL,
    "phone" TEXT,
    "first_seen" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_phone_numbers_pkey" PRIMARY KEY ("phone_id")
);

CREATE TABLE "public"."raw_phones" (
    "id" BIGSERIAL NOT NULL,
    "master_id" UUID NOT NULL,
    "phone_id" BIGINT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "raw_phones_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."raw_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source" TEXT NOT NULL,
    "source_record_id" TEXT NOT NULL,
    "owner_name" TEXT,
    "warehouse_type" TEXT,
    "listing_status" TEXT,
    "area_sqft" DECIMAL,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ingested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contact_type" TEXT,
    "owner_first_name" TEXT,

    CONSTRAINT "raw_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_bolna_call_logs_agent" ON "public"."bolna_call_logs"("agent_id" ASC);

CREATE INDEX "idx_bolna_call_logs_created" ON "public"."bolna_call_logs"("call_created_at" DESC);

CREATE INDEX "idx_bolna_call_logs_needs_inference" ON "public"."bolna_call_logs"("total_cost" DESC) WHERE ((status = 'completed'::text) AND (enriched = false));

CREATE INDEX "idx_bolna_call_logs_phone_id" ON "public"."bolna_call_logs"("phone_id" ASC);

CREATE INDEX "idx_bolna_call_logs_phone_last10" ON "public"."bolna_call_logs"("phone_last10" ASC);

CREATE INDEX "idx_bolna_call_logs_unenriched" ON "public"."bolna_call_logs"("call_created_at" ASC) WHERE (enriched = false);

CREATE INDEX "idx_bolna_webhook_events_due" ON "public"."bolna_webhook_events"("next_attempt_at" ASC) WHERE (status = ANY (ARRAY['pending'::text, 'failed'::text]));

CREATE INDEX "idx_call_batch_items_batch" ON "public"."call_batch_items"("batch_id" ASC);

CREATE INDEX "idx_call_batches_bolna" ON "public"."call_batches"("bolna_batch_id" ASC);

CREATE INDEX "idx_call_batches_scheduled_at" ON "public"."call_batches"("scheduled_at" DESC);

CREATE UNIQUE INDEX "raw_phone_numbers_phone_last10_key" ON "public"."raw_phone_numbers"("phone_last10" ASC);

CREATE INDEX "idx_raw_phones_master" ON "public"."raw_phones"("master_id" ASC);

CREATE INDEX "idx_raw_phones_phone" ON "public"."raw_phones"("phone_id" ASC);

CREATE UNIQUE INDEX "raw_phones_master_id_phone_id_key" ON "public"."raw_phones"("master_id" ASC, "phone_id" ASC);

CREATE INDEX "idx_raw_records_source" ON "public"."raw_records"("source" ASC);

CREATE UNIQUE INDEX "raw_records_source_source_record_id_key" ON "public"."raw_records"("source" ASC, "source_record_id" ASC);

ALTER TABLE "public"."bolna_call_logs" ADD CONSTRAINT "fk_bolna_call_logs_phone" FOREIGN KEY ("phone_id") REFERENCES "public"."raw_phone_numbers"("phone_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "public"."call_batch_items" ADD CONSTRAINT "call_batch_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."call_batches"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "public"."raw_phones" ADD CONSTRAINT "raw_phones_master_id_fkey" FOREIGN KEY ("master_id") REFERENCES "public"."raw_records"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "public"."raw_phones" ADD CONSTRAINT "raw_phones_phone_id_fkey" FOREIGN KEY ("phone_id") REFERENCES "public"."raw_phone_numbers"("phone_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE TABLE "bolna_app_users" (
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'employee',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bolna_app_users_pkey" PRIMARY KEY ("email")
);

CREATE TABLE "bolna_assignments" (
    "id" BIGSERIAL NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "assignee" TEXT NOT NULL,
    "assigned_by" TEXT NOT NULL,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "state" TEXT NOT NULL DEFAULT 'open',
    "outcome" TEXT,
    "remarks" TEXT,
    "added_to_db" BOOLEAN NOT NULL DEFAULT false,
    "wh_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "bolna_assignments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_bolna_app_users_active" ON "bolna_app_users"("active") WHERE (active);

CREATE INDEX "idx_bolna_assignments_assignee" ON "bolna_assignments"("assignee", "state");

CREATE INDEX "idx_bolna_assignments_entity" ON "bolna_assignments"("entity_type", "entity_id");

CREATE UNIQUE INDEX "uq_bolna_assignments_open" ON "bolna_assignments"("entity_type", "entity_id") WHERE (state = 'open'::text);

ALTER TABLE "bolna_assignments" ADD CONSTRAINT "fk_bolna_assignments_assignee" FOREIGN KEY ("assignee") REFERENCES "bolna_app_users"("email") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE bolna_call_logs ADD COLUMN IF NOT EXISTS inferred_district text;
-- Idempotent by design: safe to re-run after every `prisma db push`.

-- Extensions. Prisma does not manage these, and without pg_trgm every fuzzy search
-- on the raw/calls grids errors (buildFilter uses word_similarity). Prod already had
-- it from the retired sql/009, so this is a no-op there — but a database built from
-- prisma/migrations alone did NOT, which is exactly how the harness ran for a while
-- with both grids' search silently broken.
create extension if not exists pg_trgm;
create extension if not exists pgcrypto;
-- CHECK constraints: Prisma has no schema syntax for these, so they're written by
-- hand and Prisma Migrate will leave them alone on future diffs. The app validates
-- the same values in TypeScript (isOutcome / isAssignmentState); this is the
-- database-level backstop.
ALTER TABLE "bolna_app_users" DROP CONSTRAINT IF EXISTS "bolna_app_users_role_chk";
ALTER TABLE "bolna_app_users"
  ADD CONSTRAINT "bolna_app_users_role_chk" CHECK (role IN ('admin', 'employee'));

ALTER TABLE "bolna_assignments" DROP CONSTRAINT IF EXISTS "bolna_assignments_entity_type_chk";
ALTER TABLE "bolna_assignments"
  ADD CONSTRAINT "bolna_assignments_entity_type_chk" CHECK (entity_type IN ('record', 'call'));

ALTER TABLE "bolna_assignments" DROP CONSTRAINT IF EXISTS "bolna_assignments_state_chk";
ALTER TABLE "bolna_assignments"
  ADD CONSTRAINT "bolna_assignments_state_chk" CHECK (state IN ('open', 'done', 'dropped'));

-- Same vocabulary the LLM produces, so human- and AI-verified records roll up together.
ALTER TABLE "bolna_assignments" DROP CONSTRAINT IF EXISTS "bolna_assignments_outcome_chk";
ALTER TABLE "bolna_assignments"
  ADD CONSTRAINT "bolna_assignments_outcome_chk"
  CHECK (outcome IS NULL OR outcome IN ('Available', 'Unavailable', 'Unclear'));

-- ---------------------------------------------------------------------------
-- bolna_call_analysis: recreated to expose the current assignment.
-- Prisma does not manage views, so the definition lives here as raw SQL. This is
-- the ONLY copy — it used to be duplicated across four sql/ files.
-- ---------------------------------------------------------------------------
drop view if exists bolna_call_analysis;
create view bolna_call_analysis as
with base as (
  select
    cl.*,
    case
      -- Dead = NO REACH. Strictly busy / no-answer (a completed call is never dead).
      when cl.status in ('busy', 'no-answer') then 'dead number - do not call'
      -- call-disconnected is a real conversation in our Bolna setup, treat like completed.
      when cl.status in ('completed', 'call-disconnected')
        then coalesce(nullif(btrim(cl.llm_availability), ''), 'Unclear')
      else 'Unclear'
    end as availability_final
  from bolna_call_logs cl
)
select
  id, agent_id, batch_id, status, call_type, from_number, to_number, phone_last10,
  duration_secs, total_cost, recording_url, hangup_by, hangup_reason,

  availability_final as availability,

  -- Segment only meaningful for dead / Unclear (Available/Unavailable -> '').
  case
    when availability_final = 'dead number - do not call' then 'no_reach'
    when availability_final = 'Unclear' then
      case
        when hangup_reason = 'Call recipient hungup' then 'followup_hungup'
        when hangup_reason = 'inactivity_timeout'    then 'followup_silent'
        when hangup_reason = 'voicemail_detected'    then 'followup_voicemail'
        when status in ('scheduled', 'stopped', 'error', 'ringing') then 'followup_retry'
        else 'followup_other'
      end
    else ''
  end as segment,

  built_up_area_sqft, city_area, expected_rent, possession, confidence, notes, needs_review,

  -- Source-DB metadata passed into the agent (context_details.recipient_data).
  context_details -> 'recipient_data' ->> 'name'          as owner_name,
  context_details -> 'recipient_data' ->> 'email'         as owner_email,
  context_details -> 'recipient_data' ->> 'phone'         as db_phone,
  initcap(context_details -> 'recipient_data' ->> 'area') as db_area,
  context_details -> 'recipient_data' ->> 'warehouseType' as warehouse_type,
  context_details -> 'recipient_data' ->> 'fullfilledBy'  as fulfilled_by,
  context_details -> 'recipient_data' ->> 'status'        as db_status,
  context_details -> 'recipient_data' ->> 'code'          as db_code,
  context_details -> 'recipient_data'                     as recipient_data,

  -- editable workflow columns (human-owned; the worker upsert never touches them)
  m_call_status as call_status,
  called_by,
  added_to_db,
  wh_id,

  -- Current (open) assignment, for DISPLAY and for the employee's own edits.
  -- Employee scoping still filters with an EXISTS against `assignments` rather than
  -- `assigned_to = $me`: a predicate on a computed column can't use
  -- idx_assignments_assignee, so the planner would evaluate the lateral for every
  -- row before filtering. See src/lib/scope.ts.
  asg.assignee   as assigned_to,
  asg.assignment_id,
  asg.state      as assignment_state,
  asg.outcome    as assignment_outcome,
  asg.remarks    as assignment_remarks,
  asg.note       as assignment_note,
  asg.asg_added   as assignment_added_to_db,
  asg.asg_wh      as assignment_wh_id,

  -- Representative matched listing (first by owner>broker, primary, newest),
  -- exposed as scalar columns; full set kept in raw_matches.
  coalesce(raw.match_count, 0)                  as raw_match_count,
  raw.matches -> 0 ->> 'source'                 as raw_source,
  raw.matches -> 0 ->> 'owner_name'             as raw_owner_name,
  raw.matches -> 0 ->> 'warehouse_type'         as raw_warehouse_type,
  raw.matches -> 0 ->> 'city'                   as raw_city,
  raw.matches -> 0 ->> 'state'                  as raw_state,
  raw.matches -> 0 ->> 'area_sqft'              as raw_area_sqft,
  raw.matches -> 0 ->> 'contact_type'           as raw_contact_type,
  raw.all_sources                               as raw_sources,   -- ALL distinct sources this number is listed in
  raw.matches                                   as raw_matches,

  enriched as inferred, inference_version, inference_model,
  transcript, call_created_at, processed_at
from base
left join lateral (
  -- match_count + all_sources span ALL matches; the serialized `matches` array is
  -- capped at 12 to bound egress (a broker number can match 75+ listings).
  select
    (select count(*) from raw_phones rp where rp.phone_id = base.phone_id) as match_count,
    (select string_agg(distinct r2.source, ', ' order by r2.source)
       from raw_phones rp2 join raw_records r2 on r2.id = rp2.master_id
      where rp2.phone_id = base.phone_id) as all_sources,
    (select jsonb_agg(m) from (
        select jsonb_build_object(
          'source', r.source, 'source_record_id', r.source_record_id,
          'owner_name', r.owner_name, 'warehouse_type', r.warehouse_type,
          'listing_status', r.listing_status, 'area_sqft', r.area_sqft,
          'address', r.address, 'city', r.city, 'state', r.state,
          'contact_type', r.contact_type, 'is_primary', rp.is_primary
        ) as m
        from raw_phones rp
        join raw_records r on r.id = rp.master_id
        where rp.phone_id = base.phone_id
        order by (r.contact_type is null) desc, rp.is_primary desc, r.ingested_at desc
        limit 12
     ) lim) as matches
) raw on true
left join lateral (
  -- The open assignment if there is one, else the most recent finished one, so a
  -- completed item still shows who did it. Dropped (admin-unassigned) rows are
  -- invisible. Mirrors currentAssignmentLateral() in src/lib/scope.ts.
  -- aliased to assignment_id: an exposed `id` here would make the unqualified
  -- `id` in the outer select list ambiguous against base.id
  select a.id as assignment_id, a.assignee, a.state, a.outcome, a.remarks, a.note,
         a.added_to_db as asg_added, a.wh_id as asg_wh
    from bolna_assignments a
   where a.entity_type = 'call' and a.entity_id = base.id and a.state <> 'dropped'
   order by (a.state = 'open') desc, a.assigned_at desc
   limit 1
) asg on true;
