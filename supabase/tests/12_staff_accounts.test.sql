-- Staff logins and member PIN resets from the app, without server functions.
begin;
set search_path = public, extensions, tests;
select plan(10);

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;
insert into ids values
  ('admin',  tests.create_user('Super Admin', null, array['super_admin'])),
  ('officer', tests.create_user('Olu Officer', null, array['officer'])),
  ('member', tests.create_user('Ada Member', 'Agbonchia'));
create temp table made (id uuid);
grant all on made to authenticated;

select tests.login((select v from ids where k = 'officer'));
select throws_ok($$select public.admin_create_staff('{"email":"x@ipl.test","full_name":"X","password":"Long-enough-1","roles":["officer"]}')$$,
  '42501', 'not_allowed', 'an officer cannot create staff accounts');
select tests.logout();

select tests.login((select v from ids where k = 'admin'));
insert into made select (public.admin_create_staff(jsonb_build_object('email', ' Chika.Staff@IPL.test ', 'full_name', 'Chika Staff',
  'password', 'Skixzy7878**', 'job_title', 'CR Officer', 'roles', jsonb_build_array('officer'))) ->> 'id')::uuid;
select throws_ok($$select public.admin_create_staff('{"email":"chika.staff@ipl.test","full_name":"Again","password":"Long-enough-1","roles":["officer"]}')$$,
  '23505', 'account_exists', 'the same email cannot be added twice');
select throws_ok($$select public.admin_create_staff('{"email":"short@ipl.test","full_name":"Short","password":"abc","roles":["officer"]}')$$,
  '22023', 'password_too_short', 'the temporary password must be at least 10 characters');
select tests.logout();

select is((select email from auth.users where id = (select id from made)), 'chika.staff@ipl.test', 'login email is saved, trimmed and in small letters');
select ok((select encrypted_password = crypt('Skixzy7878**', encrypted_password) from auth.users where id = (select id from made)),
  'the password is stored as a bcrypt hash that matches');
select ok((select email_confirmed_at is not null from auth.users where id = (select id from made)), 'the account is ready to sign in (confirmed)');
select is((select count(*)::int from auth.identities where user_id = (select id from made) and provider = 'email'), 1, 'it has an email identity, like any Supabase user');
select is((select array_agg(r.code) from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = (select id from made)),
  array['officer']::text[], 'the person is an Officer, not a community member');

select tests.login((select v from ids where k = 'admin'));
create temp table pin as select public.admin_reset_member_pin((select v from ids where k = 'member')) ->> 'pin' as p;
select tests.logout();
select ok((select encrypted_password = crypt('Ipl#Pin-' || (select p from pin) || '-Grv', encrypted_password) from auth.users
           where id = (select v from ids where k = 'member')) and (select p from pin) ~ '^\d{6}$',
  'Reset PIN gives the member a new 6-digit PIN that works for sign-in');
select tests.login((select v from ids where k = 'admin'));
select throws_ok(format('select public.admin_reset_member_pin(%L)', (select id from made)), '22023', 'not_a_member', 'staff passwords are not reset as PINs');
select tests.logout();

select * from finish();
rollback;
