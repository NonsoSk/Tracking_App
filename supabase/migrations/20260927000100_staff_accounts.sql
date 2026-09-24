-- =============================================================================
-- Create staff logins and reset member PINs from the app, with no extra server
-- functions to deploy. Both run inside the database as the Super Admin (or
-- anyone with users.manage) and write Supabase's own auth tables the same way
-- Supabase does: bcrypt password, confirmed email, an "email" identity.
-- Also: the app is called "Indorama Grievance Portal".
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

update public.settings set value = '"Indorama Grievance Portal"' where key = 'app_name';

-- p: {"email", "full_name", "password" (10+ characters), "job_title"?, "roles": ["officer", …]}
create or replace function public.admin_create_staff(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_id    uuid := gen_random_uuid();
  v_email text := lower(btrim(coalesce(p ->> 'email', '')));
  v_name  text := nullif(btrim(coalesce(p ->> 'full_name', '')), '');
  v_pw    text := coalesce(p ->> 'password', '');
  v_roles text[] := array(select jsonb_array_elements_text(coalesce(p -> 'roles', '[]'::jsonb)));
begin
  perform app.require_perm('users.manage');
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'email_invalid' using errcode = '22023'; end if;
  if v_name is null then raise exception 'name_required' using errcode = '22023'; end if;
  if length(v_pw) < 10 then raise exception 'password_too_short' using errcode = '22023'; end if;
  if cardinality(v_roles) = 0 then raise exception 'role_invalid' using errcode = '22023'; end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then raise exception 'account_exists' using errcode = '23505'; end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
          crypt(v_pw, gen_salt('bf')), now(),
          '{"provider": "email", "providers": ["email"]}'::jsonb, jsonb_build_object('full_name', v_name), now(), now(),
          '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text,
          jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true), 'email', now(), now(), now());

  -- The sign-up trigger made a profile (as a community member); now make it staff.
  update public.profiles set full_name = v_name, job_title = nullif(btrim(coalesce(p ->> 'job_title', '')), ''), email = v_email
  where id = v_id;
  perform public.admin_set_user_roles(v_id, v_roles);
  perform app.log('user.created', 'profiles', v_id::text, null, jsonb_build_object('email', v_email, 'roles', v_roles));
  return jsonb_build_object('id', v_id);
end $$;

-- A new temporary 6-digit PIN for a community member (shown once to the admin).
create or replace function public.admin_reset_member_pin(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_pin text;
begin
  perform app.require_perm('users.manage');
  if not app.has_role(p_user, 'community_member') or app.has_role(p_user, 'super_admin') then
    raise exception 'not_a_member' using errcode = '22023';
  end if;
  v_pin := lpad((abs(('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::int) % 1000000)::text, 6, '0');
  -- Same password-safe format as the app (apps/web/src/lib/pin.ts).
  update auth.users set encrypted_password = crypt('Ipl#Pin-' || v_pin || '-Grv', gen_salt('bf')), updated_at = now()
  where id = p_user;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform app.log('user.pin_reset', 'profiles', p_user::text);
  return jsonb_build_object('pin', v_pin);
end $$;

revoke execute on function public.admin_create_staff(jsonb), public.admin_reset_member_pin(uuid) from public, anon;
grant execute on function public.admin_create_staff(jsonb), public.admin_reset_member_pin(uuid) to authenticated;
