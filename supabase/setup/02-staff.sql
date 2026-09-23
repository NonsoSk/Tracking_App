-- Run AFTER creating these logins in Supabase: Authentication -> Users -> Add user -> Create new user
-- (enter email + password, tick "Auto Confirm User"). Replace the emails below with the real ones,
-- then paste this into SQL Editor -> New query -> Run.

do $$
declare
  admin_email    text := 'REPLACE-your.email@example.com';
  godpower_email text := 'REPLACE-godpower@example.com';
  godwin_email   text := 'REPLACE-godwin@example.com';
  esther_email   text := 'REPLACE-esther@example.com';
  v uuid;
  officer text;

begin
  -- Super Administrator (you)
  perform app.bootstrap_super_admin(admin_email);
  update public.profiles set full_name = 'Super Administrator', job_title = 'Super Administrator'
   where id = (select id from auth.users where lower(email) = lower(admin_email));

  -- Officers: name, email, community types they are responsible for
  for officer in select unnest(array['Godpower Jaka|' || godpower_email || '|HOST,PIPELINE',
                                               'Godwin Bebe-Okpabi|' || godwin_email || '|INDIRECT',
                                               'Esther Walter Anga|' || esther_email || '|JETTY']) loop
    select id into v from auth.users where lower(email) = lower(split_part(officer, '|', 2));
    if v is null then
      raise notice 'No login found for % - create it first, then run this again', split_part(officer, '|', 2);
      continue;
    end if;
    update public.profiles set full_name = split_part(officer, '|', 1), job_title = 'Officer in Charge' where id = v;
    delete from public.user_roles where user_id = v;
    insert into public.user_roles (user_id, role_id) select v, id from public.roles where code = 'officer';
    delete from public.officer_scopes where officer_id = v;
    insert into public.officer_scopes (officer_id, community_type_id)
    select v, t.id from public.community_types t where t.code = any(string_to_array(split_part(officer, '|', 3), ','));
    raise notice 'Set up %', split_part(officer, '|', 1);
  end loop;
end $$;

-- Check: should list you as super_admin and the three officers with their responsibility
select p.full_name, u.email, array_agg(distinct r.code) as roles,
       array_agg(distinct t.name) filter (where t.name is not null) as responsible_for
from public.profiles p join auth.users u on u.id = p.id
join public.user_roles ur on ur.user_id = p.id join public.roles r on r.id = ur.role_id
left join public.officer_scopes s on s.officer_id = p.id left join public.community_types t on t.id = s.community_type_id
where r.code <> 'community_member'
group by p.full_name, u.email;
