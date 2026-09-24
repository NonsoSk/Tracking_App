-- Super Admin puts anyone in charge of a community from the app.
begin;
set search_path = public, extensions, tests;
select plan(9);

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;
insert into ids values
  ('admin',    tests.create_user('Super Admin', null, array['super_admin'])),
  ('godpower', tests.create_user('Godpower Jaka', null, array['officer'])),
  ('ada',      tests.create_user('Ada Newstaff', 'Aleto')),            -- signed up as a member
  ('member',   tests.create_user('Plain Member', 'Aleto'));
select tests.set_scopes((select v from ids where k = 'godpower'), '[{"community_type":"HOST"}]');

create temp table g as select (app.create_grievance(jsonb_build_object('community_id', tests.community('Aleto'),
  'description', 'Open Aleto grievance number ' || i), 'paper', null, null)).id from generate_series(1, 2) i;
grant select on g to authenticated;

select tests.login((select v from ids where k = 'member'));
select throws_ok(format('select public.admin_set_community_officer(%L, %L)', tests.community('Aleto'), (select v from ids where k = 'member')),
  '42501', 'not_allowed', 'a member cannot assign community officers');
select tests.logout();

select tests.login((select v from ids where k = 'admin'));
select is((select e ->> 'officer' from jsonb_array_elements(public.list_community_officers()) e where e ->> 'community' = 'Aleto'),
  'Godpower Jaka', 'Aleto is covered by the Host officer before the change');
select is((public.admin_set_community_officer(tests.community('Aleto'), (select v from ids where k = 'ada'), true) ->> 'reassigned')::int, 2,
  'Ada is put in charge of Aleto and its 2 open grievances are handed over');
select is((select e ->> 'officer' || '/' || (e ->> 'via') from jsonb_array_elements(public.list_community_officers()) e where e ->> 'community' = 'Aleto'),
  'Ada Newstaff/community', 'Aleto now shows Ada, at community level');
select is((select e ->> 'officer' from jsonb_array_elements(public.list_community_officers()) e where e ->> 'community' = 'Okerewa'),
  'Godpower Jaka', 'other host communities still go to the Host officer');
select tests.logout();

select ok(app.has_role((select v from ids where k = 'ada'), 'officer'), 'Ada was given the Officer role automatically');
select is((app.create_grievance(jsonb_build_object('community_id', tests.community('Aleto'), 'description', 'New grievance after the change'),
           'paper', null, null)).assigned_officer_id, (select v from ids where k = 'ada'), 'new Aleto grievances are auto-assigned to Ada');

select tests.login((select v from ids where k = 'ada'));
select is((select count(*)::int from public.grievances), 3, 'Ada sees the Aleto grievances (and only those)');
select tests.logout();

select tests.login((select v from ids where k = 'admin'));
select public.admin_clear_community_officer(tests.community('Aleto'));
select is((select e ->> 'officer' from jsonb_array_elements(public.list_community_officers()) e where e ->> 'community' = 'Aleto'),
  'Godpower Jaka', 'clearing falls back to the Host officer');
select tests.logout();

select * from finish();
rollback;
