-- Officer workflow: status changes, resolution, acknowledgement, corrections, deletion, audit.
begin;
set search_path = public, extensions, tests;
select plan(29);

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;
insert into ids values
  ('member',  tests.create_user('Emmanuel Nwala', 'Agbonchia')),
  ('officer', tests.create_user('Godpower Jaka', null, array['officer'])),
  ('admin',   tests.create_user('Super Admin', null, array['super_admin']));
select tests.set_scopes((select v from ids where k = 'officer'), '[{"community_type":"HOST"},{"community_type":"PIPELINE"}]');
select tests.open_code('Agbonchia') as code \gset

select tests.login((select v from ids where k = 'member'));
select (public.submit_grievance(jsonb_build_object('client_submission_id', gen_random_uuid(), 'submission_code', :'code',
        'community_id', tests.community('Agbonchia'), 'description', 'No employment for our youths this year.')) ->> 'id') as gid \gset
select tests.logout();

-- ---- status workflow ------------------------------------------------------------------------
select tests.login((select v from ids where k = 'officer'));
select throws_ok(format($$select public.change_grievance_status(%L, 'CLOSED')$$, :'gid'),
  '22023', 'transition_not_allowed', 'cannot jump from Submitted straight to Closed');
select throws_ok(format($$select public.change_grievance_status(%L, 'RESOLVED')$$, :'gid'),
  '22023', 'use_resolve_grievance', 'Resolved can only be reached by recording a resolution');
select lives_ok(format($$select public.change_grievance_status(%L, 'UNDER_REVIEW', 'Reviewing with HR')$$, :'gid'), 'Submitted -> Under Review');
select lives_ok(format($$select public.change_grievance_status(%L, 'IN_PROGRESS')$$, :'gid'), 'Under Review -> In Progress');
select lives_ok(format($$select public.add_grievance_comment(%L, 'Called the PAC chairman', 'internal')$$, :'gid'), 'internal remark');
select lives_ok(format($$select public.add_grievance_action(%L, 'Shared the vacancy list with the community', 'management_action')$$, :'gid'),
  'management action recorded');
select lives_ok(format($$select public.update_grievance_triage(%L, jsonb_build_object('subcategory_id',
  (select id from public.grievance_subcategories where name = 'Unemployment and Scarcity of Job Opportunities'),
  'severity_id', (select id from public.severities where code = 'HIGH')))$$, :'gid'), 'officer triages category and severity');
select throws_ok(format($$select public.resolve_grievance(%L, 'ok')$$, :'gid'),
  '22023', 'resolution_details_required', 'a resolution needs real details');
select lives_ok(format($$select public.resolve_grievance(%L, 'Five youths from Agbonchia were shortlisted for the October intake.')$$, :'gid'),
  'officer resolves the grievance');
select tests.logout();

select is((select category_id from public.grievances where id = :'gid'),
          (select id from public.grievance_categories where name = 'Employment & Economic Inclusion'),
          'category is derived from the chosen sub-category');
select is((select s.code || '/' || g.ack_state from public.grievances g join public.grievance_statuses s on s.id = g.status_id
           where g.id = :'gid'), 'RESOLVED/pending', 'resolved and awaiting the complainant''s acknowledgement');
select ok((select first_response_at is not null from public.grievances where id = :'gid'), 'first response time recorded');
select is((select count(*)::int from public.notifications where grievance_id = :'gid' and type = 'grievance_resolved'
             and user_id = (select v from ids where k = 'member')), 1, 'complainant is notified of the resolution in-app');

-- ---- complainant view -----------------------------------------------------------------------
select tests.login((select v from ids where k = 'member'));
create temp table d as select public.my_grievance_detail(:'gid') as j;
select is((select j ->> 'status_label' from d), 'Resolved', 'complainant sees the plain status');
select is((select jsonb_agg(e ->> 'label') from d, jsonb_array_elements(j -> 'timeline') e),
          '["Received", "Under review", "In progress", "Resolved"]'::jsonb,
          'timeline uses public labels and collapses internal stages');
select ok((select j -> 'resolution' ->> 'details' like 'Five youths%' from d), 'complainant sees the resolution details');
select ok((select j::text not like '%PAC chairman%' from d), 'internal remarks never reach the complainant');
select throws_ok(format($$select public.acknowledge_resolution(%L, 'disputed')$$, :'gid'),
  '22023', 'reason_required', 'a dispute needs a short reason');
select lives_ok(format($$select public.acknowledge_resolution(%L, 'disputed', 'Nobody from my street was shortlisted')$$, :'gid'),
  'complainant disputes the resolution');
select tests.logout();

select is((select s.code || '/' || g.ack_state from public.grievances g join public.grievance_statuses s on s.id = g.status_id
           where g.id = :'gid'), 'REOPENED/disputed', 'a dispute reopens the grievance (resolved never implies agreement)');
select is((select count(*)::int from public.notifications where grievance_id = :'gid' and type = 'grievance_disputed'), 1,
  'officer is alerted about the dispute');

-- ---- second round, acknowledged, closed ----------------------------------------------------
select tests.login((select v from ids where k = 'officer'));
select public.change_grievance_status(:'gid', 'IN_PROGRESS');
select public.resolve_grievance(:'gid', 'Two more youths from the street were added to the shortlist.');
select tests.logout();
select tests.login((select v from ids where k = 'member'));
select public.acknowledge_resolution(:'gid', 'acknowledged');
select tests.logout();
select tests.login((select v from ids where k = 'officer'));
select lives_ok(format($$select public.change_grievance_status(%L, 'CLOSED', 'Complainant satisfied')$$, :'gid'), 'officer closes');
select tests.logout();
select is((select closure_officer_id from public.grievances where id = :'gid'), (select v from ids where k = 'officer'),
  'closure officer and date recorded');

-- ---- original text protection ------------------------------------------------------------
select throws_ok(format($$update public.grievances set description = 'rewritten' where id = %L$$, :'gid'),
  '42501', 'original_text_is_protected', 'even a direct database update cannot silently change the complainant''s words');
select tests.login((select v from ids where k = 'admin'));
select lives_ok(format($$select public.amend_grievance_text(%L, 'description', 'No employment for our youths in 2026.', 'typo fix requested by complainant')$$, :'gid'),
  'Super Admin can correct text with a reason');
select tests.logout();
select ok(exists (select 1 from public.audit_logs where action = 'grievance.text_amended' and entity_id = :'gid'
                  and old_value ->> 'description' = 'No employment for our youths this year.'),
  'the correction is audited with the old value');

-- ---- deletion ------------------------------------------------------------------------------
select tests.login((select v from ids where k = 'admin'));
select throws_ok(format($$select public.hard_delete_grievance(%L, 'x')$$, :'gid'), '22023', 'archive_first',
  'permanent deletion requires archiving first');
select public.archive_grievance(:'gid', 'test record');
select throws_ok(format($$select public.hard_delete_grievance(%L, 'WRONG-ID')$$, :'gid'), '22023', 'confirmation_mismatch',
  'permanent deletion requires typing the tracking ID');
select tests.logout();

select ok((select count(distinct action) from public.audit_logs where entity_id = :'gid') >= 8,
  'the audit trail records the grievance''s life (created, status, remarks, resolution, acknowledgement, ...)');

select * from finish();
rollback;
