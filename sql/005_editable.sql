-- User-editable workflow columns (maintained from the dashboard, not the pipeline).
-- The worker's upsert never touches these, so user edits are preserved across re-processing.
alter table call_logs
  add column if not exists m_call_status text,           -- "Call Status" (free text)
  add column if not exists called_by      text,           -- "Called By" (dropdown)
  add column if not exists added_to_db     boolean not null default false, -- "Added to DB"
  add column if not exists wh_id           text;           -- "WH ID" (free text)

-- Redefine the view to surface the editable columns (extends sql/003_view.sql).
drop view if exists call_analysis;
create view call_analysis as
with base as (
  select
    cl.*,
    case
      when cl.status in ('busy', 'no-answer') then 'dead number - do not call'
      when cl.status = 'completed' then coalesce(nullif(btrim(cl.llm_availability), ''), 'Unclear')
      else 'Unclear'
    end as availability_final
  from call_logs cl
)
select
  id, agent_id, batch_id, status, call_type, from_number, to_number, phone_last10,
  duration_secs, total_cost, recording_url, hangup_by, hangup_reason,

  availability_final as availability,

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

  context_details -> 'recipient_data' ->> 'name'          as owner_name,
  context_details -> 'recipient_data' ->> 'email'         as owner_email,
  context_details -> 'recipient_data' ->> 'phone'         as db_phone,
  initcap(context_details -> 'recipient_data' ->> 'area') as db_area,
  context_details -> 'recipient_data' ->> 'warehouseType' as warehouse_type,
  context_details -> 'recipient_data' ->> 'fullfilledBy'  as fulfilled_by,
  context_details -> 'recipient_data' ->> 'status'        as db_status,
  context_details -> 'recipient_data' ->> 'code'          as db_code,
  context_details -> 'recipient_data'                     as recipient_data,

  -- editable workflow columns
  m_call_status as call_status,
  called_by,
  added_to_db,
  wh_id,

  enriched as inferred, inference_version, inference_model,
  transcript, call_created_at, processed_at
from base;
