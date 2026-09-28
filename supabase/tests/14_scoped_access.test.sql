-- Scoped access: codes for my communities, leaders as Viewers, who may resolve, gender breakdown, two roles.
begin;
set search_path = public, extensions, tests;
select plan(17);

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;
insert into ids values
  ('admin',   tests.create_user('Super Admin', null, array['super_admin'])),
  ('officer', tests.create_user('Host Officer', null, array['officer'])),
  ('sup',     tests.create_user('Sam Supervisor', null, array['supervisor'])),
  ('cr',      tests.create_user('Cara CR', null, array['cr_staff'])),
  ('leader',  tests.create_user('Onne Leader', 'Onne', array['viewer', 'community_member'])),
  ('member',  tests.create_user('Ada Member', 'Agbonchia'));
update profiles set gender = 'female' where id = (select v from ids where k = 'member');
select tests.set_scopes((select v from ids where k = 'officer'), '[{"community_type":"HOST"}]');
select tests.set_scopes((select v from ids where k = 'cr'), '[{"community":"Onne"}]');
select tests.open_code('Agbonchia') as agb \gset
select tests.open_code('Onne') as onn \gset

-- A leader is put on their community through the normal admin screen (any staff role, not only officers).
select tests.login((select v from ids where k = 'admin'));
select lives_ok(format('select public.admin_set_officer_scopes(%L, %L)', (select v from ids where k = 'leader'),
                       jsonb_build_array(jsonb_build_object('community_id', tests.community('Onne')))),
  'the Super Admin assigns the Viewer (community leader) to Onne');
select tests.logout();

create temp table g as
  select 'agb' as k, (app.create_grievance(jsonb_build_object('community_id', tests.community('Agbonchia'), 'description', 'Agbonchia road is flooded'),
                      'app', (select v from ids where k = 'member'), null)).id
  union all
  select 'onne', (app.create_grievance(jsonb_build_object('community_id', tests.community('Onne'), 'description', 'Onne jetty trucks block road',
                  'complainant_name', 'Paper Person', 'complainant_gender', 'male'), 'paper', null, null)).id;
grant select on g to authenticated;

-- Codes
select tests.login((select v from ids where k = 'officer'));
select is((select array_agg(code) from submission_codes), array[:'agb']::text[], 'an officer sees the code for their communities only');
select tests.logout();
select tests.login((select v from ids where k = 'leader'));
select is((select array_agg(code) from submission_codes), array[:'onn']::text[], 'the Onne leader sees the Onne code, not other communities''');
select throws_ok($$select public.create_submission_code('{"scope_type":"all","valid_until":"2030-01-01"}')$$, '42501', 'not_allowed', '... and cannot create codes');

-- Grievances and reports for the leader: their community only, no complainant identity
select is((public.staff_grievance_list() ->> 'total')::int, 1, 'the leader lists only Onne grievances');
select is((public.staff_grievance_list() -> 'rows' -> 0 ->> 'complainant_name'), null, '... without the complainant''s name');
select is((public.dashboard_stats() -> 'kpis' ->> 'total')::int, 1, '... and the dashboard counts only Onne');
select throws_ok(format('select public.resolve_grievance(%L, %L)', (select id from g where k = 'onne'), 'Fixed the road completely'),
  '42501', null, 'a Viewer cannot resolve');
-- Two roles: the leader is also a community member and can still use member features
select ok(app.has_perm('grievance.create.self') and app.has_perm('grievance.read.own'), 'with both roles, the leader keeps member features too');
select tests.logout();

-- CR staff: their communities only
select tests.login((select v from ids where k = 'cr'));
select is((public.staff_grievance_list() ->> 'total')::int, 1, 'Community Relations staff see only their communities');
select tests.logout();

-- Who may resolve
select tests.login((select v from ids where k = 'sup'));
select is((public.staff_grievance_list() ->> 'total')::int, 2, 'a Supervisor still sees every community');
select throws_ok(format('select public.resolve_grievance(%L, %L)', (select id from g where k = 'agb'), 'Fixed the road completely'),
  '42501', null, 'a Supervisor cannot resolve');
select tests.logout();
select tests.login((select v from ids where k = 'officer'));
select lives_ok(format('select public.resolve_grievance(%L, %L)', (select id from g where k = 'agb'), 'Drainage cleared and road graded.'),
  'the Officer in charge resolves');
select tests.logout();

-- Gender
select tests.login((select v from ids where k = 'admin'));
select is((select jsonb_agg(x ->> 'key' order by x ->> 'key') from jsonb_array_elements(public.dashboard_gender()) x),
  '["Female", "Male"]'::jsonb, 'grievances are broken down by gender (from the profile, or the paper form)');
select is((select jsonb_array_length(t -> 'officers') from jsonb_array_elements(public.list_responsibilities()) t where t ->> 'code' = 'JETTY'), 0,
  'a Viewer with a community is not listed as a person in charge');
select tests.logout();
select is((select complainant_gender from grievances where id = (select id from g where k = 'agb')), 'female', 'the member''s gender is saved on the grievance');

-- Inviting a leader as Viewer with their community: applied when the login is created
select tests.login((select v from ids where k = 'admin'));
select public.admin_invite_staff(jsonb_build_object('email', 'chief.onne@ipl.test', 'full_name', 'Chief Onne', 'roles', jsonb_build_array('viewer'),
                                                    'scopes', jsonb_build_array(jsonb_build_object('community_id', tests.community('Onne')))));
select tests.logout();
insert into auth.users (email, raw_user_meta_data) values ('chief.onne@ipl.test', '{}');
select is((select count(*)::int from officer_scopes s join auth.users u on u.id = s.officer_id
           where u.email = 'chief.onne@ipl.test' and s.community_id = tests.community('Onne')), 1,
  'an invited leader gets their community as soon as the login exists');

select * from finish();
rollback;
