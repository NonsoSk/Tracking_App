-- Test-only helpers (never deployed). Lets tests create users and act as them.
create schema if not exists tests;
grant usage on schema tests to anon, authenticated, service_role;

-- Create an auth user (the sign-up trigger makes the profile + member role),
-- then optionally replace roles.
create or replace function tests.create_user(p_name text, p_community text default null,
                                             p_roles text[] default null, p_phone text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  insert into auth.users (email, phone, raw_user_meta_data)
  values (lower(replace(p_name, ' ', '.')) || '@test.local', p_phone,
          jsonb_build_object('full_name', p_name,
                             'community_id', (select id from public.communities where name = p_community)))
  returning id into v_id;
  if p_roles is not null then
    delete from public.user_roles where user_id = v_id;
    insert into public.user_roles (user_id, role_id) select v_id, id from public.roles where code = any(p_roles);
  end if;
  return v_id;
end $$;

create or replace function tests.set_scopes(p_officer uuid, p_scopes jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare s jsonb;
begin
  delete from public.officer_scopes where officer_id = p_officer;
  for s in select * from jsonb_array_elements(p_scopes) loop
    insert into public.officer_scopes (officer_id, community_type_id, cluster_id, community_id)
    values (p_officer, (select id from public.community_types where code = s ->> 'community_type'),
            (select id from public.clusters where name = s ->> 'cluster'),
            (select id from public.communities where name = s ->> 'community'));
  end loop;
end $$;

create or replace function tests.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create or replace function tests.login_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
end $$;

create or replace function tests.logout() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', true);
end $$;

create or replace function tests.community(p_name text) returns uuid
language sql stable security definer set search_path = public as $$ select id from public.communities where name = p_name $$;

-- An active code for a community, created directly (bypasses permission checks).
create or replace function tests.open_code(p_community text, p_from timestamptz default now() - interval '1 hour',
                                          p_until timestamptz default now() + interval '2 days', p_max int default null)
returns text language plpgsql security definer set search_path = public as $$
declare v text := (select short_code from public.communities where name = p_community) || '-2026-0923-' || app.random_token(4);
begin
  insert into public.submission_codes (code, scope_type, community_id, valid_from, valid_until, max_submissions, status)
  values (v, 'community', tests.community(p_community), p_from, p_until, p_max, 'active');
  return v;
end $$;

grant execute on all functions in schema tests to anon, authenticated;
