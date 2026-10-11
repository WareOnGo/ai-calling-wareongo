-- Read-only rollout review. Do not automatically merge property listings or
-- reinterpret old notes as verified call events.
-- Each row-level report is capped at 200 examples; review additional pages on
-- a representative copy before making any historical-data repair decisions.
SELECT v.phone_last10, array_agg(DISTINCT a.assignee) AS current_owners,
       array_agg(a.id ORDER BY a.id) AS assignment_ids
  FROM bolna_assignments a JOIN bolna_assignment_contacts v USING(entity_type,entity_id)
 WHERE a.state='open' GROUP BY v.phone_last10 HAVING count(DISTINCT a.id)>1
 ORDER BY v.phone_last10 LIMIT 200;

SELECT id,entity_type,entity_id,assignee,outcome,wh_id,quality_issue,possible_unresolved_followup
  FROM bolna_assignment_quality_review ORDER BY id LIMIT 200;

SELECT entity_type,state,count(*) AS legacy_episodes_without_batch
  FROM bolna_assignments WHERE batch_id IS NULL GROUP BY entity_type,state;

SELECT a.id,a.entity_type,a.entity_id,a.assignee
  FROM bolna_assignments a WHERE a.state='open'
   AND NOT EXISTS(SELECT 1 FROM bolna_assignment_contacts c WHERE c.entity_type=a.entity_type AND c.entity_id=a.entity_id)
 ORDER BY a.id LIMIT 200;

SELECT lower(trim(wh_id)) AS warehouse_reference,
       array_agg(id ORDER BY id) AS assignment_ids,
       count(DISTINCT (entity_type,entity_id)) AS work_targets
  FROM bolna_assignments
 WHERE state<>'dropped' AND added_to_db AND bolna_valid_warehouse(wh_id)
 GROUP BY lower(trim(wh_id)) HAVING count(DISTINCT (entity_type,entity_id))>1
 ORDER BY warehouse_reference LIMIT 200;
