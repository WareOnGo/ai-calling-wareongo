// Preserve production's retained-phone fallback when a provider snapshot omits
// both number fields. A usable execution number always takes precedence.
export const CONTACT_PHONES_SQL = `
  select entity_type,entity_id,phone_last10 from bolna_assignment_contacts
  union all
  select 'call',c.id,p.phone_last10 from bolna_call_logs c
    join raw_phone_numbers p using(phone_id)
    where coalesce(c.phone_last10,'') !~ '^[0-9]{10}$'
      and p.phone_last10 ~ '^[0-9]{10}$'`;
