-- DEV ONLY demo accounts (password / PIN shown below). Never run in production.
do $$
declare v uuid;
begin
  -- Super Admin: admin@ipl.test / Admin#2026
  insert into auth.users (email, raw_user_meta_data, encrypted_password)
  values ('admin@ipl.test', '{"full_name":"Nonso Admin"}', extensions.crypt('Admin#2026', extensions.gen_salt('bf'))) returning id into v;
  delete from public.user_roles where user_id = v;
  insert into public.user_roles (user_id, role_id) select v, id from public.roles where code = 'super_admin';
  update public.profiles set job_title = 'Super Administrator' where id = v;

  -- Officers (password Officer#2026)
  insert into auth.users (email, raw_user_meta_data, encrypted_password)
  values ('godpower@ipl.test', '{"full_name":"Godpower Jaka"}', extensions.crypt('Officer#2026', extensions.gen_salt('bf'))) returning id into v;
  delete from public.user_roles where user_id = v;
  insert into public.user_roles (user_id, role_id) select v, id from public.roles where code = 'officer';
  update public.profiles set job_title = 'Officer in Charge · Host & Pipeline' where id = v;
  insert into public.officer_scopes (officer_id, community_type_id) select v, id from public.community_types where code in ('HOST','PIPELINE');

  insert into auth.users (email, raw_user_meta_data, encrypted_password)
  values ('godwin@ipl.test', '{"full_name":"Godwin Bebe-Okpabi"}', extensions.crypt('Officer#2026', extensions.gen_salt('bf'))) returning id into v;
  delete from public.user_roles where user_id = v;
  insert into public.user_roles (user_id, role_id) select v, id from public.roles where code = 'officer';
  update public.profiles set job_title = 'Officer in Charge · Indirectly Impacted' where id = v;
  insert into public.officer_scopes (officer_id, community_type_id) select v, id from public.community_types where code = 'INDIRECT';

  insert into auth.users (email, raw_user_meta_data, encrypted_password)
  values ('esther@ipl.test', '{"full_name":"Esther Walter Anga"}', extensions.crypt('Officer#2026', extensions.gen_salt('bf'))) returning id into v;
  delete from public.user_roles where user_id = v;
  insert into public.user_roles (user_id, role_id) select v, id from public.roles where code = 'officer';
  update public.profiles set job_title = 'Officer in Charge · Jetty' where id = v;
  insert into public.officer_scopes (officer_id, community_type_id) select v, id from public.community_types where code = 'JETTY';

  -- Community member: phone 0803 123 4567 / PIN 123456
  insert into auth.users (email, raw_user_meta_data, encrypted_password)
  values ('2348031234567@members.iplgrievance.app',
          jsonb_build_object('full_name','Emmanuel Nwala','phone','+2348031234567','community_id',(select id from public.communities where name='Agbonchia')),
          extensions.crypt('123456', extensions.gen_salt('bf')));

  -- An open collection window for Agbonchia (so the member flow can be tried).
  insert into public.submission_codes (code, label, scope_type, community_id, valid_from, valid_until, status, released_at)
  values ('AGB-2026-0923-X7P4', 'September collection', 'community', (select id from public.communities where name='Agbonchia'),
          now() - interval '1 day', now() + interval '6 days', 'active', now());
end $$;
