-- Invite staff by email: the invitation's role is applied when the login is created,
-- and the person must choose a password first.
begin;
set search_path = public, extensions, tests;
select plan(12);

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;
insert into ids values
  ('admin',   tests.create_user('Super Admin', null, array['super_admin'])),
  ('officer', tests.create_user('Olu Officer', null, array['officer']));

select tests.login((select v from ids where k = 'officer'));
select throws_ok($$select public.admin_invite_staff('{"email":"a@ipl.test","full_name":"A","roles":["officer"]}')$$,
  '42501', 'not_allowed', 'an officer cannot invite staff');
select tests.logout();

select tests.login((select v from ids where k = 'admin'));
select lives_ok($$select public.admin_invite_staff('{"email":" Bisi.Invite@IPL.test ","full_name":"Bisi Invite","job_title":"CR Officer","roles":["officer"]}')$$,
  'the Super Admin invites Bisi as an Officer');
select is((public.list_staff_invitations() -> 0 ->> 'email'), 'bisi.invite@ipl.test', 'the invitation is listed as waiting (email in small letters)');
select throws_ok($$select public.admin_invite_staff('{"email":"x@ipl.test","full_name":"X","roles":["community_member"]}')$$,
  '22023', 'role_invalid', 'an invitation must be for a staff role');
select tests.logout();

-- Supabase creates the login when it sends the email (as signInWithOtp does).
insert into auth.users (email, raw_user_meta_data) values ('bisi.invite@ipl.test', '{}');
insert into ids select 'bisi', id from auth.users where email = 'bisi.invite@ipl.test';

select is((select array_agg(r.code) from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = (select v from ids where k = 'bisi')),
  array['officer']::text[], 'the new login gets the invited role, not community member');
select is((select full_name || ' / ' || job_title from profiles where id = (select v from ids where k = 'bisi')), 'Bisi Invite / CR Officer',
  'name and job title come from the invitation');

select tests.login((select v from ids where k = 'bisi'));
select is((public.my_profile() ->> 'must_set_password')::boolean, true, 'the app is told to ask for a password first');
select public.complete_password_setup();
select is((public.my_profile() ->> 'must_set_password')::boolean, false, 'after choosing a password, they carry on to the app');
select tests.logout();

select tests.login((select v from ids where k = 'admin'));
select is(jsonb_array_length(public.list_staff_invitations()), 0, 'the accepted invitation is no longer waiting');
select throws_ok($$select public.admin_invite_staff('{"email":"bisi.invite@ipl.test","full_name":"Again","roles":["officer"]}')$$,
  '23505', 'account_exists', 'someone who already has a login cannot be invited again');

-- Cancelling an invitation whose link was sent but not used switches that login off.
select public.admin_invite_staff('{"email":"cancel.me@ipl.test","full_name":"Cancel Me","roles":["viewer"]}');
select tests.logout();
insert into auth.users (email, raw_user_meta_data) values ('cancel.me@ipl.test', '{}');
select id as cancel_id from staff_invitations where email = 'cancel.me@ipl.test' \gset
select tests.login((select v from ids where k = 'admin'));
select public.admin_cancel_invitation(:'cancel_id');
select tests.logout();
select is((select is_active from profiles p join auth.users u on u.id = p.id where u.email = 'cancel.me@ipl.test'), false,
  'a cancelled invitation no longer gives access');

-- Someone who was never invited gets an ordinary member account.
insert into auth.users (email, raw_user_meta_data) values ('stranger@ipl.test', '{}');
select is((select array_agg(r.code) from user_roles ur join roles r on r.id = ur.role_id join auth.users u on u.id = ur.user_id
           where u.email = 'stranger@ipl.test'), array['community_member']::text[], 'an email with no invitation never becomes staff');

select * from finish();
rollback;
