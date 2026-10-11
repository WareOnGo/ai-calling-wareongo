-- Deterministic fixture data. Shaped to light up every visual state the grids can
-- render: each availability colour class, a needs-review row, a broker, a
-- multi-listing (cross-listed) number, an unenriched-but-enrichable call, a record
-- with no phone (unselectable checkbox), and assignments in open/done/dropped.

-- RESTART IDENTITY so bolna_assignments ids are deterministic (1..5 in the order
-- inserted below). Without it the sequence keeps climbing across reseeds and any
-- test that addresses an assignment by id passes once and then fails.
-- Reset all app-owned fixture roots, including durable batches and dispatch
-- state. Otherwise a prior volume/integration run changes browser pagination.
truncate bolna_ai_attempts, bolna_assignments, bolna_app_users,
  bolna_assignment_batches, bolna_webhook_events, bolna_dispatch_requests,
  call_batches, bolna_call_logs,
  raw_phones, raw_phone_numbers, raw_records restart identity cascade;

-- These rows ARE the access list: the app no longer reads ALLOWED_EMAILS.
-- bootstrap@eval.test is intentionally absent — it sits in ADMIN_EMAILS so the
-- bootstrap path can be tested (08-db-gate).
insert into bolna_app_users (email, name, role, active) values
  ('admin@eval.test',  'Eval Admin', 'admin',    true),
  ('priya@eval.test',  'Priya Eval', 'employee', true),
  ('raj@eval.test',    'Raj Eval',   'employee', true),
  ('gone@eval.test',   'Left Co',    'employee', false);

-- ---- listings -------------------------------------------------------------
insert into raw_records (id, source, source_record_id, owner_name, owner_first_name,
                         warehouse_type, listing_status, area_sqft, address, city, state,
                         contact_type, metadata) values
 ('a0000000-0000-4000-8000-000000000001','alpha','A-1','Raghav Sharma','Raghav','Warehouse','active',
  12000,'Plot 14, GIDC Estate','Rajkot','Gujarat',null,'{"rent":"45000","email":"raghav@example.com","pincode":"360003"}'),
 ('a0000000-0000-4000-8000-000000000002','alpha','A-2','Meera Nair','Meera','Godown','active',
  8000,'Sector 3, Bawana','Delhi','Delhi',null,'{"rent":"60000","email":"meera@example.com"}'),
 ('a0000000-0000-4000-8000-000000000003','beta','B-1','Suresh Kumar','Suresh','Cold Storage','active',
  25000,'NH-8 Service Road','Hyderabad','Telangana','probable broker','{"rent":"120000"}'),
 ('a0000000-0000-4000-8000-000000000004','beta','B-2','Anil Broker','Anil','Warehouse','active',
  5000,'Hoskote Industrial Area','Bengaluru','Karnataka','probable broker','{}'),
 ('a0000000-0000-4000-8000-000000000005','gamma','G-1','Latha Menon','Latha','Warehouse','active',
  3000,'Kalamassery','Kochi','Kerala',null,'{"rent":"22000"}'),
 -- no phone at all -> its row checkbox must render disabled
 ('a0000000-0000-4000-8000-000000000006','gamma','G-2','No Phone Owner','NoPhone','Shed','active',
  1500,'Unknown','Rajkot','Gujarat',null,'{}');

-- ---- phone dimension ------------------------------------------------------
insert into raw_phone_numbers (phone_last10, phone) values
 ('9811100001','+919811100001'),
 ('9811100002','+919811100002'),
 ('9811100003','+919811100003'),   -- broker number, cross-listed below
 ('9811100005','+919811100005');

insert into raw_phones (master_id, phone_id, is_primary)
select r.id, p.phone_id, true from raw_records r join raw_phone_numbers p on true
 where (r.source_record_id, p.phone_last10) in
   (('A-1','9811100001'),('A-2','9811100002'),('B-1','9811100003'),
    ('B-2','9811100003'),  -- same number on two listings -> raw_match_count = 2
    ('G-1','9811100005'));

-- ---- AI calls -------------------------------------------------------------
-- total_cost must exceed INFERENCE_MIN_COST_CENTS (0.04) to count as "enrichable".
insert into bolna_call_logs
 (id, agent_id, status, call_type, from_number, to_number, duration_secs, total_cost,
  transcript, llm_availability, built_up_area_sqft, expected_rent, confidence, notes,
  needs_review, enriched, inference_version, call_created_at, phone_id, recording_url,
  context_details)
select v.id::uuid, 'b0000000-0000-4000-8000-00000000000a'::uuid, v.status, 'outbound',
       '+918000000000', p.phone, v.dur, v.cost, v.tr, v.avail, v.sqft, v.rent, v.conf,
       v.notes, v.review, v.enriched, 2, v.created::timestamptz, p.phone_id, v.rec,
       jsonb_build_object('recipient_data', jsonb_build_object('name', v.oname, 'area', v.area))
from (values
 ('c0000000-0000-4000-8000-000000000001','completed',        95, 1.20,'haan ji available hai','Available','12000','45000 per month','High','Owner confirmed 12000 sqft available',false,true,'2026-08-01 10:00+00','9811100001','https://rec.example/1.mp3','Raghav Sharma','rajkot'),
 ('c0000000-0000-4000-8000-000000000002','completed',        60, 0.80,'nahi rent ho gaya','Unavailable','','','High','Already rented out',false,true,'2026-08-02 11:00+00','9811100002',null,'Meera Nair','delhi'),
 ('c0000000-0000-4000-8000-000000000003','call-disconnected',20, 0.30,'hello hello','Unclear','','','Low','Only greeting before drop',true,true,'2026-08-03 12:00+00','9811100003','https://rec.example/3.mp3','Suresh Kumar','hyderabad'),
 ('c0000000-0000-4000-8000-000000000004','no-answer',         0, 0.00,'',null,'','',null,null,false,false,'2026-08-04 13:00+00','9811100005',null,'Latha Menon','kochi'),
 -- connected + costed + has transcript + not enriched -> the "Infer" button path
 ('c0000000-0000-4000-8000-000000000005','completed',        45, 0.55,'thoda baad mein baat karein',null,'','',null,null,false,false,'2026-08-05 14:00+00','9811100001',null,'Raghav Sharma','rajkot')
) as v(id,status,dur,cost,tr,avail,sqft,rent,conf,notes,review,enriched,created,last10,rec,oname,area)
join raw_phone_numbers p on p.phone_last10 = v.last10;

-- These retained legacy rows intentionally predate mandatory attempt logging.
alter table bolna_assignments disable trigger bolna_assignment_quality_guard;
-- ---- assignments ----------------------------------------------------------
-- open record for priya (with an admin note), a done one, a dropped one (must be
-- invisible to her), one owned by raj, and one call assigned to priya.
insert into bolna_assignments (entity_type, entity_id, assignee, assigned_by, note, state, outcome, remarks, attempts, wh_id) values
 ('record','a0000000-0000-4000-8000-000000000001','priya@eval.test','admin@eval.test','verify area + rent','open',   null,null,0,null),
 ('record','a0000000-0000-4000-8000-000000000002','priya@eval.test','admin@eval.test',null,               'done',  'Available','confirmed 8000 sqft',2,'1008'),
 ('record','a0000000-0000-4000-8000-000000000005','priya@eval.test','admin@eval.test',null,               'dropped',null,null,0,null),
 ('record','a0000000-0000-4000-8000-000000000003','raj@eval.test',  'admin@eval.test',null,               'open',   null,null,1,null),
 ('call',  'c0000000-0000-4000-8000-000000000001','priya@eval.test','admin@eval.test','follow up on rent','open',   null,null,0,null);

alter table bolna_assignments enable trigger bolna_assignment_quality_guard;
