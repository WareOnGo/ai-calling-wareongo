// Assignment readers use `r` for the raw listing and `cl` for the assigned call.
// Keep the fallback identical in My Work, Assignments and manual batch members.
export const ASSIGNMENT_SOURCE_JOIN = `left join lateral (
  select source.owner_name, source.city, source.state, source.area_sqft from raw_phones rp
  join raw_records source on source.id=rp.master_id where rp.phone_id=cl.phone_id
  order by (source.contact_type is null) desc, rp.is_primary desc, source.ingested_at desc, source.id limit 1
) work_source on true`;
export const ASSIGNMENT_CITY = "coalesce(nullif(trim(r.city),''), nullif(initcap(trim(cl.context_details->'recipient_data'->>'area')),''), work_source.city)";
export const ASSIGNMENT_REGION = "coalesce(nullif(trim(r.state),''), nullif(trim(cl.context_details->'recipient_data'->>'state'),''), work_source.state)";
export const ASSIGNMENT_SUBJECT = "coalesce(nullif(trim(r.owner_name),''), nullif(trim(cl.context_details->'recipient_data'->>'name'),''), work_source.owner_name)";
