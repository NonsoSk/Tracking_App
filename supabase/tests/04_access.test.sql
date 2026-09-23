-- Who can see what. Every check here is enforced by the database, not the UI.
begin;
set search_path = public, extensions, tests;
select plan(20);

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;
insert into ids values
  ('alice',   tests.create_user('Alice Member', 'Agbonchia')),
  ('bob',     tests.create_user('Bob Member', 'Onne')),
  ('godpower',tests.create_user('Godpower Jaka', null, array['officer'])),
  ('godwin',  tests.create_user('Godwin Bebe-Okpabi', null, array['officer'])),
  ('esther',  tests.create_user('Esther Walter Anga', null, array['officer'])),
  ('admin',   tests.create_user('Super Admin', null, array['super_admin'])),
  ('clerk',   tests.create_user('Data Clerk', null, array['data_entry'])),
  ('viewer',  tests.create_user('Board Viewer', null, array['viewer']));
select tests.set_scopes((select v from ids where k = 'godpower'), '[{"community_type":"HOST"},{"community_type":"PIPELINE"}]');
select tests.set_scopes((select v from ids where k = 'godwin'),   '[{"community_type":"INDIRECT"}]');
select tests.set_scopes((select v from ids where k = 'esther'),   '[{"community_type":"JETTY"}]');

select tests.open_code('Agbonchia') as agb \gset
select tests.open_code('Onne') as onn \gset

create temp table g (k text primary key, id uuid, tracking text);
grant all on g to authenticated;

select tests.login((select v from ids where k = 'alice'));
insert into g select 'alice', (r ->> 'id')::uuid, r ->> 'tracking_id' from public.submit_grievance(jsonb_build_object(
  'client_submission_id', gen_random_uuid(), 'submission_code', :'agb', 'community_id', tests.community('Agbonchia'),
  'description', 'Alice: our borehole is broken.')) r;
select tests.logout();

select tests.login((select v from ids where k = 'bob'));
insert into g select 'bob', (r ->> 'id')::uuid, r ->> 'tracking_id' from public.submit_grievance(jsonb_build_object(
  'client_submission_id', gen_random_uuid(), 'submission_code', :'onn', 'community_id', tests.community('Onne'),
  'description', 'Bob: jetty trucks damage the road.')) r;
select tests.logout();

select tests.login((select v from ids where k = 'clerk'));
insert into g select 'paper', (r ->> 'id')::uuid, r ->> 'tracking_id' from public.submit_grievance_assisted(jsonb_build_object(
  'complainant_name', 'Paper Person', 'community_id', tests.community('Ogale'),
  'description', 'Paper form: flooding near the pipeline.')) r;
select tests.logout();

-- ---- community members --------------------------------------------------------------
select tests.login((select v from ids where k = 'alice'));
select is(jsonb_array_length(public.my_grievances()), 1, 'Alice sees exactly one grievance: her own');
select is(public.my_grievances() -> 0 ->> 'tracking_id', (select tracking from g where k = 'alice'), '... and it is hers');
select throws_ok(format('select public.my_grievance_detail(%L)', (select id from g where k = 'bob')),
  'P0002', 'not_found', 'Alice cannot open Bob''s grievance by id (manipulated request)');
select is(public.find_my_grievance((select tracking from g where k = 'bob')), null,
  'Alice cannot look up Bob''s grievance by tracking ID');
select is_empty('select * from public.grievances', 'members have no direct table access to grievances');
select throws_ok(format($$select public.acknowledge_resolution(%L, 'acknowledged')$$, (select id from g where k = 'bob')),
  'P0002', 'not_found', 'Alice cannot acknowledge Bob''s grievance');
select throws_ok(format($$select public.change_grievance_status(%L, 'CLOSED')$$, (select id from g where k = 'alice')),
  '42501', 'not_allowed', 'members cannot change status, even on their own grievance');
select ok(public.my_grievance_detail((select id from g where k = 'alice')) ? 'timeline', 'Alice can open her own grievance');
select ok(not (public.my_grievance_detail((select id from g where k = 'alice')) ? 'assigned_officer_id'),
  'complainant view does not expose officer assignment');
select tests.logout();

-- ---- officers ---------------------------------------------------------------------------
select tests.login((select v from ids where k = 'godpower'));
select results_eq('select tracking_id from public.grievances order by tracking_id',
  $$select tracking from g where k = 'alice'$$, 'Host/Pipeline officer sees only Host/Pipeline grievances');
select throws_ok(format($$select public.add_grievance_comment(%L, 'peeking')$$, (select id from g where k = 'bob')),
  'P0002', 'not_found', 'Host/Pipeline officer cannot act on a Jetty grievance');
select tests.logout();

select tests.login((select v from ids where k = 'esther'));
select results_eq('select tracking_id from public.grievances', $$select tracking from g where k = 'bob'$$,
  'Jetty officer sees only Jetty grievances');
select tests.logout();

select tests.login((select v from ids where k = 'godwin'));
select results_eq('select tracking_id from public.grievances', $$select tracking from g where k = 'paper'$$,
  'Indirectly-impacted officer sees only indirectly-impacted grievances');
select tests.logout();

-- ---- explicit assignment outside scope --------------------------------------------------
select tests.login((select v from ids where k = 'admin'));
select public.assign_grievance((select id from g where k = 'bob'), (select v from ids where k = 'godpower'), 'cover while on leave');
select is((select count(*)::int from public.grievances), 3, 'Super Admin sees every grievance');
select tests.logout();

select tests.login((select v from ids where k = 'godpower'));
select is((select count(*)::int from public.grievances), 2, 'an officer also sees grievances explicitly assigned to them');
select tests.logout();

-- ---- other roles -------------------------------------------------------------------------
select tests.login((select v from ids where k = 'clerk'));
select results_eq('select tracking_id from public.grievances', $$select tracking from g where k = 'paper'$$,
  'data entry sees only what they entered');
select tests.logout();

select tests.login((select v from ids where k = 'viewer'));
select is_empty('select * from public.grievances', 'viewer role has no access to individual records');
select tests.logout();

-- ---- archive -----------------------------------------------------------------------------
select tests.login((select v from ids where k = 'admin'));
select public.archive_grievance((select id from g where k = 'alice'), 'test');
select is((select count(*)::int from public.grievances), 3, 'Super Admin still sees archived records');
select tests.logout();

select tests.login((select v from ids where k = 'godpower'));
select is((select count(*)::int from public.grievances where id = (select id from g where k = 'alice')), 0,
  'archived grievances are hidden from officers');
select tests.logout();

select tests.login((select v from ids where k = 'alice'));
select is(jsonb_array_length(public.my_grievances()), 0, 'archived grievances are hidden from the complainant');
select tests.logout();

select * from finish();
rollback;
