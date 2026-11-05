// Assignment readers use `r` for the raw listing and `cl` for the assigned call.
// Keep the fallback identical in My Work, Assignments and manual batch members.
export const ASSIGNMENT_SOURCE_JOIN = `left join lateral (
  select source.owner_name, source.city, source.state, source.area_sqft from raw_phones rp
  join raw_records source on source.id=rp.master_id where rp.phone_id=cl.phone_id
  order by (source.contact_type is null) desc, rp.is_primary desc, source.ingested_at desc, source.id limit 1
) work_source on true`;
export const ASSIGNMENT_CITY = "coalesce(nullif(trim(r.city),''), nullif(initcap(trim(cl.context_details->'recipient_data'->>'area')),''), work_source.city)";
export const ASSIGNMENT_REGION = "coalesce(nullif(trim(r.state),''), nullif(trim(cl.context_details->'recipient_data'->>'state'),''), work_source.state)";
// A listing's display phone: its primary number first. Calls use the dialled number.
export const ASSIGNMENT_PHONE_JOIN = `
  left join lateral (
    select pp.phone from raw_phones rp
      join raw_phone_numbers pp on pp.phone_id = rp.phone_id
     where rp.master_id = r.id and nullif(trim(pp.phone), '') is not null order by rp.is_primary desc limit 1
  ) rphone on true`;
export const ASSIGNMENT_PHONE = "coalesce(rphone.phone, case when cl.call_type = 'inbound' then cl.from_number else cl.to_number end)";
export const ASSIGNMENT_SUBJECT ="coalesce(nullif(trim(r.owner_name),''), nullif(trim(cl.context_details->'recipient_data'->>'name'),''), work_source.owner_name)";
