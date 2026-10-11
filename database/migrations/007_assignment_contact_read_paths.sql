-- Both branches are already unique per (entity_type,entity_id,phone): raw_phones
-- has a unique listing/phone pair and calls have unique IDs. UNION ALL lets the
-- planner push entity/phone predicates into the indexed base relations.
CREATE OR REPLACE VIEW bolna_assignment_contacts AS
  SELECT 'record'::text AS entity_type, rp.master_id AS entity_id, p.phone_last10
    FROM raw_phones rp JOIN raw_phone_numbers p USING (phone_id)
   WHERE p.phone_last10 ~ '^[0-9]{10}$'
  UNION ALL
  SELECT 'call'::text, c.id, c.phone_last10
    FROM bolna_call_logs c WHERE c.phone_last10 ~ '^[0-9]{10}$';
