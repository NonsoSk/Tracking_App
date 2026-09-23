-- App read API: lists, detail, dashboards, exports respect roles and scope.
begin;
set search_path = public, extensions, tests;
select plan(17);

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated, anon;
insert into ids values
  ('member',  tests.create_user('Ada Member', 'Agbonchia')),
  ('godpower',tests.create_user('Godpower Jaka', null, array['officer'])),
  ('esther',  tests.create_user('Esther Walter Anga', null, array['officer'])),
  ('admin',   tests.create_user('Super Admin', null, array['super_admin'])),
  ('viewer',  tests.create_user('Board Viewer', null, array['viewer']));
select tests.set_scopes((select v from ids where k = 'godpower'), '[{"community_type":"HOST"},{"community_type":"PIPELINE"}]');
select tests.set_scopes((select v from ids where k = 'esther'),   '[{"community_type":"JETTY"}]');

select app.create_grievance(jsonb_build_object('community_id', tests.community(c), 'description', 'Test grievance in ' || c || ' #' || i,
                                               'category_id', (select id from public.grievance_categories order by sort_order limit 1)),
                            'paper', null, null)
from unnest(array['Agbonchia','Egbeda','Onne']) c, generate_series(1, 4) i;   -- 4 host, 4 pipeline, 4 jetty

select tests.login_anon();
select ok(jsonb_array_length(public.get_master_data() -> 'communities') = 48, 'master data is available before sign-in (48 communities)');
select tests.logout();

select tests.login((select v from ids where k = 'godpower'));
select is((public.staff_grievance_list() ->> 'total')::int, 8, 'officer list shows only their scope (host + pipeline)');
select is((public.staff_grievance_list('{"q":"Egbeda"}') ->> 'total')::int, 4, 'search by community name');
select is(jsonb_array_length(public.staff_grievance_list('{}', 2, 5) -> 'rows'), 3, 'pagination (page 2 of 5-per-page = 3 rows)');
select is((public.dashboard_stats() -> 'kpis' ->> 'total')::int, 8, 'officer dashboard is scoped');
select is((public.officer_home() ->> 'new')::int, 8, 'officer home: 8 new grievances assigned');
select tests.logout();

select tests.login((select v from ids where k = 'esther'));
create temp table jd as select (public.staff_grievance_list() -> 'rows' -> 0 ->> 'id')::uuid as id;
select tests.logout();
grant select on jd to authenticated;

select tests.login((select v from ids where k = 'godpower'));
select throws_ok(format('select public.staff_grievance_detail(%L)', (select id from jd)), 'P0002', 'not_found',
  'officer cannot open a grievance outside their scope by id');
select tests.logout();

select tests.login((select v from ids where k = 'esther'));
select ok((public.staff_grievance_detail((select id from jd)) -> 'can' ->> 'resolve')::boolean, 'detail tells the UI which actions are allowed');
select tests.logout();

select tests.login((select v from ids where k = 'viewer'));
select is((public.dashboard_stats() -> 'kpis' ->> 'total')::int, 12, 'viewer sees organisation-wide totals');
select throws_ok('select public.staff_grievance_list()', '42501', 'not_allowed', '... but cannot list individual grievances');
select throws_ok('select public.export_grievances()', '42501', 'not_allowed', '... and cannot export');
select tests.logout();

select tests.login((select v from ids where k = 'admin'));
select is((public.dashboard_stats() -> 'kpis' ->> 'total')::int, 12, 'Super Admin dashboard covers everything');
select is(jsonb_array_length(public.dashboard_stats('{"community_type_id":2}') -> 'by_cluster'), 1,
  'filter by community type: pipeline grievances by cluster');
select is(jsonb_array_length(public.export_grievances('{"q":"Onne"}')), 4, 'export respects filters');
select tests.logout();
select ok(exists (select 1 from public.audit_logs where action = 'export.run'), 'exports are audited');

select tests.login((select v from ids where k = 'member'));
select throws_ok('select public.staff_grievance_list()', '42501', 'not_allowed', 'members cannot use the staff list');
select throws_ok('select public.dashboard_stats()', '42501', 'not_allowed', 'members cannot see dashboards');
select tests.logout();

select * from finish();
rollback;
