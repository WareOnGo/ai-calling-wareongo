-- One confirmed selection may create one batch per language. Child batches keep
-- the existing provider checkpoints and global phone reservations.
CREATE TABLE bolna_dispatch_requests (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  request_hash text NOT NULL,
  routing_mode text NOT NULL CHECK (routing_mode IN ('auto', 'hindi', 'english')),
  scheduled_at timestamptz NOT NULL,
  total integer NOT NULL,
  callable integer NOT NULL,
  excluded_by_cat integer NOT NULL,
  held_region integer NOT NULL,
  already_queued integer NOT NULL,
  skipped_no_number integer NOT NULL
);
ALTER TABLE call_batches ADD COLUMN dispatch_request_id uuid REFERENCES bolna_dispatch_requests(id);
ALTER TABLE call_batches ADD COLUMN agent_language text CHECK (agent_language IN ('hindi', 'english'));
CREATE UNIQUE INDEX uq_call_batches_dispatch_language ON call_batches(dispatch_request_id, agent_language);

-- Keep historical built-up measurements; never relabel them as carpet area.
ALTER TABLE bolna_call_logs ADD COLUMN carpet_area_sqft text;

-- Append the new view column to preserve the existing view column identities.
create or replace view bolna_call_analysis as
with base as (
  select
    cl.*,
    bolna_availability(cl.status, cl.llm_availability) as availability_final
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
  transcript, call_created_at, processed_at, carpet_area_sqft
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
