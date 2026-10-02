-- Monthly submission limit and the "latest resolved" sort.
begin;
set search_path = public, extensions, tests;
select plan(11);

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;
insert into ids values
  ('admin',  tests.create_user('Super Admin', null, array['super_admin'])),
  ('member', tests.create_user('Ada Member', 'Agbonchia'));
update settings set value = 'false' where key = 'submission_code_required';

create temp table sent (k text, client uuid, r jsonb);
grant all on sent to authenticated;
create or replace function pg_temp.send(p_k text, p_client uuid default gen_random_uuid()) returns jsonb language sql as $$
  insert into sent values (p_k, p_client, public.submit_grievance(jsonb_build_object('client_submission_id', p_client,
    'community_id', tests.community('Agbonchia'), 'description', 'Concern number ' || p_k)))
  returning r $$;

select tests.login((select v from ids where k = 'member'));
select is(public.get_submission_status() -> 'monthly_left', 'null'::jsonb, 'unlimited by default');
select tests.logout();

select tests.login((select v from ids where k = 'admin'));
select lives_ok($$select public.update_setting('monthly_submission_limit', '2')$$, 'the Super Admin sets 2 a month');
select tests.logout();

select tests.login((select v from ids where k = 'member'));
select is((public.get_submission_status() ->> 'monthly_left')::int, 2, 'the member has 2 left this month');
select is(pg_temp.send('one') ->> 'result', 'created', 'first grievance this month');
select is((pg_temp.send('one again', (select client from sent where k = 'one')) ->> 'result'), 'already_submitted',
  'a retry of the same grievance is not counted again');
select is(pg_temp.send('two') ->> 'result', 'created', 'second grievance this month');
select is((public.get_submission_status() ->> 'monthly_left')::int, 0, 'none left this month');
select throws_ok($$select pg_temp.send('three')$$, '22023', 'monthly_limit', 'a third grievance in the same month is refused');
select tests.logout();

-- Last month's grievances don't count, and unused ones don't carry over.
update grievances set submitted_at = submitted_at - interval '40 days' where complainant_user_id = (select v from ids where k = 'member');
select tests.login((select v from ids where k = 'member'));
select is((public.get_submission_status() ->> 'monthly_left')::int, 2, 'a new month starts again at 2 (nothing carried over)');
select tests.logout();

select tests.login((select v from ids where k = 'admin'));
select lives_ok($$select public.update_setting('monthly_submission_limit', null)$$, 'emptying the setting means unlimited');
select is((public.staff_grievance_list('{}', 1, 5, 'resolved_desc') ->> 'total')::int,
          (select count(*)::int from grievances where archived_at is null), 'the list can be sorted by latest resolved');
select tests.logout();

select * from finish();
rollback;
