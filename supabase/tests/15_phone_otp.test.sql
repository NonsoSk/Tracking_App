-- Registration: phone confirmed by text-message code; staff see the full complainant profile.
begin;
set search_path = public, extensions, tests;
select plan(21);

-- Only the server (service role) can make or check codes.
select tests.login_anon();
select throws_ok($$select public.otp_request('08031112222')$$, '42501', null, 'the app cannot ask the database for a code directly');
select throws_ok($$select public.otp_verify('08031112222', '123456')$$, '42501', null, 'the app cannot check a code directly');
select throws_ok($$select * from public.phone_verifications$$, '42501', null, 'the codes table is not readable');
select tests.logout();

set local role service_role;
select throws_ok($$select public.otp_request('12345')$$, '22023', 'phone_invalid', 'a made-up number is refused');
select (public.otp_request('0803 111 2222', '10.0.0.1')) ->> 'code' as c1 \gset
select is(length(:'c1'), 6, 'a 6-digit code is made');
select throws_ok($$select public.otp_request('08031112222', '10.0.0.1')$$, '22023', 'otp_too_soon', 'only one code a minute per number');
select is((public.otp_verify('08031112222', lpad(((:'c1')::int + 1) % 1000000 || '', 6, '0'))) ->> 'error', 'otp_wrong', 'a wrong code is refused');
select is((public.otp_verify('08031112222', lpad(((:'c1')::int + 1) % 1000000 || '', 6, '0'))) ->> 'tries_left', '3', 'wrong tries are counted');
select ok((public.otp_verify('+2348031112222', :'c1') ->> 'ok')::boolean, 'the right code confirms the number');
reset role;

-- An account needs a confirmed number, and each confirmation is used once.
select throws_ok($$insert into auth.users (email, raw_user_meta_data)
  values ('2348035550000@members.iplgrievance.app', '{"full_name":"No Code","phone":"+2348035550000"}')$$,
  '42501', 'phone_not_verified', 'an unconfirmed number cannot register');
insert into auth.users (email, raw_user_meta_data)
  values ('2348031112222@members.iplgrievance.app',
          jsonb_build_object('full_name', 'Ngozi Confirmed', 'phone', '+2348031112222', 'gender', 'female',
                             'community_id', tests.community('Agbonchia')));
select ok((select phone_verified_at is not null from profiles where phone = '+2348031112222'), 'the confirmed number is recorded on the profile');
select is((select count(*)::int from phone_verifications where phone = '+2348031112222' and consumed_at is not null), 1, 'the confirmation is used up');

set local role service_role;
select throws_ok($$select public.otp_request('08031112222')$$, '23505', 'account_exists', 'a registered number cannot get another code (one account per number)');
reset role;

-- Too many codes for one number in a day.
insert into phone_verifications (phone, code_hash, created_at, expires_at)
  select '+2348037770000', 'x', now() - (n || ' minutes')::interval, now() from generate_series(2, 6) n;
set local role service_role;
select throws_ok($$select public.otp_request('08037770000')$$, '22023', 'otp_limit', 'five codes a day per number');
reset role;

-- Switched off by the administrator: registration works without a code.
update settings set value = 'false' where key = 'phone_otp_required';
select lives_ok($$insert into auth.users (email, raw_user_meta_data)
  values ('2348039990000@members.iplgrievance.app', '{"full_name":"Offline Setup","phone":"+2348039990000"}')$$,
  'with the setting off, no code is needed');
update settings set value = 'true' where key = 'phone_otp_required';
select lives_ok($$select tests.create_user('Staff Person', null, array['officer'])$$, 'staff accounts (no phone) are not affected');

-- Complainant details for staff.
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;
insert into ids values
  ('admin',  tests.create_user('Super Admin', null, array['super_admin'])),
  ('viewer', tests.create_user('Agb Leader', 'Agbonchia', array['viewer'])),
  ('member', (select id from profiles where phone = '+2348031112222'));
select tests.set_scopes((select v from ids where k = 'viewer'), '[{"community":"Agbonchia"}]');
create temp table g as
  select (app.create_grievance(jsonb_build_object('community_id', tests.community('Agbonchia'), 'description', 'Agbonchia road is flooded'),
          'app', (select v from ids where k = 'member'), null)).id;
grant select on g to authenticated;

select tests.login((select v from ids where k = 'admin'));
select is((public.complainant_details((select id from g))) ->> 'full_name', 'Ngozi Confirmed', 'staff see the full name');
select is((public.complainant_details((select id from g))) ->> 'gender', 'female', 'staff see the gender');
select is((public.complainant_details((select id from g))) ->> 'home_community', 'Agbonchia', 'staff see the home community');
select ok((public.complainant_details((select id from g)) ->> 'phone_verified')::boolean, 'staff see that the phone was confirmed');
select tests.logout();

select tests.login((select v from ids where k = 'viewer'));
select is(public.complainant_details((select id from g)), null, 'a Viewer does not get the complainant''s personal details');
select tests.logout();

select * from finish();
rollback;
