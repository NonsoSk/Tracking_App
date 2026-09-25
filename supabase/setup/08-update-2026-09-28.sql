-- UPDATE (28 Sep 2026): invite staff by email; they choose their own password.
-- Run after 07-update-2026-09-27.sql. Safe to run more than once.

-- =============================================================================
-- Invite staff by email.
--
-- 1. The Super Admin (users.manage) records an invitation: name, email, job
--    title, role(s). The app then asks Supabase Auth to email the person a
--    sign-in link.
-- 2. When Supabase creates the account for that email, the invitation's roles
--    are applied and the profile is marked "must set password".
-- 3. The person clicks the link, lands in the app, and must choose a password
--    before doing anything else. The invitation then counts as accepted.
-- Only emails with an open invitation become staff: anyone else who requests a
-- sign-in link just gets an ordinary community-member account.
-- =============================================================================

alter table public.profiles add column if not exists must_set_password boolean not null default false;

create table if not exists public.staff_invitations (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  full_name     text not null,
  job_title     text,
  roles         text[] not null,
  invited_by    uuid references public.profiles(id) on delete set null,
  invited_at    timestamptz not null default now(),
  last_sent_at  timestamptz not null default now(),
  account_id    uuid references public.profiles(id) on delete set null,  -- set when Supabase creates the login
  accepted_at   timestamptz,                                            -- set when they choose their password
  cancelled_at  timestamptz
);
create unique index if not exists staff_invitations_open_email
  on public.staff_invitations (lower(email)) where accepted_at is null and cancelled_at is null;
alter table public.staff_invitations enable row level security;
revoke all on public.staff_invitations from public, anon, authenticated;
drop trigger if exists staff_invitations_audit on public.staff_invitations;
create trigger staff_invitations_audit after insert or update or delete on public.staff_invitations
  for each row execute function app.audit_row();

-- The profile the app loads now says whether a password must be chosen first.
create or replace function public.my_profile() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', p.id, 'full_name', p.full_name, 'phone', p.phone, 'email', p.email, 'address', p.address,
    'gender', p.gender, 'community_id', p.community_id, 'community_name', c.name, 'is_active', p.is_active,
    'must_set_password', p.must_set_password)
  from public.profiles p left join public.communities c on c.id = p.community_id
  where p.id = auth.uid()
$$;

-- p: {"email", "full_name", "job_title"?, "roles": ["officer", …]}. Also used to resend.
create or replace function public.admin_invite_staff(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email text := lower(btrim(coalesce(p ->> 'email', '')));
  v_name  text := nullif(btrim(coalesce(p ->> 'full_name', '')), '');
  v_roles text[] := array(select jsonb_array_elements_text(coalesce(p -> 'roles', '[]'::jsonb)));
  v_user  uuid;
  inv public.staff_invitations;
begin
  perform app.require_perm('users.manage');
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'email_invalid' using errcode = '22023'; end if;
  if v_name is null then raise exception 'name_required' using errcode = '22023'; end if;
  if cardinality(v_roles) = 0 or 'community_member' = any(v_roles)
     or exists (select 1 from unnest(v_roles) r where r not in (select code from public.roles)) then
    raise exception 'role_invalid' using errcode = '22023';
  end if;
  if 'super_admin' = any(v_roles) and not app.is_super_admin() then raise exception 'not_allowed' using errcode = '42501'; end if;

  select * into inv from public.staff_invitations
  where lower(email) = v_email and accepted_at is null and cancelled_at is null;
  select id into v_user from auth.users where lower(email) = v_email;
  -- An existing login can only be re-sent its own pending invitation.
  if v_user is not null and (inv.id is null or inv.account_id is distinct from v_user) then
    raise exception 'account_exists' using errcode = '23505';
  end if;

  if inv.id is null then
    insert into public.staff_invitations (email, full_name, job_title, roles, invited_by)
    values (v_email, v_name, nullif(btrim(coalesce(p ->> 'job_title', '')), ''), v_roles, auth.uid())
    returning * into inv;
    perform app.log('user.invited', 'staff_invitations', inv.id::text, null, jsonb_build_object('email', v_email, 'roles', v_roles));
  else
    update public.staff_invitations set full_name = v_name, job_title = nullif(btrim(coalesce(p ->> 'job_title', '')), ''),
           roles = v_roles, last_sent_at = now()
    where id = inv.id returning * into inv;
    if inv.account_id is not null then   -- login already made by the first email: keep it in step
      perform app.apply_invitation_roles(inv);
    end if;
  end if;
  return jsonb_build_object('id', inv.id, 'email', inv.email);
end $$;

create or replace function app.apply_invitation_roles(inv public.staff_invitations) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.user_roles where user_id = inv.account_id;
  insert into public.user_roles (user_id, role_id, granted_by)
  select inv.account_id, r.id, inv.invited_by from public.roles r where r.code = any(inv.roles);
  update public.profiles set full_name = inv.full_name, job_title = inv.job_title, email = inv.email,
         must_set_password = true, is_active = true
  where id = inv.account_id;
end $$;

-- Runs after the sign-up trigger has made the profile.
create or replace function app.apply_staff_invitation() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare inv public.staff_invitations;
begin
  update public.staff_invitations set account_id = new.id
  where lower(email) = lower(new.email) and accepted_at is null and cancelled_at is null
  returning * into inv;
  if inv.id is not null then perform app.apply_invitation_roles(inv); end if;
  return new;
end $$;
drop trigger if exists on_auth_user_created_invite on auth.users;
create trigger on_auth_user_created_invite after insert on auth.users
  for each row execute function app.apply_staff_invitation();

-- Called by the app right after the person has chosen their password.
create or replace function public.complete_password_setup() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  update public.profiles set must_set_password = false where id = auth.uid();
  update public.staff_invitations set accepted_at = now() where account_id = auth.uid() and accepted_at is null and cancelled_at is null;
  perform app.log('user.invitation_accepted', 'profiles', auth.uid()::text);
end $$;

create or replace function public.list_staff_invitations() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform app.require_perm('users.manage');
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', i.id, 'email', i.email, 'full_name', i.full_name, 'job_title', i.job_title, 'roles', i.roles,
            'invited_at', i.invited_at, 'last_sent_at', i.last_sent_at, 'invited_by', p.full_name)
          order by i.invited_at desc), '[]'::jsonb)
          from public.staff_invitations i left join public.profiles p on p.id = i.invited_by
          where i.accepted_at is null and i.cancelled_at is null);
end $$;

-- Cancel: the link stops giving staff access (the unused login is disabled).
create or replace function public.admin_cancel_invitation(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare inv public.staff_invitations;
begin
  perform app.require_perm('users.manage');
  update public.staff_invitations set cancelled_at = now() where id = p_id and accepted_at is null and cancelled_at is null
  returning * into inv;
  if inv.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if inv.account_id is not null then
    delete from public.user_roles where user_id = inv.account_id;
    update public.profiles set is_active = false, must_set_password = false where id = inv.account_id;
  end if;
  perform app.log('user.invitation_cancelled', 'staff_invitations', p_id::text);
end $$;

revoke execute on function public.admin_invite_staff(jsonb), public.complete_password_setup(), public.list_staff_invitations(),
  public.admin_cancel_invitation(uuid) from public, anon;
grant execute on function public.admin_invite_staff(jsonb), public.complete_password_setup(), public.list_staff_invitations(),
  public.admin_cancel_invitation(uuid) to authenticated;
