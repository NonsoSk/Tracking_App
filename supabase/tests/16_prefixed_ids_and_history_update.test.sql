-- Tracking IDs by community type (HC/PC/IC/JC, GC when no community) and updating the history from a newer workbook.
begin;
set search_path = public, extensions, tests;
select plan(19);

-- ---- IDs for new grievances
create temp table n as
  select c, (app.create_grievance(jsonb_build_object('community_id', tests.community(c), 'description', 'Test grievance from ' || c),
                                  'paper', null, null)).tracking_id as tid
  from unnest(array['Aleto', 'Ipo', 'Alesa', 'Onne', 'Aleto']) with ordinality as u(c, i) order by i;
select matches((select tid from n where c = 'Ipo'), '^PC-\d{4}-\d{4}$', 'a Pipeline community grievance gets a PC- ID');
select matches((select tid from n where c = 'Alesa'), '^IC-\d{4}-\d{4}$', 'an Indirectly impacted community grievance gets an IC- ID');
select matches((select tid from n where c = 'Onne'), '^JC-\d{4}-\d{4}$', 'a Jetty community grievance gets a JC- ID');
select is((select count(distinct tid)::int from n where c = 'Aleto'), 2, 'two Host grievances get different IDs');
select ok((select bool_and(tid ~ '^HC-\d{4}-\d{4}$') from n where c = 'Aleto'), '... both HC-');
select is((select array_agg(right(tid, 4) order by tid) from n where c = 'Aleto'), array['0001','0002'], 'numbered per prefix, from 0001');
select is(app.issue_tracking_id(null, 2021), 'GC-2021-0001', 'no community type -> GC-');

-- ---- a first import (the earlier files) ...
select app.import_legacy_batch('{"file_name":"old.xlsx","file_sha256":"old1","workbook":"Old"}', $json$[
 {"key":"B:10","workbook":"Tracker","sheet":"Grievance Tracker","row":10,"serial":"1","role":"primary","flags":[],"raw":{"S/N":"1"},
  "fields":{"source_year":2026,"community":"Ipo","date_received":"2026-03-02","name":"Ada Obi","description":"Our farm road is blocked",
            "status":"Not Started","closure_officer":"Godpower Jaka"}},
 {"key":"B:11","workbook":"Tracker","sheet":"Grievance Tracker","row":11,"serial":"2","role":"primary","flags":[],"raw":{"S/N":"2"},
  "fields":{"source_year":2026,"community":"Aleto","date_received":"2026-03-03","name":"Ben Isra","description":"No water at the school",
            "status":"Ongoing","closure_officer":"Godpower Jaka"}},
 {"key":"B:12","workbook":"Tracker","sheet":"Grievance Tracker","row":12,"serial":"3","role":"primary","flags":[],"raw":{"S/N":"3"},
  "fields":{"source_year":2021,"community":"Individual","date_received":"2021-05-01","description":"Personal request","status":"Closed"}}
]$json$);
select matches((select tracking_id from grievances where complainant_name = 'Ada Obi'), '^PC-2026-\d{4}$', 'imported Pipeline row gets PC-2026-');
select matches((select tracking_id from grievances where description = 'Personal request'), '^GC-2021-\d{4}$', 'imported row with no community gets GC- in the year received');

-- ... then an officer resolves one of them in the app.
update grievances set status_id = app.status_id('RESOLVED') where complainant_name = 'Ben Isra';

-- ---- the newer workbook: same rows, some changed
create temp table upd as select app.import_or_update_legacy('{"file_name":"total.xlsx","file_sha256":"new1","workbook":"Total"}', $json$[
 {"key":"B:10","workbook":"Total","sheet":"2026","row":10,"serial":"1","role":"primary","flags":[],"raw":{"S/N":"1"},
  "prev":{"workbook":"Tracker","sheet":"Grievance Tracker","row":10},
  "fields":{"source_year":2026,"community":"Ipo","date_received":"2026-03-02","name":"Ada Obi","description":"Our farm road is blocked",
            "status":"Resolved","resolution_details":"The road was graded.","closure_officer":"Godpower Jaka"},
  "changes":[{"field":"status","old":"Not Started","new":"Resolved","closure_officer":"Godpower Jaka","old_closure_officer":"Godpower Jaka"},
             {"field":"resolution_details","old":null,"new":"The road was graded.","closure_officer":"Godpower Jaka"}]},
 {"key":"B:11","workbook":"Total","sheet":"2026","row":11,"serial":"2","role":"primary","flags":[],"raw":{"S/N":"2"},
  "prev":{"workbook":"Tracker","sheet":"Grievance Tracker","row":11},
  "fields":{"source_year":2026,"community":"Aleto","date_received":"2026-03-03","name":"Ben Israel","description":"No water at the school",
            "status":"Closed","closure_officer":"Godpower Jaka"},
  "changes":[{"field":"status","old":"Ongoing","new":"Closed","closure_officer":"Godpower Jaka","old_closure_officer":"Godpower Jaka"},
             {"field":"name","old":"Ben Isra","new":"Ben Israel"}]},
 {"key":"B:12","workbook":"Total","sheet":"2026","row":12,"serial":"3","role":"primary","flags":[],"raw":{"S/N":"3"},
  "prev":{"workbook":"Tracker","sheet":"Grievance Tracker","row":12},
  "fields":{"source_year":2021,"community":"Individual","date_received":"2021-05-01","description":"Personal request","status":"Closed"}}
]$json$) as r;

select is((select (r ->> 'changes_applied')::int from upd), 3, 'three changes applied');
select is(app.status_code((select status_id from grievances where complainant_name = 'Ada Obi')), 'RESOLVED',
  'a status changed in the workbook is applied when the app still has the old one');
select is((select details from grievance_resolutions r join grievances g on g.id = r.grievance_id
           where g.complainant_name = 'Ada Obi' and r.is_current), 'The road was graded.', 'the new resolution is recorded as current');
select ok(exists (select 1 from grievance_status_history h join grievances g on g.id = h.grievance_id
                  where g.complainant_name = 'Ada Obi' and h.note like 'Updated from%'), 'the change appears in the history');
select is(app.status_code((select status_id from grievances where complainant_name = 'Ben Israel')), 'RESOLVED',
  'a status changed in the app since the import is NOT overwritten');
select ok(exists (select 1 from grievance_flags f join grievances g on g.id = f.grievance_id
                  where g.complainant_name = 'Ben Israel' and f.flag = 'needs_review' and f.detail ->> 'field' = 'status'),
  '... it is flagged for an officer to review instead');
select is((select count(*)::int from grievances where complainant_name = 'Ben Israel'), 1, 'the corrected name is applied');
select is((select count(*)::int from grievances where is_legacy), 3, 'no grievance is added twice');
select is((select count(*)::int from legacy_source_records where batch_id = (select (r ->> 'batch_id')::uuid from upd)), 3,
  'every row of the new workbook is kept as a source record');

select throws_ok($$select app.import_or_update_legacy('{"file_name":"x","file_sha256":"new2","workbook":"Total"}',
  '[{"key":"B:99","workbook":"Total","sheet":"2026","row":99,"role":"primary","prev":{"workbook":"Tracker","sheet":"Grievance Tracker","row":99},"fields":{}}]')$$,
  'P0001', null, 'a row that was not imported before stops the update (nothing is changed)');

select * from finish();
rollback;
