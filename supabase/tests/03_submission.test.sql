-- Submission codes, grievance submission, tracking IDs, idempotency.
begin;
set search_path = public, extensions, tests;
select plan(25);

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;
insert into ids values
  ('member',  tests.create_user('Emmanuel Nwala', 'Agbonchia')),
  ('member2', tests.create_user('Grace Okoro', 'Onne')),
  ('officer', tests.create_user('Godpower Jaka', null, array['officer'])),
  ('jetty',   tests.create_user('Esther Walter Anga', null, array['officer'])),
  ('clerk',   tests.create_user('Data Clerk', null, array['data_entry']));
select tests.set_scopes((select v from ids where k = 'officer'), '[{"community_type":"HOST"},{"community_type":"PIPELINE"}]');
select tests.set_scopes((select v from ids where k = 'jetty'),   '[{"community_type":"JETTY"}]');

-- ---- codes -------------------------------------------------------------------------
select tests.login((select v from ids where k = 'officer'));
create temp table c1 as select * from public.create_submission_code(jsonb_build_object(
  'scope_type', 'community', 'community_id', tests.community('Agbonchia'),
  'valid_until', now() + interval '2 days', 'release', true));
select matches((select code from c1), '^AGB-2026-[0-9]{4}-[2-9A-HJ-NP-Z]{4}$', 'code format AGB-YYYY-MMDD-XXXX, unambiguous characters');
select is((select status from c1), 'active', 'released code is active');
select throws_ok($$select public.create_submission_code(jsonb_build_object('scope_type','community',
                   'community_id', tests.community('Onne'), 'valid_until', now() + interval '1 day'))$$,
  '42501', 'outside_your_responsibility', 'a Host/Pipeline officer cannot open collection for a Jetty community');
select tests.logout();

select tests.login((select v from ids where k = 'member'));
select is((public.get_submission_status() ->> 'open')::boolean, true, 'member sees collection OPEN for their community');
select is(public.get_submission_status() ->> 'code', (select code from c1), 'Get Code returns the released code');
select tests.logout();

select tests.login((select v from ids where k = 'member2'));
select is((public.get_submission_status() ->> 'open')::boolean, false, 'Onne member sees collection CLOSED');
select tests.logout();

select is((select count(*)::int from public.notifications n join ids on ids.v = n.user_id and ids.k = 'member'
           where n.type = 'submission_window_opened'), 1, 'releasing a code notifies members of that community');

-- ---- submit ------------------------------------------------------------------------
select tests.login((select v from ids where k = 'member'));
create temp table s1 as select public.submit_grievance(jsonb_build_object(
  'client_submission_id', '11111111-1111-4111-8111-111111111111',
  'submission_code', lower((select code from c1)),
  'community_id', tests.community('Agbonchia'),
  'description', 'The road to the market has been flooded since June.',
  'desired_resolution', 'Please repair the drainage.')) as r;
select is((select r ->> 'result' from s1), 'created', 'grievance created');
select matches((select r ->> 'tracking_id' from s1), '^IPL-GRV-2026-[0-9]{6}$', 'tracking ID format IPL-GRV-2026-NNNNNN');

-- Retry of the same device submission (e.g. after a dropped connection).
create temp table s2 as select public.submit_grievance(jsonb_build_object(
  'client_submission_id', '11111111-1111-4111-8111-111111111111',
  'submission_code', (select code from c1), 'community_id', tests.community('Agbonchia'),
  'description', 'The road to the market has been flooded since June.')) as r;
select is((select r ->> 'result' from s2), 'already_submitted', 'retry is recognised');
select is((select r ->> 'tracking_id' from s2), (select r ->> 'tracking_id' from s1), 'retry returns the same tracking ID');

create temp table s3 as select public.submit_grievance(jsonb_build_object(
  'client_submission_id', gen_random_uuid(), 'submission_code', (select code from c1),
  'community_id', tests.community('Agbonchia'), 'description', 'Second concern about street lights.')) as r;
select isnt((select r ->> 'tracking_id' from s3), (select r ->> 'tracking_id' from s1), 'each grievance gets a new tracking ID');

select throws_ok($$select public.submit_grievance(jsonb_build_object('client_submission_id', gen_random_uuid(),
                   'submission_code', (select code from c1), 'community_id', tests.community('Onne'),
                   'description', 'Trying to use another community code'))$$,
  '22023', 'code_wrong_community', 'a code only works for the communities it was released to');
select throws_ok($$select public.submit_grievance(jsonb_build_object('client_submission_id', gen_random_uuid(),
                   'submission_code', 'AGB-2026-0101-ZZZZ', 'community_id', tests.community('Agbonchia'),
                   'description', 'Made-up code'))$$,
  '22023', 'code_invalid', 'unknown code is rejected');
select throws_ok($$select public.submit_grievance(jsonb_build_object('client_submission_id', gen_random_uuid(),
                   'submission_code', (select code from c1), 'community_id', tests.community('Agbonchia'),
                   'description', 'short'))$$,
  '22023', 'description_too_short', 'a meaningful description is required');
select tests.logout();

select is((select submission_count from public.submission_codes where id = (select id from c1)), 2,
  'code counts submissions (the retry is not counted twice)');
select is((select count(*)::int from public.grievances where client_submission_id = '11111111-1111-4111-8111-111111111111'), 1,
  'exactly one grievance exists for the retried submission');

create temp table g1 as select * from public.grievances where tracking_id = (select r ->> 'tracking_id' from s1);
select is((select assigned_officer_id from g1), (select v from ids where k = 'officer'),
  'auto-assigned to the officer responsible for Host communities');
select is((select complainant_name from g1), 'Emmanuel Nwala', 'complainant details come from the profile');

-- ---- expiry and offline grace -------------------------------------------------------
select tests.open_code('Agbonchia', now() - interval '3 days', now() - interval '1 day') as expired_code \gset
select tests.login((select v from ids where k = 'member'));
select throws_ok(format($$select public.submit_grievance(jsonb_build_object('client_submission_id', gen_random_uuid(),
                   'submission_code', %L, 'community_id', tests.community('Agbonchia'),
                   'description', 'Written today after the window closed'))$$, :'expired_code'),
  '22023', 'code_expired', 'an expired code is rejected');
select lives_ok(format($$select public.submit_grievance(jsonb_build_object('client_submission_id', gen_random_uuid(),
                   'submission_code', %L, 'community_id', tests.community('Agbonchia'),
                   'client_created_at', now() - interval '2 days',
                   'description', 'Written offline while the window was open'))$$, :'expired_code'),
  'a draft written offline while the code was valid is accepted within the grace period');
select tests.logout();

select tests.open_code('Agbonchia', now() - interval '1 hour', now() + interval '1 day', 1) as tiny_code \gset
select tests.login((select v from ids where k = 'member'));
select lives_ok(format($$select public.submit_grievance(jsonb_build_object('client_submission_id', gen_random_uuid(),
                   'submission_code', %L, 'community_id', tests.community('Agbonchia'), 'description', 'First of one allowed'))$$,
                   :'tiny_code'), 'first submission under a limit of 1');
select throws_ok(format($$select public.submit_grievance(jsonb_build_object('client_submission_id', gen_random_uuid(),
                   'submission_code', %L, 'community_id', tests.community('Agbonchia'), 'description', 'Second one is over'))$$,
                   :'tiny_code'), '22023', 'code_full', 'maximum number of submissions is enforced');
select tests.logout();

-- ---- assisted (paper) entry -------------------------------------------------------------
select tests.login((select v from ids where k = 'clerk'));
select is((public.submit_grievance_assisted(jsonb_build_object(
  'origin', 'paper', 'complainant_name', 'Chief Ogbonda', 'complainant_phone', '0803 123 4567',
  'community_id', tests.community('Onne'), 'date_received', current_date - 2,
  'description', 'Jetty traffic blocks the road every morning.')) ->> 'result'), 'created',
  'data entry can enter a paper form without a code');
select tests.logout();
select is((select complainant_phone from public.grievances where complainant_name = 'Chief Ogbonda'), '+2348031234567',
  'phone numbers are normalised to +234 format');

select * from finish();
rollback;
