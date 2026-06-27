-- call_analysis: the human-readable final sheet (skill step 7).
-- The deterministic dead/followup segmentation lives HERE, not in stored columns,
-- so changing the rules re-classifies every call instantly, for free, no re-processing.
drop view if exists call_analysis;
create view call_analysis as
with base as (
  select
    cl.*,
    case
      -- Dead = NO REACH. Strictly busy / no-answer (a completed call is never dead).
      when cl.status in ('busy', 'no-answer') then 'dead number - do not call'
      -- Completed: use the LLM verdict, default Unclear if not yet inferred.
      when cl.status = 'completed' then coalesce(nullif(btrim(cl.llm_availability), ''), 'Unclear')
      -- Everything else still connected to nothing useful.
      else 'Unclear'
    end as availability_final
  from call_logs cl
)
select
  id,
  agent_id,
  batch_id,
  status,
  call_type,
  from_number,
  to_number,
  phone_last10,
  duration_secs,
  total_cost,
  recording_url,
  hangup_by,
  hangup_reason,

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

  built_up_area_sqft,
  city_area,
  expected_rent,
  possession,
  confidence,
  notes,
  needs_review,

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

  enriched      as inferred,
  inference_version,
  inference_model,

  transcript,
  call_created_at,
  processed_at
from base;
