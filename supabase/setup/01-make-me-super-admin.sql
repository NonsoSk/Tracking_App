-- Make your own login the Super Administrator.
-- 1. Supabase -> Authentication -> Users -> Add user -> Create new user
--    (your work email + a strong password, tick "Auto Confirm User").
-- 2. Put your email below (keep the quotes), then SQL Editor -> New query -> paste -> Run.
-- Everyone else (officers etc.) you can add from inside the app afterwards.

select app.bootstrap_super_admin('REPLACE-your.email@example.com');
update public.profiles set full_name = 'REPLACE Your Name', job_title = 'Super Administrator'
 where id = (select id from auth.users where lower(email) = lower('REPLACE-your.email@example.com'));
