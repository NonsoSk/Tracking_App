-- Several people in charge of a whole community type, cluster or community.
begin;
set search_path = public, extensions, tests;
select plan(13);

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;
insert into ids values
  ('admin', tests.create_user('Super Admin', null, array['super_admin'])),
  ('amaka', tests.create_user('Amaka Host', 'Aleto')),                    -- a member, not yet an officer
  ('bola',  tests.create_user('Bola Host', null, array['officer'])),
  ('pipe',  tests.create_user('Pat Pipeline', null, array['officer'])),
  ('cee',   tests.create_user('Chidi Community', null, array['officer'])),
  ('member', tests.create_user('Plain Member', 'Aleto'));
create function pg_temp.id(text) returns uuid language sql as $$ select v from ids where k = $1 $$;
create function pg_temp.new_g(p_comm text, p_text text) returns uuid language sql as $$
  select (app.create_grievance(jsonb_build_object('community_id', tests.community(p_comm), 'description', p_text), 'paper', null, null)).id $$;

-- One Host grievance arrives while nobody is in charge of Host.
create temp table g0 as select pg_temp.new_g('Aleto', 'Host grievance before anyone is in charge') as id;
select is((select assigned_officer_id from grievances where id = (select id from g0)), null, 'with nobody in charge the grievance waits unassigned');

select tests.login(pg_temp.id('member'));
select throws_ok(format('select public.admin_add_responsibility(%L, %L)', pg_temp.id('member'), '{"community_type":"HOST"}'),
  '42501', 'not_allowed', 'a member cannot put people in charge');
select tests.logout();

select tests.login(pg_temp.id('admin'));
select is(public.admin_add_responsibility(pg_temp.id('amaka'), '{"community_type":"HOST"}'),
  '{"label": "all Host communities", "picked_up": 1}'::jsonb, 'Amaka is put in charge of all Host communities and picks up the waiting grievance');
select public.admin_add_responsibility(pg_temp.id('bola'), '{"community_type":"HOST"}');
select is((select jsonb_array_length(t -> 'officers') from jsonb_array_elements(public.list_responsibilities()) t where t ->> 'code' = 'HOST'), 2,
  'Host now has two people in charge');
select tests.logout();

select ok(app.has_role(pg_temp.id('amaka'), 'officer'), 'Amaka was given the Officer role automatically');

-- New grievances are shared out: Bola (0 open) gets the next one.
create temp table g1 as select pg_temp.new_g('Okerewa', 'Second host grievance') as id;
select is((select assigned_officer_id from grievances where id = (select id from g1)), pg_temp.id('bola'), 'the next grievance goes to whoever has fewer open');

select tests.login(pg_temp.id('bola'));
select is((select count(*)::int from grievances), 2, 'Bola sees every Host grievance, including ones assigned to Amaka');
select tests.logout();

-- Removing Amaka hands her open grievance to Bola.
select tests.login(pg_temp.id('admin'));
select is(public.admin_remove_responsibility(pg_temp.id('amaka'), '{"community_type":"HOST"}') ->> 'handed_over', '1',
  'removing Amaka hands her open grievance over');
select tests.logout();
select is((select assigned_officer_id from grievances where id = (select id from g0)), pg_temp.id('bola'), '...to Bola, still in charge of Host');
select tests.login(pg_temp.id('amaka'));
select is((select count(*)::int from grievances), 0, 'Amaka no longer sees Host grievances');
select tests.logout();

-- A pipeline cluster officer also sees Akpajo (Host by default, also Pipeline Cluster 1).
select tests.login(pg_temp.id('admin'));
select public.admin_add_responsibility(pg_temp.id('pipe'), jsonb_build_object('cluster_id',
  (select c.id from clusters c join community_types t on t.id = c.community_type_id where t.code = 'PIPELINE' and c.name = 'Cluster 1')));
select tests.logout();
create temp table g2 as select pg_temp.new_g('Akpajo', 'Akpajo grievance') as id;
grant select on g2 to authenticated;
select tests.login(pg_temp.id('pipe'));
select is((select count(*)::int from grievances where id = (select id from g2)), 1, 'the Pipeline Cluster 1 officer sees Akpajo grievances');
select tests.logout();

-- Adding a community-level person no longer removes the others.
select tests.login(pg_temp.id('admin'));
select public.admin_set_community_officer(tests.community('Aleto'), pg_temp.id('cee'), false);
select is((select jsonb_agg(o ->> 'name') from jsonb_array_elements(public.list_community_officers()) e, jsonb_array_elements(e -> 'officers') o
           where e ->> 'community' = 'Aleto'), '["Chidi Community", "Bola Host"]'::jsonb,
  'Aleto: Chidi (this community) and Bola (all Host) are both in charge');
select throws_ok(format('select public.admin_remove_responsibility(%L, %L)', pg_temp.id('amaka'), '{"community_type":"HOST"}'),
  'P0002', null, 'removing someone who is not in charge is reported');
select tests.logout();

select * from finish();
rollback;
