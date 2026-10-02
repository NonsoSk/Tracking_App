-- Member replies to staff; submission code optional, shared with everyone, limited per person.
begin;
set search_path = public, extensions, tests;
select plan(19);

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;
insert into ids values
  ('admin',   tests.create_user('Super Admin', null, array['super_admin'])),
  ('officer', tests.create_user('Host Officer', null, array['officer'])),
  ('viewer',  tests.create_user('Agb Leader', 'Agbonchia', array['viewer'])),
  ('member',  tests.create_user('Ada Member', 'Agbonchia')),
  ('other',   tests.create_user('Obi Other', 'Agbonchia'));
select tests.set_scopes((select v from ids where k = 'officer'), '[{"community_type":"HOST"}]');
select tests.set_scopes((select v from ids where k = 'viewer'), '[{"community":"Agbonchia"}]');

-- ---- a code shared with everyone, at most 2 grievances per person
select tests.login((select v from ids where k = 'admin'));
create temp table c as select * from public.create_submission_code(jsonb_build_object(
  'scope_type', 'community', 'community_id', tests.community('Agbonchia'), 'valid_until', now() + interval '2 days',
  'release', true, 'show_to_members', true, 'max_per_person', 2));
grant select on c to authenticated;
select tests.logout();

select tests.login((select v from ids where k = 'member'));
select is(public.get_submission_status() ->> 'code', (select code from c), 'a code shared with everyone is shown to members');
select is((public.get_submission_status() ->> 'uses_left')::int, 2, 'the member sees how many grievances they may still send');
create temp table s as select public.submit_grievance(jsonb_build_object('client_submission_id', gen_random_uuid(),
  'submission_code', (select code from c), 'community_id', tests.community('Agbonchia'), 'description', 'First concern about the road')) as r;
select null from public.submit_grievance(jsonb_build_object('client_submission_id', gen_random_uuid(),
  'submission_code', (select code from c), 'community_id', tests.community('Agbonchia'), 'description', 'Second concern about water'));
select is((public.check_submission_code((select code from c))) ->> 'error', 'code_person_limit', 'the check says the person has used up the code');
select throws_ok(format($$select public.submit_grievance(jsonb_build_object('client_submission_id', gen_random_uuid(),
  'submission_code', %L, 'community_id', %L, 'description', 'Third concern is refused'))$$, (select code from c), tests.community('Agbonchia')),
  '22023', 'code_person_limit', 'a third grievance with the same code is refused');
select tests.logout();

select tests.login((select v from ids where k = 'other'));
select ok((public.check_submission_code((select code from c)) ->> 'ok')::boolean, 'the limit is per person: someone else can still use the code');
select tests.logout();

-- ---- the Super Admin changes the options later
select tests.login((select v from ids where k = 'admin'));
select lives_ok(format($$select public.update_submission_code(%L, '{"max_per_person": 3, "show_to_members": false}')$$, (select id from c)),
  'the Super Admin can change a code''s options');
select is((select (x ->> 'max_per_person')::int from jsonb_array_elements(public.list_submission_codes()) x where x ->> 'code' = (select code from c)), 3,
  'the new limit shows in the list of codes');
select tests.logout();
select tests.login((select v from ids where k = 'member'));
select is(public.get_submission_status() ->> 'code', null, 'a code no longer shared is hidden again');
select ok((public.check_submission_code((select code from c)) ->> 'ok')::boolean, 'with the higher limit the member can send another');
select tests.logout();
select tests.login((select v from ids where k = 'officer'));
select throws_ok(format($$select public.update_submission_code(%L, '{"max_per_person": 9}')$$, (select id from c)), '42501', null,
  'only the Super Admin changes code options');
select tests.logout();

-- ---- codes switched off
update settings set value = 'false' where key = 'submission_code_required';
update submission_codes set status = 'deactivated';
select tests.login((select v from ids where k = 'member'));
select ok((public.get_submission_status() ->> 'open')::boolean, 'with codes switched off, collection shows as open');
select is((public.submit_grievance(jsonb_build_object('client_submission_id', gen_random_uuid(),
  'submission_code', '', 'community_id', tests.community('Agbonchia'), 'description', 'Sent without any code at all'))) ->> 'result',
  'created', 'a member can send a grievance without a code');
select throws_ok(format($$select public.submit_grievance(jsonb_build_object('client_submission_id', gen_random_uuid(),
  'submission_code', 'ZZZ-2026-0101-AAAA', 'community_id', %L, 'description', 'A wrong code typed anyway'))$$, tests.community('Agbonchia')),
  '22023', 'code_invalid', 'a code typed anyway is still checked');
select tests.logout();
update settings set value = 'true' where key = 'submission_code_required';

-- ---- conversation
select tests.login((select v from ids where k = 'officer'));
select null from public.add_grievance_comment((select (r ->> 'id')::uuid from s), 'Can you tell us which road?', 'complainant');
select tests.logout();

select tests.login((select v from ids where k = 'member'));
select lives_ok(format($$select public.reply_to_grievance(%L, 'The road from the market to the school')$$, (select (r ->> 'id')::uuid from s)),
  'the member replies to the officer');
select is((select jsonb_agg(u ->> 'from') from jsonb_array_elements(public.my_grievance_detail((select (r ->> 'id')::uuid from s)) -> 'updates') u),
  '["staff", "me"]'::jsonb, 'the member sees the conversation in order');
select tests.logout();

select ok(exists (select 1 from notifications where user_id = (select v from ids where k = 'officer') and title = 'Reply from the complainant'),
  'the officer in charge is notified of the reply');

select tests.login((select v from ids where k = 'other'));
select throws_ok(format($$select public.reply_to_grievance(%L, 'Not my grievance')$$, (select (r ->> 'id')::uuid from s)), 'P0002', null,
  'nobody can reply on someone else''s grievance');
select tests.logout();

select tests.login((select v from ids where k = 'officer'));
select ok(exists (select 1 from jsonb_array_elements(public.staff_grievance_detail((select (r ->> 'id')::uuid from s)) -> 'history') h
                  where h ->> 'label' = 'reply' and h ->> 'by_name' like 'Ada Member%'), 'the officer sees the reply and who sent it');
select tests.logout();
select tests.login((select v from ids where k = 'viewer'));
select ok(exists (select 1 from jsonb_array_elements(public.staff_grievance_detail((select (r ->> 'id')::uuid from s)) -> 'history') h
                  where h ->> 'label' = 'reply' and h ->> 'by_name' = 'Complainant'), 'a Viewer sees the reply without the complainant''s name');
select tests.logout();

select * from finish();
rollback;
