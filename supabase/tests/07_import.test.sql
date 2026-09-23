-- Historical import: standardise without rewriting history. Synthetic rows only (no real PII).
begin;
set search_path = public, extensions, tests;
select plan(19);

select tests.create_user('Godpower Jaka', null, array['officer']) as officer \gset
select tests.set_scopes(:'officer', '[{"community_type":"HOST"},{"community_type":"PIPELINE"}]');

select app.import_legacy_batch(
  '{"file_name":"test.xlsx","file_sha256":"abc123","workbook":"Test"}',
  $json$[
   {"key":"A:2019:10","workbook":"Complete","sheet":"2019","row":10,"serial":"1","role":"primary","flags":[],
    "raw":{"S/N":"1","Community":"Wakohu Family","Log Date":"Apr 2019","Grievance Category":"CSR Project","Status":"Closed"},
    "fields":{"source_year":2019,"community":"Wakohu Family","date_received":"2019-04-01","date_received_precision":"month",
              "review_date":"2019-05-01","review_date_precision":"month","description":"We need our CSR project completed",
              "category":"CSR Project","status":"Closed","officer_remarks":"Noted, passed to PAC","management_action":"Project approved",
              "responsibility":"CR&D"}},
   {"key":"B:100","workbook":"Tracker","sheet":"Grievance Tracker","row":100,"serial":"99","role":"primary","flags":[],
    "raw":{"Tracking ID":"IFL2026 1111F","Community":"Umuecheme","Community Category":"Cluster 5"},
    "fields":{"source_year":2026,"legacy_tracking_id":"IFL2026 1111F","community":"Umuecheme","community_category":"Cluster 5",
              "date_received":"2026-05-20","name":"Test Person","phone":"0803 000 0000","gender":"Male",
              "description":"Road to the farm is blocked","subcategory":"Poor Road Infrastructure and Commuting Difficulties",
              "category":"Infrastructure & Public Services","severity":"High ","status":"Not Started","closure_officer":"Godpower Jaka"}},
   {"key":"A:2025:9","workbook":"Complete","sheet":"2025","row":9,"serial":"1","role":"overlap_copy","link_key":"B:100",
    "raw":{"Tracking ID":"IFL20261111F","Status":"Closed"},"fields":{}},
   {"key":"B:3","workbook":"Tracker","sheet":"Grievance Tracker","row":3,"serial":"2","role":"excluded_duplicate","link_key":"B:100",
    "note":"Exact double entry","raw":{"Tracking ID":"IFL20261111F"},"fields":{}},
   {"key":"A:2021:5","workbook":"Complete","sheet":"2021","row":5,"serial":"4","role":"primary","flags":[],
    "raw":{"Status":"WIP"},
    "fields":{"source_year":2021,"community":"Njuru/Akpakpan","date_received":"2021-02-01","date_received_precision":"month",
              "description":"Skill acquisition should resume","category":"SKill Acquisition","status":"WIP","needs_review":true}}
  ]$json$) as result \gset

create temp view imp as
select g.*, s.code as status_code, c.name as community_name, ct.code as type_code, cl.name as cluster_name,
       cat.name as category_name, sev.code as severity_code
from public.grievances g
join public.grievance_statuses s on s.id = g.status_id
left join public.communities c on c.id = g.community_id
left join public.community_types ct on ct.id = g.community_type_id
left join public.clusters cl on cl.id = g.cluster_id
left join public.grievance_categories cat on cat.id = g.category_id
left join public.severities sev on sev.id = g.severity_id
where g.is_legacy;

select is((:'result'::jsonb ->> 'imported')::int, 3, 'three primary rows become grievances');
select is((select count(*)::int from public.legacy_source_records), 5, 'every source row is kept, including copies and duplicates');

-- 2019 row: alias, legacy category, month precision
select is((select community_name from imp where source_sheet = '2019'), 'Nwakohu', '"Wakohu Family" -> Nwakohu');
select is((select legacy_community from imp where source_sheet = '2019'), 'Wakohu Family', '... original value preserved');
select is((select category_name from imp where source_sheet = '2019'),
          'Corporate Social Responsibility (CSR) & Community Engagement', '"CSR Project" -> standard CSR category');
select is((select legacy_category from imp where source_sheet = '2019'), 'CSR Project', '... original category preserved');
select is((select date_received_precision from imp where source_sheet = '2019'), 'month', '"Apr 2019" keeps month precision');
select matches((select tracking_id from imp where source_sheet = '2019'), '^IPL-GRV-2019-H[0-9]{5}$', 'historical tracking ID IPL-GRV-2019-Hnnnnn');
select is((select status_code || '/' || ack_state from imp where source_sheet = '2019'), 'CLOSED/not_captured',
  'closed, with acknowledgement marked "not captured" (not assumed)');
select is((select count(*)::int from public.grievance_comments c join imp on imp.id = c.grievance_id where imp.source_sheet = '2019'
           and c.kind = 'officer_remark' and c.visibility = 'internal'), 1, 'officer remarks kept as internal remarks');

-- Tracker row: classification is derived, not copied from the spreadsheet
select is((select cluster_name from imp where source_row = 100), 'Cluster 2',
  'Umuecheme is classified Cluster 2 from the master (spreadsheet said Cluster 5)');
select is((select legacy_community_category from imp where source_row = 100), 'Cluster 5', '... and the spreadsheet value is preserved');
select is((select status_code || '/' || severity_code from imp where source_row = 100), 'ASSIGNED/HIGH',
  '"Not Started" with an officer -> Assigned; "High " -> High');
select is((select complainant_phone from imp where source_row = 100), '+2348030000000', 'phone normalised');
select is((select assigned_officer_id from imp where source_row = 100), :'officer'::uuid, 'open item goes to the responsible officer');
select is((select legacy_tracking_id_norm from imp where source_row = 100), 'IFL20261111F', 'legacy ID searchable without spaces');

-- WIP from 2021: open but held for review (no alert flood)
select ok((select legacy_needs_review from imp where source_sheet = '2021'), 'old WIP item is held for officer review');

select throws_ok($$select app.import_legacy_batch('{"file_name":"test.xlsx","file_sha256":"abc123","workbook":"Test"}', '[]')$$,
  '23505', 'file_already_imported', 'the same file cannot be imported twice');

-- Batched overdue alerts: many overdue items -> one summary per officer
select app.create_grievance(jsonb_build_object('community_id', tests.community('Aleto'), 'description', 'Overdue item number ' || i),
                            'paper', null, null)
from generate_series(1, 5) i;
update public.grievances set sla_started_at = now() - interval '20 days' where not is_legacy;
update public.grievances set legacy_needs_review = true where is_legacy;
select app.scan_overdue();
select is((select count(*)::int from public.notifications where type = 'grievance_overdue' and user_id = :'officer'), 1,
  'an officer with five newly overdue grievances gets one summary alert, not five');

select * from finish();
rollback;
