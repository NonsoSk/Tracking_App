-- Members must type the exact code; the app checks it and limits wrong guesses.
begin;
set search_path = public, extensions, tests;
select plan(8);

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;
insert into ids values
  ('member', tests.create_user('Ada Member', 'Agbonchia')),
  ('guesser', tests.create_user('Guessing Member', 'Agbonchia')),
  ('officer', tests.create_user('Olu Officer', null, array['officer', 'supervisor', 'cr_staff']));
select tests.open_code('Agbonchia') as agb \gset
select tests.open_code('Onne') as onn \gset

select is((select count(*)::int from role_permissions where permission_code = 'codes.manage'), 0,
  'no role other than Super Admin holds the code permission');
select tests.login((select v from ids where k = 'officer'));
select is((select count(*)::int from public.submission_codes), 0, 'officers, supervisors and CR staff see no codes');
select tests.logout();

select tests.login((select v from ids where k = 'member'));
select is((select count(*)::int from public.submission_codes), 0, 'members cannot read codes');
select is(public.check_submission_code(lower(:'agb')) ->> 'ok', 'true', 'the exact code (any letter case) is accepted');
select is(public.check_submission_code(:'agb') ->> 'scope', 'Agbonchia', '...and says which community it opens');
select is(public.check_submission_code(:'onn') ->> 'error', 'code_wrong_community', 'a code for another community is refused');
select is(public.check_submission_code('AGB-2026-0923-ZZZZ') ->> 'error', 'code_invalid', 'a made-up code is refused');
select tests.logout();

select tests.login((select v from ids where k = 'guesser'));
select public.check_submission_code('AGB-2026-0923-AAA' || n) from generate_series(1, 8) n;
select is(public.check_submission_code(:'agb') ->> 'error', 'rate_limited', 'after 8 wrong codes in 15 minutes, checking pauses');
select tests.logout();

select * from finish();
rollback;
