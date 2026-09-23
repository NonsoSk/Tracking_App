-- =============================================================================
-- Foundation: private `app` schema, settings, audit log, RBAC, profiles.
--
-- Conventions used by every migration:
--   * Tables live in `public` with RLS enabled. Clients never write grievance
--     data directly; they call SECURITY DEFINER functions that check
--     permissions, write the audit trail and keep the workflow consistent.
--   * Internal helpers live in `app`, which is not exposed through the API.
--   * Errors meant for the UI are raised with a stable machine key as the
--     message (e.g. 'code_expired'). The client maps keys to plain language;
--     users never see database errors.
-- =============================================================================

create extension if not exists pg_trgm with schema extensions;

create schema if not exists app;
grant usage on schema app to authenticated, service_role;
-- Functions are executable by PUBLIC by default; in `app` nothing is, unless granted.
alter default privileges in schema app revoke execute on functions from public;

-- -----------------------------------------------------------------------------
-- Settings (key/value, typed via jsonb). Read by anyone signed in; written by
-- settings.manage. Values used by SQL are read through app.setting().
-- -----------------------------------------------------------------------------
create table public.settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  is_public   boolean not null default false,  -- readable by community members / anon
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

insert into public.settings (key, value, description, is_public) values
  ('timezone',                  '"Africa/Lagos"', 'Operational time zone for dates and the SLA clock', true),
  ('sla_threshold_days',        '3',              'A grievance is overdue when unresolved for more than this many days', false),
  ('sla_clock',                 '"working_days"', 'working_days (Mon-Fri minus holidays) or calendar_days', false),
  ('sla_work_days',             '[1,2,3,4,5]',    'ISO weekdays counted as working days (1 = Monday)', false),
  ('sla_due_soon_hours',        '24',             'Window before the deadline that counts as "due soon"', false),
  ('overdue_realert_hours',     '24',             'How often an overdue grievance re-alerts its officer', false),
  ('code_offline_grace_hours',  '72',             'Accept queued offline submissions this long after a code expires, if drafted while it was valid', false),
  ('whatsapp_enabled',          'false',          'Send WhatsApp notifications (requires Meta Cloud API credentials in the notify function)', false),
  ('whatsapp_resolution_template', '"grievance_resolved"', 'Approved Meta template name for resolution messages', false),
  ('auto_close_after_ack_days', 'null',           'Automatically close N days after acknowledgement (null = manual)', false),
  ('app_name',                  '"IPL Community Grievance"', 'Name shown in the app and in messages', true);

create or replace function app.setting(p_key text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select value from public.settings where key = p_key
$$;

create or replace function app.tz() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select value #>> '{}' from public.settings where key = 'timezone'), 'Africa/Lagos')
$$;

-- -----------------------------------------------------------------------------
-- Audit log: append-only. Written only by SECURITY DEFINER code.
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor_id    uuid,
  actor_role  text,
  action      text not null,
  entity      text not null,
  entity_id   text,
  old_value   jsonb,
  new_value   jsonb,
  context     jsonb
);
create index audit_logs_entity_idx on public.audit_logs (entity, entity_id, at desc);
create index audit_logs_actor_idx  on public.audit_logs (actor_id, at desc);
create index audit_logs_at_idx     on public.audit_logs (at desc);

create or replace function app.log(p_action text, p_entity text, p_entity_id text,
                                   p_old jsonb default null, p_new jsonb default null,
                                   p_context jsonb default null) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.audit_logs (actor_id, actor_role, action, entity, entity_id, old_value, new_value, context)
  values (auth.uid(), coalesce(auth.role(), current_user), p_action, p_entity, p_entity_id, p_old, p_new, p_context)
$$;

-- Generic row-change trigger. Records only the columns that changed.
create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old jsonb; v_new jsonb; v_id text; k text;
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new); v_id := v_new ->> 'id';
  elsif tg_op = 'DELETE' then
    v_old := to_jsonb(old); v_id := v_old ->> 'id';
  else
    v_old := to_jsonb(old); v_new := to_jsonb(new); v_id := v_new ->> 'id';
    for k in select jsonb_object_keys(v_new) loop
      if v_old -> k is not distinct from v_new -> k then
        v_old := v_old - k; v_new := v_new - k;
      end if;
    end loop;
    v_old := v_old - 'updated_at'; v_new := v_new - 'updated_at';
    if v_new = '{}'::jsonb then return new; end if;
  end if;
  insert into public.audit_logs (actor_id, actor_role, action, entity, entity_id, old_value, new_value)
  values (auth.uid(), coalesce(auth.role(), current_user), lower(tg_op), tg_table_name, v_id, v_old, v_new);
  return coalesce(new, old);
end $$;

create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;

create or replace function app.forbid_change() returns trigger
language plpgsql as $$ begin raise exception 'append_only' using errcode = '42501'; end $$;

create trigger audit_logs_append_only before update or delete on public.audit_logs
  for each row execute function app.forbid_change();

create trigger settings_touch before update on public.settings for each row execute function app.touch_updated_at();
create trigger settings_audit after insert or update or delete on public.settings for each row execute function app.audit_row();

-- -----------------------------------------------------------------------------
-- RBAC: roles are bundles of permission rows. Nothing about a role is
-- hard-coded except `super_admin`, which always passes every check.
-- -----------------------------------------------------------------------------
create table public.roles (
  id          smallint generated always as identity primary key,
  code        text not null unique,
  name        text not null,
  description text,
  is_staff    boolean not null default true,
  is_system   boolean not null default false  -- system roles cannot be deleted
);

create table public.permissions (
  code        text primary key,
  description text not null
);

create table public.role_permissions (
  role_id         smallint not null references public.roles(id) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  primary key (role_id, permission_code)
);

insert into public.roles (code, name, description, is_staff, is_system) values
  ('super_admin',      'Super Administrator',      'Unrestricted access. Destructive actions still require confirmation.', true, true),
  ('officer',          'Officer in Charge',        'Works grievances within assigned responsibility.', true, true),
  ('supervisor',       'Supervisor',               'Oversees all grievances and officers.', true, false),
  ('cr_staff',         'Community Relations Staff','Reads and triages all grievances.', true, false),
  ('data_entry',       'Data Entry Officer',       'Enters paper and assisted grievances.', true, false),
  ('viewer',           'Viewer',                   'Dashboards and reports only; no individual records.', true, false),
  ('community_member', 'Community Member',         'Submits and tracks their own grievances.', false, true);

insert into public.permissions (code, description) values
  ('grievance.read.all',          'Read every grievance'),
  ('grievance.read.scope',        'Read grievances assigned to me or inside my responsibility'),
  ('grievance.read.entered',      'Read grievances I entered on someone''s behalf'),
  ('grievance.read.own',          'Read my own grievances (complainant view)'),
  ('grievance.create.self',       'Submit my own grievance with a valid submission code'),
  ('grievance.create.assisted',   'Enter a grievance on behalf of a complainant (paper / assisted)'),
  ('grievance.triage',            'Change category, sub-category, severity and classification'),
  ('grievance.update_status',     'Move a grievance through the workflow'),
  ('grievance.assign',            'Assign or reassign grievances to officers'),
  ('grievance.comment',           'Add remarks and actions'),
  ('grievance.resolve',           'Record a resolution'),
  ('grievance.close',             'Close a grievance'),
  ('grievance.acknowledge.own',   'Acknowledge or dispute the resolution of my own grievance'),
  ('grievance.acknowledge.record','Record a complainant''s acknowledgement on their behalf'),
  ('grievance.amend_text',        'Correct the original grievance text (audited)'),
  ('grievance.archive',           'Archive and restore grievances'),
  ('grievance.archive.request',   'Request that a grievance be archived'),
  ('grievance.hard_delete',       'Permanently delete a grievance'),
  ('attachment.upload',           'Upload evidence'),
  ('codes.manage',                'Create, release and deactivate submission codes'),
  ('dashboard.view',              'View dashboards and reports'),
  ('export.run',                  'Export grievance data'),
  ('masterdata.manage',           'Manage communities, clusters, categories, statuses and severities'),
  ('users.manage',                'Create, disable and assign roles to users'),
  ('import.run',                  'Import historical data'),
  ('audit.view',                  'View the audit log'),
  ('settings.manage',             'Change system settings'),
  ('notifications.manage',        'View delivery logs and resend notifications');

insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r, public.permissions p
where (r.code, p.code) in (
  ('officer','grievance.read.scope'), ('officer','grievance.create.assisted'), ('officer','grievance.triage'),
  ('officer','grievance.update_status'), ('officer','grievance.comment'), ('officer','grievance.resolve'),
  ('officer','grievance.close'), ('officer','grievance.acknowledge.record'), ('officer','grievance.archive.request'),
  ('officer','attachment.upload'), ('officer','codes.manage'), ('officer','dashboard.view'), ('officer','export.run'),

  ('supervisor','grievance.read.all'), ('supervisor','grievance.create.assisted'), ('supervisor','grievance.triage'),
  ('supervisor','grievance.update_status'), ('supervisor','grievance.assign'), ('supervisor','grievance.comment'),
  ('supervisor','grievance.resolve'), ('supervisor','grievance.close'), ('supervisor','grievance.acknowledge.record'),
  ('supervisor','grievance.archive.request'), ('supervisor','attachment.upload'), ('supervisor','codes.manage'),
  ('supervisor','dashboard.view'), ('supervisor','export.run'),

  ('cr_staff','grievance.read.all'), ('cr_staff','grievance.create.assisted'), ('cr_staff','grievance.triage'),
  ('cr_staff','grievance.update_status'), ('cr_staff','grievance.assign'), ('cr_staff','grievance.comment'),
  ('cr_staff','attachment.upload'), ('cr_staff','codes.manage'), ('cr_staff','dashboard.view'), ('cr_staff','export.run'),

  ('data_entry','grievance.read.entered'), ('data_entry','grievance.create.assisted'),

  ('viewer','dashboard.view'),

  ('community_member','grievance.read.own'), ('community_member','grievance.create.self'),
  ('community_member','grievance.acknowledge.own')
);

-- -----------------------------------------------------------------------------
-- Profiles (1:1 with auth.users) and role membership.
-- community_id FK is added after communities exist (master data migration).
-- -----------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  full_name    text not null check (length(btrim(full_name)) between 2 and 120),
  phone        text unique check (phone ~ '^\+234[789][01][0-9]{8}$'),
  email        text,
  address      text,
  gender       text check (gender in ('male','female')),
  community_id uuid,
  job_title    text,
  is_active    boolean not null default true,
  disabled_at  timestamptz,
  disabled_by  uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger profiles_touch before update on public.profiles for each row execute function app.touch_updated_at();
create trigger profiles_audit after insert or update or delete on public.profiles for each row execute function app.audit_row();

create table public.user_roles (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role_id    smallint not null references public.roles(id) on delete restrict,
  granted_by uuid,
  granted_at timestamptz not null default now(),
  primary key (user_id, role_id)
);
create trigger user_roles_audit after insert or update or delete on public.user_roles for each row execute function app.audit_row();

-- --- permission helpers (used inside RLS; wrap in (select ...) at call sites so
--     Postgres evaluates them once per statement, not per row) ---------------
create or replace function app.is_active_user() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active)
$$;

create or replace function app.is_super_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = auth.uid() and r.code = 'super_admin' and p.is_active)
$$;

create or replace function app.has_perm(p_perm text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.is_super_admin() or exists (
    select 1 from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = auth.uid() and rp.permission_code = p_perm and p.is_active)
$$;

create or replace function app.has_role(p_user uuid, p_role text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                 where ur.user_id = p_user and r.code = p_role)
$$;

create or replace function app.require_perm(p_perm text) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if not app.has_perm(p_perm) then raise exception 'not_allowed' using errcode = '42501', detail = p_perm; end if;
end $$;

grant execute on function app.is_super_admin(), app.has_perm(text), app.is_active_user(), app.tz() to authenticated;

-- What the signed-in user may do; the UI uses this to decide what to show.
-- (The UI is never the enforcement point.)
create or replace function public.my_access() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'is_active', app.is_active_user(),
    'roles', coalesce((select jsonb_agg(r.code order by r.code) from public.user_roles ur
                       join public.roles r on r.id = ur.role_id where ur.user_id = auth.uid()), '[]'),
    'permissions', case when app.is_super_admin()
                        then (select jsonb_agg(code order by code) from public.permissions)
                        else coalesce((select jsonb_agg(distinct rp.permission_code) from public.user_roles ur
                                       join public.role_permissions rp on rp.role_id = ur.role_id
                                       where ur.user_id = auth.uid()), '[]') end)
$$;
