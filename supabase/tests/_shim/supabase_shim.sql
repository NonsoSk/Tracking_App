-- Local-only emulation of the parts of Supabase the migrations rely on.
-- NEVER run this against a real Supabase project: there these objects already exist.
-- Mirrors: roles anon/authenticated/service_role, auth.users, auth.uid(),
-- auth.jwt(), the `extensions` schema and Supabase's default privileges.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

create schema if not exists extensions;
create schema if not exists auth;
grant usage on schema auth, extensions to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  phone text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
-- The GoTrue columns and identities table that admin_create_staff writes (same names as Supabase).
alter table auth.users add column if not exists instance_id uuid;
alter table auth.users add column if not exists aud varchar(255);
alter table auth.users add column if not exists role varchar(255);
alter table auth.users add column if not exists encrypted_password text;
alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists raw_app_meta_data jsonb;
alter table auth.users add column if not exists updated_at timestamptz;
alter table auth.users add column if not exists confirmation_token varchar(255);
alter table auth.users add column if not exists email_change varchar(255);
alter table auth.users add column if not exists email_change_token_new varchar(255);
alter table auth.users add column if not exists recovery_token varchar(255);
create table if not exists auth.identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_id text not null,
  identity_data jsonb not null,
  provider text not null,
  last_sign_in_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  unique (provider_id, provider)
);

create or replace function auth.uid() returns uuid language sql stable as $$
  -- Same as Supabase: empty settings (e.g. a pooled connection after a request) count as "no user".
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;

create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
$$;

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

-- Supabase grants broad table privileges by default and relies on RLS.
-- Emulating that makes the tests prove RLS/grants in the migrations actually hold.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
