-- IPL Community Grievance: complete database setup (all migrations in order).
-- Paste into Supabase: SQL Editor -> New query -> Run. Run it ONCE on an empty project.
-- Generated from supabase/migrations/*.sql - do not edit by hand.

-- ============================== 20260923000100_foundation.sql
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

-- ============================== 20260923000200_master_data.sql
-- =============================================================================
-- Master data: community types, clusters, communities (+ affiliations and
-- aliases), grievance categories/sub-categories, statuses, severities,
-- holidays. Everything here is editable by `masterdata.manage`; nothing about
-- a specific community or category is hard-coded in application logic.
--
-- Sources: "Host Communities in Indorama.docx", "Pipeline Communities
-- Structure.pdf", "Jetty Communities Structure.pdf", the brief (indirectly
-- impacted list) and the LOOKUP sheet of "Indorama_Grievance Tracker_2026.1".
-- =============================================================================

create table public.community_types (
  id           smallint generated always as identity primary key,
  code         text not null unique,
  name         text not null unique,
  has_clusters boolean not null default false,
  sort_order   smallint not null default 0,
  active       boolean not null default true
);

create table public.clusters (
  id                smallint generated always as identity primary key,
  community_type_id smallint not null references public.community_types(id),
  name              text not null,
  sort_order        smallint not null default 0,
  active            boolean not null default true,
  unique (community_type_id, name)
);

create table public.communities (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (length(btrim(name)) > 0),
  short_code text unique check (short_code ~ '^[A-Z0-9]{2,5}$'),  -- used in submission codes
  active     boolean not null default true,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A community can belong to more than one type (Akpajo is Host AND Pipeline
-- Cluster 1). Exactly one affiliation is primary; grievances default to it.
create table public.community_affiliations (
  id                smallint generated always as identity primary key,
  community_id      uuid not null references public.communities(id) on delete cascade,
  community_type_id smallint not null references public.community_types(id),
  cluster_id        smallint references public.clusters(id),
  is_primary        boolean not null default false,
  active            boolean not null default true,
  unique (community_id, community_type_id)
);
create unique index community_affiliations_one_primary
  on public.community_affiliations (community_id) where is_primary and active;

create or replace function app.check_affiliation() returns trigger
language plpgsql as $$
declare v_has_clusters boolean; v_cluster_type smallint;
begin
  select has_clusters into v_has_clusters from public.community_types where id = new.community_type_id;
  if v_has_clusters and new.cluster_id is null then
    raise exception 'cluster_required' using errcode = '23514';
  end if;
  if not v_has_clusters and new.cluster_id is not null then
    raise exception 'cluster_not_allowed' using errcode = '23514';
  end if;
  if new.cluster_id is not null then
    select community_type_id into v_cluster_type from public.clusters where id = new.cluster_id;
    if v_cluster_type <> new.community_type_id then
      raise exception 'cluster_type_mismatch' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger community_affiliations_check before insert or update on public.community_affiliations
  for each row execute function app.check_affiliation();

-- Legacy / alternative spellings, matched after normalisation (lowercase,
-- letters and digits only). Used by the importer and by staff search.
create table public.community_aliases (
  alias_norm   text primary key,
  alias        text not null,
  community_id uuid not null references public.communities(id) on delete cascade,
  note         text
);

create or replace function app.norm_key(p text) returns text
language sql immutable as $$ select regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]', '', 'g') $$;

-- Resolved classification of a community (primary, or a specific type).
create or replace function app.community_classification(p_community uuid, p_type smallint default null)
returns table (community_type_id smallint, cluster_id smallint)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.community_type_id, a.cluster_id
  from public.community_affiliations a
  where a.community_id = p_community and a.active
    and (case when p_type is null then a.is_primary else a.community_type_id = p_type end)
  limit 1
$$;

-- ---- seed: types and clusters -------------------------------------------------
insert into public.community_types (code, name, has_clusters, sort_order) values
  ('HOST',     'Host',                false, 1),
  ('PIPELINE', 'Pipeline',            true,  2),
  ('INDIRECT', 'Indirectly Impacted', false, 3),
  ('JETTY',    'Jetty',               false, 4);

insert into public.clusters (community_type_id, name, sort_order)
select t.id, 'Cluster ' || n, n from public.community_types t, generate_series(1, 5) n where t.code = 'PIPELINE';

-- ---- seed: communities ---------------------------------------------------------
-- NOTE: the pipeline structure states 32 communities but names 31. The 32nd is
-- intentionally NOT invented; an administrator adds it once confirmed.
with src(name, short_code, type_code, cluster_no, is_primary) as (values
  -- Host (6)
  ('Okerewa','OKR','HOST',null,true), ('Njuru','NJR','HOST',null,true), ('Nwakohu','NWK','HOST',null,true),
  ('Agbonchia','AGB','HOST',null,true), ('Aleto','ALT','HOST',null,true), ('Akpajo','AKP','HOST',null,true),
  -- Pipeline cluster 1 (Akpajo's pipeline affiliation is added below as non-primary)
  ('Rumuokruoshi','RMK','PIPELINE',1,true), ('Atali','ATL','PIPELINE',1,true), ('Elelenwo','ELE','PIPELINE',1,true),
  -- cluster 2
  ('Abara','ABR','PIPELINE',2,true), ('Umuecheme','UMC','PIPELINE',2,true), ('Chokocho','CHK','PIPELINE',2,true),
  ('Umuakuru','UMK','PIPELINE',2,true), ('Edegelem','EDG','PIPELINE',2,true), ('Imeh','IMH','PIPELINE',2,true),
  ('Umuogodo','UMG','PIPELINE',2,true),
  -- cluster 3
  ('Ipo','IPO','PIPELINE',3,true), ('Omadame','OMD','PIPELINE',3,true), ('Ozuoha','OZH','PIPELINE',3,true),
  ('Ubima','UBM','PIPELINE',3,true), ('Omerelu','OMR','PIPELINE',3,true), ('Omuanwa','OMW','PIPELINE',3,true),
  -- cluster 4 (names exactly as supplied, including "Awarra (11)")
  ('Awarra (1)','AWR1','PIPELINE',4,true), ('Awarra (11)','AWR11','PIPELINE',4,true), ('Akanu','AKN','PIPELINE',4,true),
  ('Assa','ASA','PIPELINE',4,true), ('Ochia','OCH','PIPELINE',4,true),
  -- cluster 5
  ('Omoku I','OMK1','PIPELINE',5,true), ('Omoku II','OMK2','PIPELINE',5,true), ('Obor','OBR','PIPELINE',5,true),
  ('Okprukpuali','OKP','PIPELINE',5,true), ('Obrikom','OBK','PIPELINE',5,true), ('Uju','UJU','PIPELINE',5,true),
  ('Okansu','OKS','PIPELINE',5,true), ('Egbogoro','EGG','PIPELINE',5,true), ('Egbeda','EGB','PIPELINE',5,true),
  -- Indirectly impacted (10). Rumuokwurusi is NOT Rumuokruoshi.
  ('Rumuokwurusi','RMW','INDIRECT',null,true), ('Alesa','ALS','INDIRECT',null,true), ('Alode','ALD','INDIRECT',null,true),
  ('Ogale','OGL','INDIRECT',null,true), ('Iriebe','IRB','INDIRECT',null,true), ('Umuebule','UMB','INDIRECT',null,true),
  ('Ebubu','EBB','INDIRECT',null,true), ('Okujagu','OKJ','INDIRECT',null,true), ('Abam-ama','ABM','INDIRECT',null,true),
  ('Woji','WOJ','INDIRECT',null,true),
  -- Jetty (2)
  ('Onne','ONN','JETTY',null,true), ('Ogu','OGU','JETTY',null,true)
), ins as (
  insert into public.communities (name, short_code) select name, short_code from src returning id, name
)
insert into public.community_affiliations (community_id, community_type_id, cluster_id, is_primary)
select ins.id, t.id, c.id, src.is_primary
from src join ins on ins.name = src.name
join public.community_types t on t.code = src.type_code
left join public.clusters c on c.community_type_id = t.id and c.sort_order = src.cluster_no;

-- Akpajo: second affiliation, Pipeline Cluster 1 (Host stays primary).
insert into public.community_affiliations (community_id, community_type_id, cluster_id, is_primary)
select cm.id, t.id, c.id, false
from public.communities cm, public.community_types t, public.clusters c
where cm.name = 'Akpajo' and t.code = 'PIPELINE' and c.community_type_id = t.id and c.name = 'Cluster 1';

insert into public.community_aliases (alias_norm, alias, community_id, note)
select app.norm_key(a.alias), a.alias, c.id, a.note
from (values
  ('Wakohu',         'Nwakohu', 'Spelling used in the historical trackers'),
  ('Wakohu Family',  'Nwakohu', 'Family group within Nwakohu (2019–2021 records)'),
  ('Rumuwakohu',     'Nwakohu', null),
  ('Njuru/Akpakpan', 'Njuru',   'Njuru and its Akpakpan compound (2019–2021 records)'),
  ('Akpakpan',       'Njuru',   null)
) a(alias, canonical, note)
join public.communities c on c.name = a.canonical;

alter table public.profiles
  add constraint profiles_community_fk foreign key (community_id) references public.communities(id);

-- -----------------------------------------------------------------------------
-- Categories. `name` is the official label used in reports; `public_label`
-- is the plain-language label shown to community members, with an icon key.
-- -----------------------------------------------------------------------------
create table public.grievance_categories (
  id           smallint generated always as identity primary key,
  name         text not null unique,
  public_label text not null,
  public_hint  text,
  icon         text,
  sort_order   smallint not null default 0,
  active       boolean not null default true
);

create table public.grievance_subcategories (
  id          smallint generated always as identity primary key,
  category_id smallint not null references public.grievance_categories(id),
  name        text not null unique,
  sort_order  smallint not null default 0,
  active      boolean not null default true
);

insert into public.grievance_categories (name, public_label, public_hint, icon, sort_order) values
  ('Employment & Economic Inclusion', 'Jobs & business', 'Employment, contracts, small businesses, training placements', 'briefcase', 1),
  ('Corporate Social Responsibility (CSR) & Community Engagement', 'Community projects', 'CSR projects, sponsorships, how the company engages the community', 'handshake', 2),
  ('Infrastructure & Public Services', 'Roads, water & light', 'Roads, electricity, water, street lights, sanitation, housing', 'road', 3),
  ('Education & Youth Development', 'School & youth', 'Scholarships, skills training, youth programmes', 'graduation', 4),
  ('Health & Social Welfare', 'Health & welfare', 'Health care, welfare packages, support for families', 'heart', 5),
  ('Governance & Representation', 'Leadership & fairness', 'Representation, equity shares, royalties, leaders'' welfare', 'people', 6),
  ('Environmental Impact', 'Environment & pollution', 'Air or water pollution, damage to land or heritage', 'leaf', 7),
  ('Operational Impact', 'Company operations', 'Traffic, road blockage or disturbance from plant operations', 'factory', 8);

insert into public.grievance_subcategories (category_id, name, sort_order)
select c.id, s.name, s.ord
from (values
  (1,  'Poor Road Infrastructure and Commuting Difficulties', 'Infrastructure & Public Services'),
  (2,  'Inadequate Employment Opportunities for Youth', 'Employment & Economic Inclusion'),
  (3,  'Lack of Quality Healthcare Services', 'Health & Social Welfare'),
  (4,  'Insufficient Street Lighting and Community Safety', 'Infrastructure & Public Services'),
  (5,  'Dangerous Road Conditions Leading to Accidents', 'Infrastructure & Public Services'),
  (6,  'Unemployment and Scarcity of Job Opportunities', 'Employment & Economic Inclusion'),
  (7,  'Unfair Job Sharing Practices', 'Employment & Economic Inclusion'),
  (8,  'Lack of Representation in Decision-Making Processes', 'Governance & Representation'),
  (9,  'Air and Water Pollution', 'Environmental Impact'),
  (10, 'Insufficient Corporate Social Responsibility (CSR) Initiatives', 'Corporate Social Responsibility (CSR) & Community Engagement'),
  (11, 'Lack of Educational Scholarships for Youth', 'Education & Youth Development'),
  (12, 'Poor Electrical Infrastructure and Unstable Power Supply', 'Infrastructure & Public Services'),
  (13, 'Inadequate Training Opportunities for Community Children', 'Education & Youth Development'),
  (14, 'Sale of Community Job Opportunities', 'Employment & Economic Inclusion'),
  (15, 'Cancellation of Sponsored Community Events', 'Corporate Social Responsibility (CSR) & Community Engagement'),
  (16, 'Support for Women and Families', 'Health & Social Welfare'),
  (17, 'Lack of Representation in Indorama Community Relations', 'Governance & Representation'),
  (18, 'Poor Handling of Legal Matters in Host Communities', 'Governance & Representation'),
  (19, 'Need for Youth Volunteer and Empowerment Programs', 'Education & Youth Development'),
  (20, 'Unfair Equity Shares and Distribution', 'Governance & Representation'),
  (21, 'Lack of Access to Clean Water', 'Infrastructure & Public Services'),
  (22, 'Poor Waste Management and Sanitation', 'Infrastructure & Public Services'),
  (23, 'Insufficient Public Transportation Services', 'Infrastructure & Public Services'),
  (24, 'High Cost of Living and Financial Strain on Residents', 'Health & Social Welfare'),
  (25, 'Lack of Recreational Facilities for Youth and Adults', 'Education & Youth Development'),
  (26, 'Inadequate Support for Small Businesses', 'Employment & Economic Inclusion'),
  (27, 'Limited Access to Affordable Housing', 'Infrastructure & Public Services'),
  (28, 'Lack of Mental Health Support Services', 'Health & Social Welfare'),
  (29, 'Low Community Involvement in Company Decisions', 'Governance & Representation'),
  (30, 'Neglect of Cultural and Historical Preservation Efforts', 'Environmental Impact'),
  (31, 'Equitable Distribution of CSR Benefits', 'Corporate Social Responsibility (CSR) & Community Engagement'),
  (32, 'Collaboration Between Indorama and Stakeholders', 'Corporate Social Responsibility (CSR) & Community Engagement'),
  (33, 'Lack of Industrial Training Placements for Students', 'Employment & Economic Inclusion'),
  (34, 'Road Blockage and Congestion Due to Indorama Operations', 'Operational Impact'),
  (35, 'Insufficient Reach of Corporate Social Responsibility (CSR) Initiatives', 'Corporate Social Responsibility (CSR) & Community Engagement'),
  (36, 'Lack of Communication of Job Openings', 'Employment & Economic Inclusion'),
  (37, 'Preference of Non Eleme Contractors/Workers Over Eleme Contractors/Workers', 'Employment & Economic Inclusion'),
  (38, 'Employment Progression & Inclusion', 'Employment & Economic Inclusion'),
  (39, 'Recognition and Inclusion of Pipeline Communities', 'Governance & Representation'),
  (40, 'Inadequate Community Development Projects', 'Infrastructure & Public Services'),
  (41, 'Poor Quality or Value of Community Welfare Packages', 'Health & Social Welfare'),
  (42, 'Non-Payment of Community Royalty and Traditional Entitlements', 'Governance & Representation'),
  (43, 'Poor Implementation and Funding of CSR Projects', 'Corporate Social Responsibility (CSR) & Community Engagement'),
  (44, 'Lack of Support for Community Contractors', 'Employment & Economic Inclusion'),
  (45, 'Inadequate Skill Acquisition and Workforce Absorption', 'Education & Youth Development'),
  (46, 'Limited Beneficiaries of Grants and Empowerment Programs', 'Education & Youth Development'),
  (47, 'Poor Community Relations and Stakeholder Engagement', 'Corporate Social Responsibility (CSR) & Community Engagement'),
  (48, 'Compensation and Welfare of Community and Cluster leaders', 'Governance & Representation')
) s(ord, name, category)
join public.grievance_categories c on c.name = s.category;

-- -----------------------------------------------------------------------------
-- Statuses. Staff see `staff_label`; community members only ever see
-- `public_label` / `public_message` (internal stages collapse into plain ones).
-- -----------------------------------------------------------------------------
create table public.grievance_statuses (
  id             smallint generated always as identity primary key,
  code           text not null unique,
  staff_label    text not null,
  public_label   text not null,
  public_message text not null,
  is_open        boolean not null,    -- counts as outstanding
  stops_sla      boolean not null,    -- the SLA clock stops in this status
  sort_order     smallint not null,
  icon           text,
  tone           text not null default 'neutral' check (tone in ('neutral','info','progress','warning','success','muted')),
  active         boolean not null default true
);

insert into public.grievance_statuses (code, staff_label, public_label, public_message, is_open, stops_sla, sort_order, icon, tone) values
  ('SUBMITTED',       'Submitted',       'Received',     'Your grievance has been received.',            true,  false, 1, 'inbox',    'info'),
  ('UNDER_REVIEW',    'Under Review',    'Under review', 'Our team is reviewing your grievance.',        true,  false, 2, 'search',   'info'),
  ('ASSIGNED',        'Assigned',        'Under review', 'Our team is reviewing your grievance.',        true,  false, 3, 'user',     'info'),
  ('IN_PROGRESS',     'In Progress',     'In progress',  'Action is being taken.',                       true,  false, 4, 'progress', 'progress'),
  ('AWAITING_ACTION', 'Awaiting Action', 'In progress',  'Action is being taken.',                       true,  false, 5, 'clock',    'warning'),
  ('RESOLVED',        'Resolved',        'Resolved',     'Your grievance has been resolved.',            false, true,  6, 'check',    'success'),
  ('CLOSED',          'Closed',          'Closed',       'This grievance has been closed.',              false, true,  7, 'lock',     'muted'),
  ('REOPENED',        'Reopened',        'Reopened',     'We are looking at your grievance again.',      true,  false, 8, 'refresh',  'warning');

-- Allowed moves for change_grievance_status(). RESOLVED is reached only via
-- resolve_grievance() (it needs resolution details); REOPENED via a dispute or
-- an explicit reopen.
create table public.grievance_status_transitions (
  from_status_id smallint not null references public.grievance_statuses(id),
  to_status_id   smallint not null references public.grievance_statuses(id),
  required_permission text not null references public.permissions(code) default 'grievance.update_status',
  primary key (from_status_id, to_status_id)
);

insert into public.grievance_status_transitions (from_status_id, to_status_id, required_permission)
select f.id, t.id, x.perm
from (values
  ('SUBMITTED','UNDER_REVIEW','grievance.update_status'), ('SUBMITTED','ASSIGNED','grievance.update_status'),
  ('SUBMITTED','IN_PROGRESS','grievance.update_status'),
  ('UNDER_REVIEW','ASSIGNED','grievance.update_status'), ('UNDER_REVIEW','IN_PROGRESS','grievance.update_status'),
  ('UNDER_REVIEW','AWAITING_ACTION','grievance.update_status'),
  ('ASSIGNED','UNDER_REVIEW','grievance.update_status'), ('ASSIGNED','IN_PROGRESS','grievance.update_status'),
  ('ASSIGNED','AWAITING_ACTION','grievance.update_status'),
  ('IN_PROGRESS','AWAITING_ACTION','grievance.update_status'), ('AWAITING_ACTION','IN_PROGRESS','grievance.update_status'),
  ('REOPENED','UNDER_REVIEW','grievance.update_status'), ('REOPENED','IN_PROGRESS','grievance.update_status'),
  ('REOPENED','AWAITING_ACTION','grievance.update_status'),
  ('RESOLVED','CLOSED','grievance.close'),
  ('RESOLVED','REOPENED','grievance.update_status'), ('CLOSED','REOPENED','grievance.close')
) x(f, t, perm)
join public.grievance_statuses f on f.code = x.f
join public.grievance_statuses t on t.code = x.t;

create table public.severities (
  id         smallint generated always as identity primary key,
  code       text not null unique,
  name       text not null unique,
  sort_order smallint not null,
  tone       text not null default 'neutral',
  active     boolean not null default true
);
insert into public.severities (code, name, sort_order, tone) values
  ('LOW', 'Low', 1, 'neutral'), ('MEDIUM', 'Medium', 2, 'warning'), ('HIGH', 'High', 3, 'danger');

-- Public holidays for the working-day SLA clock (maintained by admins).
create table public.holidays (
  day  date primary key,
  name text not null
);

-- A version stamp clients use to know when to refresh cached master data.
create table public.master_data_version (
  id         boolean primary key default true check (id),
  version    bigint not null default 1,
  updated_at timestamptz not null default now()
);
insert into public.master_data_version default values;

create or replace function app.bump_master_data_version() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.master_data_version set version = version + 1, updated_at = now();
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['community_types','clusters','communities','community_affiliations','community_aliases',
                           'grievance_categories','grievance_subcategories','grievance_statuses',
                           'grievance_status_transitions','severities','holidays']
  loop
    execute format('create trigger %1$s_version after insert or update or delete on public.%1$s
                    for each statement execute function app.bump_master_data_version()', t);
    execute format('create trigger %1$s_audit after insert or update or delete on public.%1$s
                    for each row execute function app.audit_row()', t);
  end loop;
end $$;

create trigger communities_touch before update on public.communities for each row execute function app.touch_updated_at();

-- ============================== 20260923000300_grievances.sql
-- =============================================================================
-- Grievances (central entity), workflow history tables, officer scopes,
-- tracking IDs and the SLA (working-day) clock.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Officer responsibility. A scope row matches by community, by cluster, or by
-- community type (most specific wins for auto-assignment). Seeded officers:
--   Godpower Jaka       -> HOST, PIPELINE
--   Godwin Bebe-Okpabi  -> INDIRECT
--   Esther Walter Anga  -> JETTY
-- Their accounts are created by the Super Admin (see docs); scopes are then
-- set with admin_set_officer_scopes().
-- -----------------------------------------------------------------------------
create table public.officer_scopes (
  id                smallint generated always as identity primary key,
  officer_id        uuid not null references public.profiles(id) on delete cascade,
  community_type_id smallint references public.community_types(id),
  cluster_id        smallint references public.clusters(id),
  community_id      uuid references public.communities(id),
  auto_assign       boolean not null default true,
  created_at        timestamptz not null default now(),
  created_by        uuid,
  check (num_nonnulls(community_type_id, cluster_id, community_id) = 1)
);
create unique index officer_scopes_unique on public.officer_scopes
  (officer_id, coalesce(community_type_id, 0), coalesce(cluster_id, 0), coalesce(community_id, '00000000-0000-0000-0000-000000000000'));
create index officer_scopes_type_idx on public.officer_scopes (community_type_id);
create index officer_scopes_cluster_idx on public.officer_scopes (cluster_id);
create index officer_scopes_comm_idx on public.officer_scopes (community_id);
create trigger officer_scopes_audit after insert or update or delete on public.officer_scopes
  for each row execute function app.audit_row();

create or replace function app.in_officer_scope(p_officer uuid, p_community uuid, p_type smallint, p_cluster smallint)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.officer_scopes s
    where s.officer_id = p_officer
      and (s.community_id = p_community
           or s.cluster_id = p_cluster
           or s.community_type_id = p_type))
$$;

-- -----------------------------------------------------------------------------
-- Tracking IDs: IPL-GRV-2026-000123 (live) and IPL-GRV-2019-H00012 (history).
-- Counter rows are locked by the upsert, so concurrent submissions serialise
-- on the year's counter and can never receive the same number; the UNIQUE
-- constraint on grievances.tracking_id is the final guarantee.
-- -----------------------------------------------------------------------------
create table public.tracking_counters (
  year       int  not null,
  series     text not null check (series in ('live','legacy')),
  last_value int  not null,
  primary key (year, series)
);

create or replace function app.next_tracking_id(p_year int, p_legacy boolean default false) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v int; s text := case when p_legacy then 'legacy' else 'live' end;
begin
  insert into public.tracking_counters as c (year, series, last_value) values (p_year, s, 1)
  on conflict (year, series) do update set last_value = c.last_value + 1
  returning last_value into v;
  return case when p_legacy then format('IPL-GRV-%s-H%s', p_year, lpad(v::text, 5, '0'))
              else format('IPL-GRV-%s-%s', p_year, lpad(v::text, 6, '0')) end;
end $$;

-- -----------------------------------------------------------------------------
-- SLA clock. Working days = ISO weekdays in settings.sla_work_days minus
-- public.holidays, evaluated in the operational time zone.
-- A clock that starts on a non-working day starts at 00:00 on the next
-- working day. Due = start + N working days at the same local time.
-- -----------------------------------------------------------------------------
create or replace function app.is_working_day(p_day date) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select extract(isodow from p_day)::int in (select jsonb_array_elements_text(app.setting('sla_work_days'))::int)
     and not exists (select 1 from public.holidays h where h.day = p_day)
$$;

create or replace function app.sla_due_at(p_start timestamptz) returns timestamptz
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  tz text := app.tz();
  n int := coalesce((app.setting('sla_threshold_days'))::int, 3);
  mode text := coalesce(app.setting('sla_clock') #>> '{}', 'working_days');
  local_ts timestamp := p_start at time zone tz;
  d date := local_ts::date;
  t time := local_ts::time;
  i int := 0;
begin
  if p_start is null then return null; end if;
  if mode = 'calendar_days' then return p_start + make_interval(days => n); end if;
  if not app.is_working_day(d) then
    t := '00:00';
    loop d := d + 1; exit when app.is_working_day(d); end loop;
  end if;
  while i < n loop
    d := d + 1;
    if app.is_working_day(d) then i := i + 1; end if;
  end loop;
  return (d + t) at time zone tz;
end $$;

-- Whole days outstanding on the configured clock (for "unresolved for 4 days").
create or replace function app.days_outstanding(p_start timestamptz, p_end timestamptz default now()) returns int
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  tz text := app.tz();
  mode text := coalesce(app.setting('sla_clock') #>> '{}', 'working_days');
  d date; e date; n int := 0;
begin
  if p_start is null then return null; end if;
  d := (p_start at time zone tz)::date; e := (p_end at time zone tz)::date;
  if mode = 'calendar_days' then return greatest(e - d, 0); end if;
  while d < e loop
    d := d + 1;
    if app.is_working_day(d) then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- -----------------------------------------------------------------------------
-- Grievances
-- -----------------------------------------------------------------------------
create table public.grievances (
  id                        uuid primary key default gen_random_uuid(),
  tracking_id               text not null unique,
  client_submission_id      uuid unique,               -- idempotency key from the device
  origin                    text not null check (origin in ('app','assisted','paper','legacy_import')),
  is_legacy                 boolean not null default false,
  legacy_needs_review       boolean not null default false,  -- legacy open items: no alerts until reviewed

  -- dates
  date_received             date not null,
  date_received_precision   text not null default 'day' check (date_received_precision in ('day','month','year')),
  submitted_at              timestamptz,               -- when the IPL system received it (null for legacy)
  client_created_at         timestamptz,               -- when the draft was written on the device
  form_issued_date          date,
  review_date               date,
  review_date_precision     text check (review_date_precision in ('day','month','year')),
  first_response_at         timestamptz,
  resolved_at               timestamptz,
  closed_at                 timestamptz,
  year                      int generated always as (extract(year from date_received)::int) stored,

  -- complainant (snapshot at submission; legacy and paper records have no account)
  complainant_user_id       uuid references public.profiles(id) on delete set null,
  complainant_name          text,
  complainant_gender        text check (complainant_gender in ('male','female')),
  complainant_phone         text,
  complainant_email         text,
  complainant_address       text,

  -- community (type and cluster are derived, never typed)
  community_id              uuid references public.communities(id),
  community_type_id         smallint references public.community_types(id),
  cluster_id                smallint references public.clusters(id),

  -- the grievance
  title                     text,
  category_id               smallint references public.grievance_categories(id),
  subcategory_id            smallint references public.grievance_subcategories(id),
  severity_id               smallint references public.severities(id),
  description               text not null,
  incident_details          text,
  desired_resolution        text,
  suggestions               text,
  text_amended              boolean not null default false,

  -- workflow
  status_id                 smallint not null references public.grievance_statuses(id),
  assigned_officer_id       uuid references public.profiles(id) on delete set null,
  responsibility            text,
  closure_officer_id        uuid references public.profiles(id) on delete set null,
  submission_code_id        uuid,                      -- FK added with submission_codes
  ack_state                 text not null default 'not_requested'
                              check (ack_state in ('not_requested','pending','acknowledged','disputed','not_captured')),

  -- SLA
  sla_started_at            timestamptz,
  sla_due_at                timestamptz,
  overdue_since             timestamptz,
  last_overdue_alert_at     timestamptz,

  -- legacy / provenance (the original Excel values, verbatim)
  legacy_tracking_id        text,
  legacy_tracking_id_norm   text generated always as (upper(regexp_replace(legacy_tracking_id, '\s', '', 'g'))) stored,
  legacy_category           text,
  legacy_subcategory        text,
  legacy_status             text,
  legacy_severity           text,
  legacy_community          text,
  legacy_community_category text,
  legacy_community_type     text,
  legacy_responsibility     text,
  legacy_closure_officer    text,
  source_workbook           text,
  source_sheet              text,
  source_row                int,
  source_year               int,
  import_batch_id           uuid,

  -- lifecycle
  created_at                timestamptz not null default now(),
  created_by                uuid,
  updated_at                timestamptz not null default now(),
  archived_at               timestamptz,
  archived_by               uuid,
  archive_reason            text,

  search_tsv tsvector generated always as (
    to_tsvector('english', coalesce(title,'') || ' ' || description || ' ' ||
                coalesce(desired_resolution,'') || ' ' || coalesce(incident_details,''))) stored,

  check (length(btrim(description)) > 0),
  check (complainant_phone is null or complainant_phone ~ '^\+234[789][01][0-9]{8}$')
);

create index grievances_status_officer_idx on public.grievances (status_id, assigned_officer_id) where archived_at is null;
create index grievances_officer_idx        on public.grievances (assigned_officer_id) where archived_at is null;
create index grievances_community_idx      on public.grievances (community_id, date_received);
create index grievances_class_idx          on public.grievances (community_type_id, cluster_id);
create index grievances_category_idx       on public.grievances (category_id, subcategory_id);
create index grievances_year_idx           on public.grievances (year);
create index grievances_received_idx       on public.grievances (date_received desc);
create index grievances_complainant_idx    on public.grievances (complainant_user_id, updated_at desc);
create index grievances_sla_idx            on public.grievances (sla_due_at) where resolved_at is null and archived_at is null;
create index grievances_legacy_id_idx      on public.grievances (legacy_tracking_id_norm);
create index grievances_tsv_idx            on public.grievances using gin (search_tsv);
create index grievances_tracking_trgm      on public.grievances using gin (tracking_id extensions.gin_trgm_ops);
create index grievances_legacy_trgm        on public.grievances using gin (legacy_tracking_id_norm extensions.gin_trgm_ops);
create index grievances_name_trgm          on public.grievances using gin (complainant_name extensions.gin_trgm_ops);
create index grievances_phone_trgm         on public.grievances using gin (complainant_phone extensions.gin_trgm_ops);

-- Classification snapshot + consistency checks.
create or replace function app.grievance_before_write() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_sub_cat smallint; v_type smallint; v_cluster smallint; v_req smallint;
begin
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.tracking_id <> old.tracking_id then
      raise exception 'immutable_identifier' using errcode = '42501';
    end if;
    -- The complainant's own words are never silently changed.
    if (new.description, new.incident_details, new.desired_resolution, new.suggestions)
       is distinct from (old.description, old.incident_details, old.desired_resolution, old.suggestions)
       and coalesce(current_setting('app.allow_text_amend', true), '') <> 'on' then
      raise exception 'original_text_is_protected' using errcode = '42501';
    end if;
  end if;

  -- Derive type/cluster from the community master: the primary affiliation,
  -- unless one of the community's other affiliations is explicitly requested
  -- (e.g. staff reclassifying an Akpajo grievance as Pipeline / Cluster 1).
  if new.community_id is not null
     and (tg_op = 'INSERT' or new.community_id is distinct from old.community_id
          or new.community_type_id is distinct from old.community_type_id
          or new.cluster_id is distinct from old.cluster_id) then
    v_req := case when tg_op = 'INSERT' or new.community_type_id is distinct from old.community_type_id
                  then new.community_type_id end;
    select c.community_type_id, c.cluster_id into v_type, v_cluster
    from app.community_classification(new.community_id, v_req) c;
    if not found then
      raise exception '%', case when v_req is null then 'community_unclassified' else 'invalid_affiliation' end
        using errcode = '23514';
    end if;
    new.community_type_id := v_type;
    new.cluster_id := v_cluster;
  elsif new.community_id is null and not new.is_legacy then
    raise exception 'community_required' using errcode = '23514';
  end if;

  if new.subcategory_id is not null then
    select category_id into v_sub_cat from public.grievance_subcategories where id = new.subcategory_id;
    if new.category_id is null then new.category_id := v_sub_cat;
    elsif new.category_id <> v_sub_cat then raise exception 'subcategory_mismatch' using errcode = '23514';
    end if;
  end if;

  if tg_op = 'INSERT' and new.sla_started_at is null and new.submitted_at is not null then
    new.sla_started_at := new.submitted_at;
  end if;
  if new.sla_started_at is distinct from (case when tg_op = 'UPDATE' then old.sla_started_at end) then
    new.sla_due_at := app.sla_due_at(new.sla_started_at);
  end if;

  new.updated_at := now();
  return new;
end $$;

create trigger grievances_before_write before insert or update on public.grievances
  for each row execute function app.grievance_before_write();
create trigger grievances_audit after insert or update or delete on public.grievances
  for each row execute function app.audit_row();

-- Recompute open deadlines when holidays or clock settings change.
create or replace function app.recompute_open_sla() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.grievances g set sla_due_at = app.sla_due_at(g.sla_started_at)
  from public.grievance_statuses s
  where s.id = g.status_id and not s.stops_sla and g.sla_started_at is not null and g.archived_at is null;
  return null;
end $$;
create trigger holidays_recompute_sla after insert or update or delete on public.holidays
  for each statement execute function app.recompute_open_sla();
create trigger settings_recompute_sla after update on public.settings
  for each row when (new.key in ('sla_threshold_days','sla_clock','sla_work_days','timezone'))
  execute function app.recompute_open_sla();

-- -----------------------------------------------------------------------------
-- Workflow history
-- -----------------------------------------------------------------------------
create table public.grievance_status_history (
  id                     bigint generated always as identity primary key,
  grievance_id           uuid not null references public.grievances(id) on delete cascade,
  from_status_id         smallint references public.grievance_statuses(id),
  to_status_id           smallint not null references public.grievance_statuses(id),
  changed_by             uuid,
  changed_at             timestamptz not null default now(),
  note                   text,
  visible_to_complainant boolean not null default true
);
create index grievance_status_history_g_idx on public.grievance_status_history (grievance_id, changed_at);

create table public.grievance_assignments (
  id            bigint generated always as identity primary key,
  grievance_id  uuid not null references public.grievances(id) on delete cascade,
  officer_id    uuid references public.profiles(id) on delete set null,
  assigned_by   uuid,
  assigned_at   timestamptz not null default now(),
  unassigned_at timestamptz,
  reason        text
);
create index grievance_assignments_g_idx on public.grievance_assignments (grievance_id, assigned_at);

create table public.grievance_comments (
  id           bigint generated always as identity primary key,
  grievance_id uuid not null references public.grievances(id) on delete cascade,
  author_id    uuid,
  kind         text not null default 'remark' check (kind in ('remark','officer_remark','question','reply','system')),
  visibility   text not null default 'internal' check (visibility in ('internal','complainant')),
  body         text not null check (length(btrim(body)) > 0),
  created_at   timestamptz not null default now()
);
create index grievance_comments_g_idx on public.grievance_comments (grievance_id, created_at);

create table public.grievance_actions (
  id           bigint generated always as identity primary key,
  grievance_id uuid not null references public.grievances(id) on delete cascade,
  action_type  text not null default 'action' check (action_type in ('action','management_action','field_visit','meeting','referral','call')),
  description  text not null check (length(btrim(description)) > 0),
  action_date  date,
  action_date_precision text not null default 'day' check (action_date_precision in ('day','month','year')),
  created_by   uuid,
  created_at   timestamptz not null default now()
);
create index grievance_actions_g_idx on public.grievance_actions (grievance_id, created_at);

create table public.grievance_resolutions (
  id             bigint generated always as identity primary key,
  grievance_id   uuid not null references public.grievances(id) on delete cascade,
  details        text not null check (length(btrim(details)) > 0),
  public_summary text,
  resolved_by    uuid,
  resolved_at    timestamptz not null default now(),
  is_current     boolean not null default true
);
create unique index grievance_resolutions_current on public.grievance_resolutions (grievance_id) where is_current;

create table public.grievance_acknowledgements (
  id           bigint generated always as identity primary key,
  grievance_id uuid not null references public.grievances(id) on delete cascade,
  resolution_id bigint references public.grievance_resolutions(id) on delete set null,
  response     text not null check (response in ('acknowledged','disputed')),
  reason       text,
  user_id      uuid,                    -- complainant (when self-service)
  recorded_by  uuid,                    -- staff member recording on their behalf
  channel      text not null default 'app' check (channel in ('app','phone','in_person','whatsapp','paper')),
  created_at   timestamptz not null default now(),
  check (response = 'acknowledged' or length(btrim(coalesce(reason, ''))) > 0)
);
create index grievance_acknowledgements_g_idx on public.grievance_acknowledgements (grievance_id, created_at);

create table public.attachments (
  id           uuid primary key default gen_random_uuid(),
  grievance_id uuid not null references public.grievances(id) on delete cascade,
  storage_path text not null unique,
  file_name    text not null,
  mime_type    text not null check (mime_type in ('image/jpeg','image/png','image/webp','application/pdf')),
  size_bytes   int not null check (size_bytes between 1 and 5242880),
  sha256       text,
  visibility   text not null default 'internal' check (visibility in ('internal','complainant')),
  uploaded_by  uuid,
  created_at   timestamptz not null default now()
);
create index attachments_g_idx on public.attachments (grievance_id);

create table public.grievance_flags (
  id           bigint generated always as identity primary key,
  grievance_id uuid not null references public.grievances(id) on delete cascade,
  flag         text not null check (flag in ('duplicate_candidate','id_collision','date_suspect','unmapped_value',
                                             'invalid_phone','community_unknown','needs_review','archive_requested')),
  detail       jsonb,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  resolved_at  timestamptz,
  resolved_by  uuid,
  resolution   text
);
create index grievance_flags_open_idx on public.grievance_flags (flag) where resolved_at is null;
create index grievance_flags_g_idx on public.grievance_flags (grievance_id);

do $$
declare t text;
begin
  foreach t in array array['grievance_assignments','grievance_resolutions','grievance_acknowledgements','attachments','grievance_flags']
  loop
    execute format('create trigger %1$s_audit after insert or update or delete on public.%1$s
                    for each row execute function app.audit_row()', t);
  end loop;
end $$;

-- Read check reused by child-table policies: evaluated as the caller, so the
-- grievances RLS policy decides.
create or replace function app.can_read_grievance(p_id uuid) returns boolean
language sql stable set search_path = public, pg_temp as $$
  select exists (select 1 from public.grievances where id = p_id)
$$;
grant execute on function app.can_read_grievance(uuid) to authenticated;

-- ============================== 20260923000400_notifications.sql
-- =============================================================================
-- Notifications: in-app items + a provider-agnostic delivery outbox.
--
-- Every outbound message (WhatsApp now; SMS/email later) is a row in
-- notification_deliveries. The `notify-dispatch` Edge Function claims queued
-- rows, calls the configured provider and reports back. Status only reaches
-- 'delivered'/'read' when the provider's webhook confirms it; nothing here
-- ever assumes success.
-- =============================================================================

create table public.notifications (
  id           bigint generated always as identity primary key,
  user_id      uuid references public.profiles(id) on delete cascade,  -- null: complainant without an account
  type         text not null check (type in (
                 'grievance_submitted','grievance_status_changed','grievance_resolved','acknowledgement_required',
                 'grievance_disputed','grievance_comment','officer_assigned','grievance_overdue','overdue_digest',
                 'submission_window_opened','submission_window_closed','archive_requested')),
  title        text not null,
  body         text not null,
  grievance_id uuid references public.grievances(id) on delete cascade,
  data         jsonb not null default '{}'::jsonb,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

create table public.notification_deliveries (
  id                  bigint generated always as identity primary key,
  notification_id     bigint not null references public.notifications(id) on delete cascade,
  channel             text not null check (channel in ('whatsapp','sms','email')),
  recipient           text not null,
  provider            text,
  template_name       text,
  template_params     jsonb,
  status              text not null default 'queued'
                        check (status in ('queued','sending','sent','delivered','read','failed','skipped')),
  provider_message_id text unique,
  attempts            smallint not null default 0,
  next_attempt_at     timestamptz not null default now(),
  last_error          text,
  sent_at             timestamptz,
  delivered_at        timestamptz,
  read_at             timestamptz,
  failed_at           timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index notification_deliveries_queue_idx on public.notification_deliveries (channel, next_attempt_at) where status = 'queued';
create index notification_deliveries_notif_idx on public.notification_deliveries (notification_id);
create trigger notification_deliveries_touch before update on public.notification_deliveries
  for each row execute function app.touch_updated_at();

-- Phone normaliser for Nigerian mobile numbers -> E.164 (+234XXXXXXXXXX) or null.
create or replace function app.normalize_phone(p text) returns text
language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if d ~ '^234[789][01][0-9]{8}$' then return '+' || d; end if;
  if d ~ '^0[789][01][0-9]{8}$'    then return '+234' || substr(d, 2); end if;
  if d ~ '^[789][01][0-9]{8}$'     then return '+234' || d; end if;
  return null;
end $$;

-- Create an in-app notification and, when asked, queue a WhatsApp delivery.
-- If WhatsApp is switched off the delivery is recorded as 'skipped' (honest
-- record, and no surprise backlog when it is switched on later).
create or replace function app.notify(
  p_user uuid, p_type text, p_title text, p_body text,
  p_grievance uuid default null, p_data jsonb default '{}'::jsonb,
  p_whatsapp_to text default null, p_template text default null, p_template_params jsonb default null
) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id bigint; v_phone text := app.normalize_phone(p_whatsapp_to); v_enabled boolean;
begin
  insert into public.notifications (user_id, type, title, body, grievance_id, data)
  values (p_user, p_type, p_title, p_body, p_grievance, coalesce(p_data, '{}'::jsonb))
  returning id into v_id;

  if v_phone is not null then
    v_enabled := coalesce((app.setting('whatsapp_enabled'))::boolean, false);
    insert into public.notification_deliveries (notification_id, channel, recipient, provider, template_name, template_params,
                                                status, last_error)
    values (v_id, 'whatsapp', v_phone, 'meta_cloud', p_template, p_template_params,
            case when v_enabled then 'queued' else 'skipped' end,
            case when v_enabled then null else 'whatsapp_disabled' end);
  end if;
  return v_id;
end $$;

-- ---- dispatcher API (service role only) --------------------------------------
create or replace function public.claim_notification_deliveries(p_channel text, p_limit int default 20)
returns setof public.notification_deliveries
language sql security definer set search_path = public, pg_temp as $$
  update public.notification_deliveries d
     set status = 'sending', attempts = d.attempts + 1
   where d.id in (select id from public.notification_deliveries
                  where status = 'queued' and channel = p_channel and next_attempt_at <= now()
                  order by next_attempt_at
                  limit greatest(p_limit, 1)
                  for update skip locked)
  returning d.*
$$;

-- Result of the provider API call (accepted or not). Accepted = 'sent', not delivered.
create or replace function public.report_notification_delivery(
  p_id bigint, p_ok boolean, p_provider_message_id text default null,
  p_error text default null, p_permanent boolean default false
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_attempts smallint;
begin
  select attempts into v_attempts from public.notification_deliveries where id = p_id and status = 'sending' for update;
  if not found then return; end if;
  if p_ok then
    update public.notification_deliveries
       set status = 'sent', provider_message_id = p_provider_message_id, sent_at = now(), last_error = null
     where id = p_id;
  elsif p_permanent or v_attempts >= 6 then
    update public.notification_deliveries set status = 'failed', failed_at = now(), last_error = p_error where id = p_id;
  else
    -- exponential backoff: 2, 4, 8, 16, 32 minutes
    update public.notification_deliveries
       set status = 'queued', last_error = p_error,
           next_attempt_at = now() + make_interval(mins => power(2, v_attempts)::int)
     where id = p_id;
  end if;
end $$;

-- Provider webhook (delivery receipts). Status only moves forward.
create or replace function public.apply_provider_status(
  p_provider_message_id text, p_status text, p_at timestamptz default now(), p_error text default null
) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_rank int; v_cur text;
begin
  select status into v_cur from public.notification_deliveries where provider_message_id = p_provider_message_id for update;
  if not found then return false; end if;
  v_rank := array_position(array['sending','sent','delivered','read'], v_cur);
  if p_status = 'failed' then
    if v_cur in ('sending','sent') then
      update public.notification_deliveries set status = 'failed', failed_at = p_at, last_error = p_error
       where provider_message_id = p_provider_message_id;
    end if;
  elsif array_position(array['sending','sent','delivered','read'], p_status) > coalesce(v_rank, 0) then
    update public.notification_deliveries
       set status = p_status,
           sent_at = coalesce(sent_at, p_at),
           delivered_at = case when p_status in ('delivered','read') then coalesce(delivered_at, p_at) else delivered_at end,
           read_at = case when p_status = 'read' then p_at else read_at end
     where provider_message_id = p_provider_message_id;
  end if;
  return true;
end $$;

-- ---- member / staff API --------------------------------------------------------
create or replace function public.my_notifications(p_since timestamptz default null, p_limit int default 50)
returns table (id bigint, type text, title text, body text, grievance_id uuid, data jsonb, read_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select n.id, n.type, n.title, n.body, n.grievance_id, n.data, n.read_at, n.created_at
  from public.notifications n
  where n.user_id = auth.uid() and (p_since is null or n.created_at > p_since)
  order by n.created_at desc
  limit least(greatest(p_limit, 1), 200)
$$;

create or replace function public.mark_notifications_read(p_ids bigint[] default null) returns int
language sql security definer set search_path = public, pg_temp as $$
  with u as (
    update public.notifications set read_at = now()
    where user_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids))
    returning 1)
  select count(*)::int from u
$$;

-- ============================== 20260923000500_submission.sql
-- =============================================================================
-- Accounts (sign-up hook, profile updates), submission codes, and grievance
-- submission (self-service and assisted/paper).
-- =============================================================================

-- ---- sign-up ------------------------------------------------------------------
-- Every self-registered account is a community member. Metadata from the
-- client is never trusted for roles; staff roles are granted by an admin.
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_comm uuid;
begin
  select id into v_comm from public.communities
  where active and id::text = m ->> 'community_id';

  insert into public.profiles (id, full_name, phone, email, community_id, address, gender)
  values (new.id,
          coalesce(nullif(btrim(m ->> 'full_name'), ''), 'Community member'),
          app.normalize_phone(coalesce(new.phone, m ->> 'phone')),
          -- Members sign in with a phone mapped to a login-only address; that address
          -- is not their email. Staff accounts use their real email.
          case when m ? 'phone' then nullif(btrim(m ->> 'email'), '') else coalesce(new.email, nullif(btrim(m ->> 'email'), '')) end,
          v_comm,
          nullif(btrim(m ->> 'address'), ''),
          case when m ->> 'gender' in ('male','female') then m ->> 'gender' end);

  insert into public.user_roles (user_id, role_id)
  select new.id, id from public.roles where code = 'community_member';
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

create or replace function public.update_my_profile(p jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_comm uuid;
begin
  if auth.uid() is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if p ? 'community_id' then
    select id into v_comm from public.communities where active and id::text = p ->> 'community_id';
    if v_comm is null then raise exception 'community_invalid' using errcode = '22023'; end if;
  end if;
  update public.profiles set
    full_name    = case when p ? 'full_name' then nullif(btrim(p ->> 'full_name'), '') else full_name end,
    community_id = case when p ? 'community_id' then v_comm else community_id end,
    email        = case when p ? 'email' then nullif(btrim(p ->> 'email'), '') else email end,
    address      = case when p ? 'address' then nullif(btrim(p ->> 'address'), '') else address end,
    gender       = case when p ? 'gender' then nullif(p ->> 'gender', '') else gender end
  where id = auth.uid();
end $$;

create or replace function public.my_profile() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', p.id, 'full_name', p.full_name, 'phone', p.phone, 'email', p.email, 'address', p.address,
    'gender', p.gender, 'community_id', p.community_id, 'community_name', c.name, 'is_active', p.is_active)
  from public.profiles p left join public.communities c on c.id = p.community_id
  where p.id = auth.uid()
$$;

-- ---- submission codes ------------------------------------------------------------
create table public.submission_codes (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique check (code ~ '^[A-Z0-9]{2,5}-[0-9]{4}-[0-9]{4}-[A-Z0-9]{4}$'),
  label               text,
  scope_type          text not null check (scope_type in ('all','community_type','cluster','community')),
  community_type_id   smallint references public.community_types(id),
  cluster_id          smallint references public.clusters(id),
  community_id        uuid references public.communities(id),
  valid_from          timestamptz not null,
  valid_until         timestamptz not null,
  max_submissions     int check (max_submissions is null or max_submissions > 0),
  submission_count    int not null default 0,
  status              text not null default 'draft' check (status in ('draft','active','deactivated')),
  created_by          uuid,
  created_at          timestamptz not null default now(),
  released_by         uuid,
  released_at         timestamptz,
  deactivated_by      uuid,
  deactivated_at      timestamptz,
  deactivation_reason text,
  check (valid_until > valid_from),
  check ((scope_type = 'all'            and num_nonnulls(community_type_id, cluster_id, community_id) = 0)
      or (scope_type = 'community_type' and community_type_id is not null and cluster_id is null and community_id is null)
      or (scope_type = 'cluster'        and cluster_id is not null and community_type_id is null and community_id is null)
      or (scope_type = 'community'      and community_id is not null and community_type_id is null and cluster_id is null))
);
create index submission_codes_active_idx on public.submission_codes (valid_until) where status = 'active';
create trigger submission_codes_audit after insert or update or delete on public.submission_codes
  for each row execute function app.audit_row();

alter table public.grievances
  add constraint grievances_submission_code_fk foreign key (submission_code_id) references public.submission_codes(id);

create or replace function app.code_covers(c public.submission_codes, p_community uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case c.scope_type
    when 'all' then true
    when 'community' then c.community_id = p_community
    when 'cluster' then exists (select 1 from public.community_affiliations a
                                where a.community_id = p_community and a.active and a.cluster_id = c.cluster_id)
    when 'community_type' then exists (select 1 from public.community_affiliations a
                                where a.community_id = p_community and a.active and a.community_type_id = c.community_type_id)
  end
$$;

-- Ambiguity-free alphabet (no 0/O, 1/I/L).
create or replace function app.random_token(p_len int) returns text
language plpgsql volatile as $$
declare
  alphabet text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  b bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  s text := '';
begin
  for i in 0 .. p_len - 1 loop
    s := s || substr(alphabet, (get_byte(b, i) % length(alphabet)) + 1, 1);
  end loop;
  return s;
end $$;

-- Officers may only create codes inside their own responsibility.
create or replace function app.code_scope_allowed(p_scope text, p_type smallint, p_cluster smallint, p_comm uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select app.has_perm('grievance.read.all') or case p_scope
    when 'community_type' then exists (select 1 from public.officer_scopes s where s.officer_id = auth.uid() and s.community_type_id = p_type)
    when 'cluster' then exists (select 1 from public.officer_scopes s
                                join public.clusters c on c.id = p_cluster
                                where s.officer_id = auth.uid() and (s.cluster_id = p_cluster or s.community_type_id = c.community_type_id))
    when 'community' then exists (select 1 from public.community_affiliations a
                                  where a.community_id = p_comm and a.active
                                    and app.in_officer_scope(auth.uid(), p_comm, a.community_type_id, a.cluster_id))
    else false end
$$;

create or replace function public.create_submission_code(p jsonb) returns public.submission_codes
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v public.submission_codes;
  v_scope text := coalesce(p ->> 'scope_type', 'community');
  v_type smallint := (p ->> 'community_type_id')::smallint;
  v_cluster smallint := (p ->> 'cluster_id')::smallint;
  v_comm uuid := (p ->> 'community_id')::uuid;
  v_from timestamptz := coalesce((p ->> 'valid_from')::timestamptz, now());
  v_until timestamptz := (p ->> 'valid_until')::timestamptz;
  v_prefix text; v_code text; tries int := 0;
begin
  perform app.require_perm('codes.manage');
  if v_until is null or v_until <= v_from then raise exception 'validity_invalid' using errcode = '22023'; end if;
  if not app.code_scope_allowed(v_scope, v_type, v_cluster, v_comm) then
    raise exception 'outside_your_responsibility' using errcode = '42501';
  end if;

  v_prefix := case v_scope
    when 'community' then (select short_code from public.communities where id = v_comm)
    when 'cluster' then 'CL' || (select sort_order from public.clusters where id = v_cluster)
    when 'community_type' then (select case code when 'HOST' then 'HST' when 'PIPELINE' then 'PPL'
                                                 when 'INDIRECT' then 'IND' when 'JETTY' then 'JTY' else left(code, 3) end
                                from public.community_types where id = v_type)
    else 'IPL' end;
  if v_prefix is null then raise exception 'scope_invalid' using errcode = '22023'; end if;

  loop
    v_code := format('%s-%s-%s-%s', v_prefix, to_char(v_from at time zone app.tz(), 'YYYY'),
                     to_char(v_from at time zone app.tz(), 'MMDD'), app.random_token(4));
    exit when not exists (select 1 from public.submission_codes where code = v_code);
    tries := tries + 1;
    if tries > 10 then raise exception 'code_generation_failed'; end if;
  end loop;

  insert into public.submission_codes (code, label, scope_type, community_type_id, cluster_id, community_id,
                                       valid_from, valid_until, max_submissions, created_by)
  values (v_code, nullif(btrim(p ->> 'label'), ''), v_scope, v_type, v_cluster, v_comm,
          v_from, v_until, (p ->> 'max_submissions')::int, auth.uid())
  returning * into v;
  perform app.log('submission_code.generated', 'submission_codes', v.id::text, null, to_jsonb(v));

  if coalesce((p ->> 'release')::boolean, false) then
    v := public.release_submission_code(v.id);
  end if;
  return v;
end $$;

create or replace function public.release_submission_code(p_id uuid) returns public.submission_codes
language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.submission_codes; v_scope_name text;
begin
  perform app.require_perm('codes.manage');
  select * into v from public.submission_codes where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not app.code_scope_allowed(v.scope_type, v.community_type_id, v.cluster_id, v.community_id) then
    raise exception 'outside_your_responsibility' using errcode = '42501';
  end if;
  if v.status <> 'draft' then raise exception 'code_not_draft' using errcode = '22023'; end if;

  update public.submission_codes set status = 'active', released_by = auth.uid(), released_at = now()
  where id = p_id returning * into v;
  perform app.log('submission_code.released', 'submission_codes', v.id::text);

  -- Tell members in the covered communities (in-app only: no cost to them).
  perform app.notify(p.id, 'submission_window_opened',
                     'Grievance collection is open',
                     format('You can now submit a grievance for %s until %s.', c.name,
                            to_char(v.valid_until at time zone app.tz(), 'FMDD Mon YYYY')),
                     null, jsonb_build_object('code_id', v.id))
  from public.profiles p
  join public.communities c on c.id = p.community_id
  where p.is_active and app.code_covers(v, p.community_id) and app.has_role(p.id, 'community_member');
  return v;
end $$;

create or replace function public.deactivate_submission_code(p_id uuid, p_reason text default null) returns public.submission_codes
language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.submission_codes;
begin
  perform app.require_perm('codes.manage');
  select * into v from public.submission_codes where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not app.code_scope_allowed(v.scope_type, v.community_type_id, v.cluster_id, v.community_id) then
    raise exception 'outside_your_responsibility' using errcode = '42501';
  end if;
  if v.status = 'deactivated' then return v; end if;
  update public.submission_codes
     set status = 'deactivated', deactivated_by = auth.uid(), deactivated_at = now(), deactivation_reason = p_reason
   where id = p_id returning * into v;
  perform app.log('submission_code.deactivated', 'submission_codes', v.id::text, null, jsonb_build_object('reason', p_reason));
  return v;
end $$;

-- What a signed-in member sees on Home / Get Code for their community.
create or replace function public.get_submission_status(p_community uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_comm uuid := coalesce(p_community, (select community_id from public.profiles where id = auth.uid()));
  c public.submission_codes;
begin
  if auth.uid() is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  select sc.* into c from public.submission_codes sc
  where sc.status = 'active' and now() >= sc.valid_from and now() < sc.valid_until
    and (sc.max_submissions is null or sc.submission_count < sc.max_submissions)
    and app.code_covers(sc, v_comm)
  order by sc.valid_until desc limit 1;

  return jsonb_build_object(
    'open', c.id is not null,
    'community_id', v_comm,
    'community_name', (select name from public.communities where id = v_comm),
    'code', c.code,
    'valid_from', c.valid_from,
    'valid_until', c.valid_until,
    'server_time', now());
end $$;

-- -----------------------------------------------------------------------------
-- Auto-assignment: most specific scope wins (community > cluster > type),
-- ties go to the officer with the fewest open grievances.
-- -----------------------------------------------------------------------------
create or replace function app.pick_officer(p_comm uuid, p_type smallint, p_cluster smallint) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select s.officer_id
  from public.officer_scopes s
  join public.profiles p on p.id = s.officer_id and p.is_active
  where s.auto_assign
    and (s.community_id = p_comm or s.cluster_id = p_cluster or s.community_type_id = p_type)
    and app.has_role(s.officer_id, 'officer')
  order by case when s.community_id is not null then 1 when s.cluster_id is not null then 2 else 3 end,
           (select count(*) from public.grievances g join public.grievance_statuses st on st.id = g.status_id
             where g.assigned_officer_id = s.officer_id and st.is_open and g.archived_at is null),
           s.officer_id
  limit 1
$$;

create or replace function app.status_id(p_code text) returns smallint
language sql stable security definer set search_path = public, pg_temp as $$
  select id from public.grievance_statuses where code = p_code
$$;

create or replace function app.clean_text(p text, p_max int) returns text
language plpgsql immutable as $$
declare v text := nullif(btrim(regexp_replace(coalesce(p, ''), '[​\u0000]', '', 'g')), '');
begin
  if v is not null and length(v) > p_max then raise exception 'text_too_long' using errcode = '22001', detail = p_max::text; end if;
  return v;
end $$;

-- Shared insert path for self-service and assisted submissions.
create or replace function app.create_grievance(p jsonb, p_origin text, p_complainant uuid, p_code_id uuid)
returns public.grievances
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  g public.grievances;
  v_desc text := app.clean_text(p ->> 'description', 5000);
  v_comm uuid;
  v_today date := (now() at time zone app.tz())::date;
  v_received date := coalesce((p ->> 'date_received')::date, v_today);
  v_prof public.profiles;
  v_officer uuid;
begin
  if v_desc is null or length(v_desc) < 10 then raise exception 'description_too_short' using errcode = '22023'; end if;
  if v_received > v_today then raise exception 'date_in_future' using errcode = '22023'; end if;
  select id into v_comm from public.communities where active and id::text = p ->> 'community_id';
  if v_comm is null then raise exception 'community_invalid' using errcode = '22023'; end if;
  if (p ->> 'category_id') is not null and not exists
       (select 1 from public.grievance_categories where active and id = (p ->> 'category_id')::smallint) then
    raise exception 'category_invalid' using errcode = '22023';
  end if;
  if (p ->> 'subcategory_id') is not null and not exists
       (select 1 from public.grievance_subcategories where active and id = (p ->> 'subcategory_id')::smallint) then
    raise exception 'subcategory_invalid' using errcode = '22023';
  end if;

  if p_complainant is not null then
    select * into v_prof from public.profiles where id = p_complainant;
  end if;

  insert into public.grievances (
    tracking_id, client_submission_id, origin, date_received, submitted_at, client_created_at, form_issued_date,
    complainant_user_id, complainant_name, complainant_gender, complainant_phone, complainant_email, complainant_address,
    community_id, title, category_id, subcategory_id, description, incident_details, desired_resolution, suggestions,
    status_id, submission_code_id, created_by)
  values (
    app.next_tracking_id(extract(year from v_today)::int),
    (p ->> 'client_submission_id')::uuid, p_origin, v_received, now(),
    least((p ->> 'client_created_at')::timestamptz, now()), (p ->> 'form_issued_date')::date,
    p_complainant,
    coalesce(v_prof.full_name, app.clean_text(p ->> 'complainant_name', 120)),
    coalesce(v_prof.gender, nullif(p ->> 'complainant_gender', '')),
    coalesce(v_prof.phone, app.normalize_phone(p ->> 'complainant_phone')),
    coalesce(v_prof.email, app.clean_text(p ->> 'complainant_email', 200)),
    coalesce(v_prof.address, app.clean_text(p ->> 'complainant_address', 300)),
    v_comm,
    coalesce(app.clean_text(p ->> 'title', 120), left(regexp_replace(v_desc, '\s+', ' ', 'g'), 80)),
    (p ->> 'category_id')::smallint, (p ->> 'subcategory_id')::smallint,
    v_desc, app.clean_text(p ->> 'incident_details', 5000),
    app.clean_text(p ->> 'desired_resolution', 2000), app.clean_text(p ->> 'suggestions', 2000),
    app.status_id('SUBMITTED'), p_code_id, auth.uid())
  returning * into g;

  insert into public.grievance_status_history (grievance_id, from_status_id, to_status_id, changed_by, note)
  values (g.id, null, g.status_id, auth.uid(), null);

  v_officer := app.pick_officer(g.community_id, g.community_type_id, g.cluster_id);
  if v_officer is not null then
    update public.grievances set assigned_officer_id = v_officer where id = g.id returning * into g;
    insert into public.grievance_assignments (grievance_id, officer_id, assigned_by, reason)
    values (g.id, v_officer, null, 'auto: responsibility');
    perform app.notify(v_officer, 'officer_assigned', 'New grievance assigned',
                       format('%s · %s', g.tracking_id, (select name from public.communities where id = g.community_id)),
                       g.id);
  end if;

  perform app.log('grievance.created', 'grievances', g.id::text, null,
                  jsonb_build_object('tracking_id', g.tracking_id, 'origin', p_origin));
  return g;
end $$;

-- Self-service submission (community member). Idempotent on client_submission_id.
create or replace function public.submit_grievance(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_client uuid;
  v_existing public.grievances;
  c public.submission_codes;
  v_created timestamptz := least(coalesce((p ->> 'client_created_at')::timestamptz, now()), now());
  v_grace interval := make_interval(hours => coalesce((app.setting('code_offline_grace_hours'))::int, 72));
  v_comm uuid := (p ->> 'community_id')::uuid;
  g public.grievances;
begin
  perform app.require_perm('grievance.create.self');
  begin
    v_client := (p ->> 'client_submission_id')::uuid;
  exception when invalid_text_representation then v_client := null;
  end;
  if v_client is null then raise exception 'client_submission_id_required' using errcode = '22023'; end if;

  -- Retry of something the server already has: return the original, never a copy.
  select * into v_existing from public.grievances where client_submission_id = v_client;
  if found then
    if v_existing.complainant_user_id is distinct from auth.uid() then
      raise exception 'client_submission_id_conflict' using errcode = '23505';
    end if;
    return jsonb_build_object('id', v_existing.id, 'tracking_id', v_existing.tracking_id,
                              'submitted_at', v_existing.submitted_at, 'result', 'already_submitted');
  end if;

  select * into c from public.submission_codes where code = upper(btrim(p ->> 'submission_code')) for update;
  if not found or c.status = 'draft' then raise exception 'code_invalid' using errcode = '22023'; end if;
  -- The code row lock serialises concurrent retries of the same draft: look again.
  select * into v_existing from public.grievances where client_submission_id = v_client;
  if found and v_existing.complainant_user_id = auth.uid() then
    return jsonb_build_object('id', v_existing.id, 'tracking_id', v_existing.tracking_id,
                              'submitted_at', v_existing.submitted_at, 'result', 'already_submitted');
  end if;
  if c.status = 'deactivated' then raise exception 'code_deactivated' using errcode = '22023'; end if;
  if not app.code_covers(c, v_comm) then raise exception 'code_wrong_community' using errcode = '22023'; end if;
  if c.max_submissions is not null and c.submission_count >= c.max_submissions then
    raise exception 'code_full' using errcode = '22023';
  end if;
  -- Valid now, or drafted while valid and received within the offline grace period.
  if not ((now() >= c.valid_from and now() < c.valid_until)
          or (v_created >= c.valid_from and v_created < c.valid_until and now() < c.valid_until + v_grace)) then
    raise exception '%', case when now() < c.valid_from then 'code_not_yet_valid' else 'code_expired' end
      using errcode = '22023';
  end if;

  g := app.create_grievance(p, 'app', auth.uid(), c.id);
  update public.submission_codes set submission_count = submission_count + 1 where id = c.id;

  perform app.notify(auth.uid(), 'grievance_submitted', 'Grievance received',
                     format('Your grievance %s has been received. Keep this tracking ID for reference.', g.tracking_id),
                     g.id, jsonb_build_object('tracking_id', g.tracking_id));

  return jsonb_build_object('id', g.id, 'tracking_id', g.tracking_id, 'submitted_at', g.submitted_at, 'result', 'created');
end $$;

-- Staff entry of paper forms / assisted submissions. No code needed.
create or replace function public.submit_grievance_assisted(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_client uuid := (p ->> 'client_submission_id')::uuid;
  v_existing public.grievances;
  v_origin text := coalesce(p ->> 'origin', 'paper');
  g public.grievances;
begin
  perform app.require_perm('grievance.create.assisted');
  if v_origin not in ('paper','assisted') then raise exception 'origin_invalid' using errcode = '22023'; end if;
  if app.clean_text(p ->> 'complainant_name', 120) is null then raise exception 'name_required' using errcode = '22023'; end if;
  if nullif(btrim(p ->> 'complainant_phone'), '') is not null and app.normalize_phone(p ->> 'complainant_phone') is null then
    raise exception 'phone_invalid' using errcode = '22023';
  end if;
  if v_client is not null then
    select * into v_existing from public.grievances where client_submission_id = v_client;
    if found then
      return jsonb_build_object('id', v_existing.id, 'tracking_id', v_existing.tracking_id, 'result', 'already_submitted');
    end if;
  end if;

  g := app.create_grievance(p, v_origin, null, null);
  if g.complainant_phone is not null then
    perform app.notify(null, 'grievance_submitted', 'Grievance received',
                       format('Your grievance %s has been received by IPL Community Relations.', g.tracking_id),
                       g.id, jsonb_build_object('tracking_id', g.tracking_id),
                       g.complainant_phone, 'grievance_received',
                       jsonb_build_array(g.complainant_name, g.tracking_id));
  end if;
  return jsonb_build_object('id', g.id, 'tracking_id', g.tracking_id, 'submitted_at', g.submitted_at, 'result', 'created');
end $$;

-- ============================== 20260923000600_workflow.sql
-- =============================================================================
-- Workflow: every staff action is a function that checks permission AND
-- responsibility, updates the grievance, writes the timeline and audit log,
-- and notifies the right people.
-- =============================================================================

-- Can the signed-in staff member work on this grievance?
create or replace function app.can_work(g public.grievances) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.has_perm('grievance.read.all')
      or (app.has_perm('grievance.read.scope')
          and (g.assigned_officer_id = auth.uid()
               or app.in_officer_scope(auth.uid(), g.community_id, g.community_type_id, g.cluster_id)))
$$;

-- Load a grievance for a staff action (row-locked) or fail with a neutral error.
create or replace function app.load_for_work(p_id uuid, p_perm text) returns public.grievances
language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.grievances;
begin
  perform app.require_perm(p_perm);
  select * into g from public.grievances where id = p_id for update;
  -- Same answer for "doesn't exist" and "not yours": ids cannot be probed.
  if not found or not app.can_work(g) or (g.archived_at is not null and not app.is_super_admin()) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return g;
end $$;

create or replace function app.mark_first_response(p_id uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.grievances set first_response_at = now() where id = p_id and first_response_at is null
$$;

create or replace function app.profile_name(p_id uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select full_name from public.profiles where id = p_id
$$;
grant execute on function app.profile_name(uuid) to authenticated;

create or replace function app.community_name(p_id uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select name from public.communities where id = p_id
$$;

create or replace function app.record_status(p_id uuid, p_from smallint, p_to smallint, p_note text, p_visible boolean)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.grievance_status_history (grievance_id, from_status_id, to_status_id, changed_by, note, visible_to_complainant)
  values (p_id, p_from, p_to, auth.uid(), p_note, p_visible)
$$;

-- Tell the complainant (in-app if they have an account; WhatsApp when a template is given).
create or replace function app.notify_complainant(g public.grievances, p_type text, p_title text, p_body text,
                                                  p_template text default null, p_params jsonb default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if g.complainant_user_id is null and (p_template is null or g.complainant_phone is null) then return; end if;
  perform app.notify(g.complainant_user_id, p_type, p_title, p_body, g.id,
                     jsonb_build_object('tracking_id', g.tracking_id),
                     case when p_template is not null then g.complainant_phone end, p_template, p_params);
end $$;

-- ---- assignment --------------------------------------------------------------------
create or replace function public.assign_grievance(p_id uuid, p_officer uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.grievances;
begin
  g := app.load_for_work(p_id, 'grievance.assign');
  if not exists (select 1 from public.profiles where id = p_officer and is_active)
     or not (app.has_role(p_officer, 'officer') or app.has_role(p_officer, 'supervisor')
             or app.has_role(p_officer, 'super_admin')) then
    raise exception 'officer_invalid' using errcode = '22023';
  end if;
  if g.assigned_officer_id is not distinct from p_officer then return; end if;

  update public.grievance_assignments set unassigned_at = now()
   where grievance_id = p_id and unassigned_at is null;
  insert into public.grievance_assignments (grievance_id, officer_id, assigned_by, reason)
  values (p_id, p_officer, auth.uid(), p_reason);
  update public.grievances set assigned_officer_id = p_officer where id = p_id;

  if g.status_id = app.status_id('SUBMITTED') then
    update public.grievances set status_id = app.status_id('ASSIGNED') where id = p_id;
    perform app.record_status(p_id, g.status_id, app.status_id('ASSIGNED'), null, true);
  end if;

  perform app.notify(p_officer, 'officer_assigned', 'Grievance assigned to you',
                     format('%s · %s', g.tracking_id, app.community_name(g.community_id)), p_id);
  perform app.log('grievance.assigned', 'grievances', p_id::text,
                  jsonb_build_object('officer', g.assigned_officer_id),
                  jsonb_build_object('officer', p_officer, 'reason', p_reason));
end $$;

-- ---- status changes ----------------------------------------------------------------
create or replace function public.change_grievance_status(p_id uuid, p_status text, p_note text default null,
                                                         p_visible_to_complainant boolean default true) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  g public.grievances;
  v_to public.grievance_statuses;
  v_perm text;
begin
  g := app.load_for_work(p_id, 'grievance.update_status');
  select * into v_to from public.grievance_statuses where code = p_status and active;
  if not found then raise exception 'status_invalid' using errcode = '22023'; end if;
  if v_to.code = 'RESOLVED' then raise exception 'use_resolve_grievance' using errcode = '22023'; end if;
  if v_to.id = g.status_id then return; end if;

  select required_permission into v_perm from public.grievance_status_transitions
   where from_status_id = g.status_id and to_status_id = v_to.id;
  if v_perm is null and not app.is_super_admin() then
    raise exception 'transition_not_allowed' using errcode = '22023';
  end if;
  if v_perm is not null then perform app.require_perm(v_perm); end if;

  if v_to.code = 'REOPENED' then
    -- Reopening restarts the clock and withdraws the current resolution.
    update public.grievance_resolutions set is_current = false where grievance_id = p_id and is_current;
    update public.grievances set status_id = v_to.id, sla_started_at = now(), resolved_at = null, closed_at = null,
                                 overdue_since = null, last_overdue_alert_at = null, ack_state = 'not_requested'
     where id = p_id;
  elsif v_to.code = 'CLOSED' then
    update public.grievances set status_id = v_to.id, closed_at = now(), closure_officer_id = auth.uid()
     where id = p_id;
  else
    update public.grievances set status_id = v_to.id where id = p_id;
  end if;

  perform app.record_status(p_id, g.status_id, v_to.id, nullif(btrim(p_note), ''), p_visible_to_complainant);
  perform app.mark_first_response(p_id);
  perform app.log('grievance.status_changed', 'grievances', p_id::text,
                  jsonb_build_object('status', (select code from public.grievance_statuses where id = g.status_id)),
                  jsonb_build_object('status', v_to.code, 'note', p_note));

  if p_visible_to_complainant
     and v_to.public_label is distinct from (select public_label from public.grievance_statuses where id = g.status_id) then
    perform app.notify_complainant(g, 'grievance_status_changed', v_to.public_label,
                                   format('%s: %s', g.tracking_id, v_to.public_message));
  end if;
end $$;

-- ---- remarks and actions -----------------------------------------------------------
create or replace function public.add_grievance_comment(p_id uuid, p_body text, p_visibility text default 'internal')
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.grievances; v_id bigint;
begin
  g := app.load_for_work(p_id, 'grievance.comment');
  if p_visibility not in ('internal','complainant') then raise exception 'visibility_invalid' using errcode = '22023'; end if;
  insert into public.grievance_comments (grievance_id, author_id, kind, visibility, body)
  values (p_id, auth.uid(), 'remark', p_visibility, app.clean_text(p_body, 4000))
  returning id into v_id;
  perform app.mark_first_response(p_id);
  perform app.log('grievance.comment_added', 'grievances', p_id::text, null,
                  jsonb_build_object('comment_id', v_id, 'visibility', p_visibility));
  if p_visibility = 'complainant' then
    perform app.notify_complainant(g, 'grievance_comment', 'Update on your grievance',
                                   format('%s: %s', g.tracking_id, left(p_body, 200)));
  end if;
  return v_id;
end $$;

create or replace function public.add_grievance_action(p_id uuid, p_description text, p_action_type text default 'action',
                                                      p_action_date date default null)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.grievances; v_id bigint;
begin
  g := app.load_for_work(p_id, 'grievance.comment');
  insert into public.grievance_actions (grievance_id, action_type, description, action_date, created_by)
  values (p_id, p_action_type, app.clean_text(p_description, 4000),
          coalesce(p_action_date, (now() at time zone app.tz())::date), auth.uid())
  returning id into v_id;
  perform app.mark_first_response(p_id);
  perform app.log('grievance.action_added', 'grievances', p_id::text, null,
                  jsonb_build_object('action_id', v_id, 'type', p_action_type));
  return v_id;
end $$;

-- ---- triage (category, severity, classification) ------------------------------------
create or replace function public.update_grievance_triage(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.grievances; n public.grievances;
begin
  g := app.load_for_work(p_id, 'grievance.triage');
  update public.grievances set
    category_id       = case when p ? 'category_id' then (p ->> 'category_id')::smallint else category_id end,
    subcategory_id    = case when p ? 'subcategory_id' then (p ->> 'subcategory_id')::smallint else subcategory_id end,
    severity_id       = case when p ? 'severity_id' then (p ->> 'severity_id')::smallint else severity_id end,
    title             = case when p ? 'title' then app.clean_text(p ->> 'title', 120) else title end,
    responsibility    = case when p ? 'responsibility' then app.clean_text(p ->> 'responsibility', 120) else responsibility end,
    -- choose one of the community's affiliations (e.g. Akpajo: Host or Pipeline / Cluster 1)
    community_type_id = case when p ? 'community_type_id' then (p ->> 'community_type_id')::smallint else community_type_id end
  where id = p_id
  returning * into n;
  -- a category change must not leave a sub-category from another category behind
  if n.subcategory_id is not null and n.category_id is distinct from
       (select category_id from public.grievance_subcategories where id = n.subcategory_id) then
    raise exception 'subcategory_mismatch' using errcode = '23514';
  end if;
  perform app.log('grievance.triaged', 'grievances', p_id::text,
                  jsonb_build_object('category', g.category_id, 'subcategory', g.subcategory_id, 'severity', g.severity_id,
                                     'community_type', g.community_type_id, 'cluster', g.cluster_id),
                  jsonb_build_object('category', n.category_id, 'subcategory', n.subcategory_id, 'severity', n.severity_id,
                                     'community_type', n.community_type_id, 'cluster', n.cluster_id));
end $$;

-- ---- resolution ------------------------------------------------------------------------
create or replace function public.resolve_grievance(p_id uuid, p_details text, p_public_summary text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  g public.grievances;
  v_details text := app.clean_text(p_details, 5000);
  v_summary text := app.clean_text(p_public_summary, 1000);
  v_resolved smallint := app.status_id('RESOLVED');
begin
  g := app.load_for_work(p_id, 'grievance.resolve');
  if v_details is null or length(v_details) < 10 then raise exception 'resolution_details_required' using errcode = '22023'; end if;
  if g.status_id in (v_resolved, app.status_id('CLOSED')) then raise exception 'already_resolved' using errcode = '22023'; end if;

  update public.grievance_resolutions set is_current = false where grievance_id = p_id and is_current;
  insert into public.grievance_resolutions (grievance_id, details, public_summary, resolved_by)
  values (p_id, v_details, v_summary, auth.uid());
  update public.grievances set status_id = v_resolved, resolved_at = now(),
         ack_state = case when complainant_user_id is not null or complainant_phone is not null then 'pending' else 'not_requested' end
   where id = p_id;
  perform app.record_status(p_id, g.status_id, v_resolved, null, true);
  perform app.mark_first_response(p_id);
  perform app.log('grievance.resolved', 'grievances', p_id::text, null, jsonb_build_object('details', v_details));

  perform app.notify_complainant(g, 'grievance_resolved', 'Your grievance has been marked as resolved',
    format('%s has been resolved. Please open the app to review the resolution and tell us if you agree.', g.tracking_id),
    coalesce(app.setting('whatsapp_resolution_template') #>> '{}', 'grievance_resolved'),
    jsonb_build_array(coalesce(split_part(g.complainant_name, ' ', 1), 'there'), g.tracking_id,
                      left(coalesce(v_summary, v_details), 600)));
end $$;

-- Re-send the acknowledgement request (in-app, and WhatsApp when available).
create or replace function public.request_acknowledgement(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.grievances;
begin
  g := app.load_for_work(p_id, 'grievance.resolve');
  if g.status_id <> app.status_id('RESOLVED') then raise exception 'not_resolved' using errcode = '22023'; end if;
  update public.grievances set ack_state = 'pending' where id = p_id;
  perform app.notify_complainant(g, 'acknowledgement_required', 'Please confirm the resolution',
    format('Do you agree with the resolution of %s? Open the app to respond.', g.tracking_id));
  perform app.log('grievance.acknowledgement_requested', 'grievances', p_id::text);
end $$;

-- Shared acknowledgement path.
create or replace function app.apply_acknowledgement(g public.grievances, p_response text, p_reason text,
                                                     p_channel text, p_user uuid, p_recorded_by uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_res bigint; v_reopened smallint := app.status_id('REOPENED');
begin
  if p_response not in ('acknowledged','disputed') then raise exception 'response_invalid' using errcode = '22023'; end if;
  if g.status_id not in (app.status_id('RESOLVED'), app.status_id('CLOSED')) then
    raise exception 'not_resolved' using errcode = '22023';
  end if;
  if p_response = 'disputed' and app.clean_text(p_reason, 1000) is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  select id into v_res from public.grievance_resolutions where grievance_id = g.id and is_current;
  insert into public.grievance_acknowledgements (grievance_id, resolution_id, response, reason, user_id, recorded_by, channel)
  values (g.id, v_res, p_response, app.clean_text(p_reason, 1000), p_user, p_recorded_by, p_channel);

  if p_response = 'acknowledged' then
    update public.grievances set ack_state = 'acknowledged' where id = g.id;
  else
    -- "Resolved" never implies agreement: a dispute reopens the grievance.
    update public.grievance_resolutions set is_current = false where grievance_id = g.id and is_current;
    update public.grievances set ack_state = 'disputed', status_id = v_reopened, sla_started_at = now(),
                                 resolved_at = null, closed_at = null, overdue_since = null, last_overdue_alert_at = null
     where id = g.id;
    perform app.record_status(g.id, g.status_id, v_reopened, 'Complainant did not accept the resolution', true);
    if g.assigned_officer_id is not null then
      perform app.notify(g.assigned_officer_id, 'grievance_disputed', 'Resolution not accepted',
                         format('%s: %s', g.tracking_id, left(p_reason, 200)), g.id);
    end if;
  end if;
  perform app.log('grievance.' || p_response, 'grievances', g.id::text, null,
                  jsonb_build_object('reason', p_reason, 'channel', p_channel, 'recorded_by', p_recorded_by));
end $$;

-- Complainant acknowledges or disputes their own resolution.
create or replace function public.acknowledge_resolution(p_id uuid, p_response text, p_reason text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.grievances;
begin
  perform app.require_perm('grievance.acknowledge.own');
  select * into g from public.grievances where id = p_id and complainant_user_id = auth.uid() and archived_at is null
  for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform app.apply_acknowledgement(g, p_response, p_reason, 'app', auth.uid(), null);
end $$;

-- Staff record an acknowledgement given by phone, in person, etc.
create or replace function public.record_acknowledgement(p_id uuid, p_response text, p_reason text default null,
                                                        p_channel text default 'phone')
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.grievances;
begin
  g := app.load_for_work(p_id, 'grievance.acknowledge.record');
  if p_channel = 'app' then raise exception 'channel_invalid' using errcode = '22023'; end if;
  perform app.apply_acknowledgement(g, p_response, p_reason, p_channel, g.complainant_user_id, auth.uid());
end $$;

-- ---- corrections, archive, delete ------------------------------------------------------
create or replace function public.amend_grievance_text(p_id uuid, p_field text, p_value text, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.grievances; v_old text;
begin
  g := app.load_for_work(p_id, 'grievance.amend_text');
  if p_field not in ('description','incident_details','desired_resolution','suggestions') then
    raise exception 'field_invalid' using errcode = '22023';
  end if;
  if app.clean_text(p_reason, 500) is null then raise exception 'reason_required' using errcode = '22023'; end if;
  if p_field = 'description' and app.clean_text(p_value, 5000) is null then
    raise exception 'description_too_short' using errcode = '22023';
  end if;
  execute format('select %I from public.grievances where id = $1', p_field) into v_old using p_id;
  perform set_config('app.allow_text_amend', 'on', true);
  execute format('update public.grievances set %I = $1, text_amended = true where id = $2', p_field)
    using app.clean_text(p_value, 5000), p_id;
  perform set_config('app.allow_text_amend', 'off', true);
  perform app.log('grievance.text_amended', 'grievances', p_id::text,
                  jsonb_build_object(p_field, v_old), jsonb_build_object(p_field, p_value, 'reason', p_reason));
end $$;

create or replace function public.request_grievance_archive(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.grievances;
begin
  g := app.load_for_work(p_id, 'grievance.archive.request');
  if app.clean_text(p_reason, 500) is null then raise exception 'reason_required' using errcode = '22023'; end if;
  insert into public.grievance_flags (grievance_id, flag, detail, created_by)
  values (p_id, 'archive_requested', jsonb_build_object('reason', p_reason), auth.uid());
  perform app.notify(ur.user_id, 'archive_requested', 'Archive requested',
                     format('%s: %s', g.tracking_id, left(p_reason, 200)), p_id)
  from public.user_roles ur join public.roles r on r.id = ur.role_id where r.code = 'super_admin';
  perform app.log('grievance.archive_requested', 'grievances', p_id::text, null, jsonb_build_object('reason', p_reason));
end $$;

create or replace function public.archive_grievance(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.grievances;
begin
  g := app.load_for_work(p_id, 'grievance.archive');
  if app.clean_text(p_reason, 500) is null then raise exception 'reason_required' using errcode = '22023'; end if;
  update public.grievances set archived_at = now(), archived_by = auth.uid(), archive_reason = p_reason where id = p_id;
  update public.grievance_flags set resolved_at = now(), resolved_by = auth.uid(), resolution = 'archived'
   where grievance_id = p_id and flag = 'archive_requested' and resolved_at is null;
  perform app.log('grievance.archived', 'grievances', p_id::text, null, jsonb_build_object('reason', p_reason));
end $$;

create or replace function public.restore_grievance(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.require_perm('grievance.archive');
  update public.grievances set archived_at = null, archived_by = null, archive_reason = null
   where id = p_id and archived_at is not null;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform app.log('grievance.restored', 'grievances', p_id::text);
end $$;

-- Permanent deletion: Super Admin only, record must already be archived, and
-- the caller must type the tracking ID back. A tombstone stays in the audit log.
create or replace function public.hard_delete_grievance(p_id uuid, p_confirm_tracking_id text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.grievances;
begin
  perform app.require_perm('grievance.hard_delete');
  select * into g from public.grievances where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if g.archived_at is null then raise exception 'archive_first' using errcode = '22023'; end if;
  if upper(btrim(p_confirm_tracking_id)) <> g.tracking_id then raise exception 'confirmation_mismatch' using errcode = '22023'; end if;
  perform app.log('grievance.hard_deleted', 'grievances', p_id::text, to_jsonb(g) - 'search_tsv', null);
  delete from public.grievances where id = p_id;
end $$;

-- ---- complainant views (only public information ever leaves these) -----------------------
create or replace function public.my_grievances(p_since timestamptz default null) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(x order by x.updated_at desc), '[]'::jsonb) from (
    select g.id, g.tracking_id, g.title, g.date_received, g.submitted_at, g.updated_at,
           c.name as community_name, s.code as status_code, s.public_label as status_label,
           s.public_message as status_message, s.tone as status_tone, g.ack_state,
           (s.code = 'RESOLVED' and g.ack_state = 'pending') as needs_acknowledgement,
           cat.public_label as category_label
    from public.grievances g
    join public.grievance_statuses s on s.id = g.status_id
    left join public.communities c on c.id = g.community_id
    left join public.grievance_categories cat on cat.id = g.category_id
    where g.complainant_user_id = auth.uid() and g.archived_at is null
      and (p_since is null or g.updated_at > p_since)
  ) x
$$;

create or replace function public.my_grievance_detail(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare g public.grievances; v jsonb;
begin
  select * into g from public.grievances where id = p_id and complainant_user_id = auth.uid() and archived_at is null;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;

  select jsonb_build_object(
    'id', g.id, 'tracking_id', g.tracking_id, 'title', g.title, 'description', g.description,
    'desired_resolution', g.desired_resolution, 'suggestions', g.suggestions,
    'date_received', g.date_received, 'submitted_at', g.submitted_at, 'updated_at', g.updated_at,
    'community_name', app.community_name(g.community_id),
    'category_label', (select public_label from public.grievance_categories where id = g.category_id),
    'status_code', s.code, 'status_label', s.public_label, 'status_message', s.public_message, 'status_tone', s.tone,
    'ack_state', g.ack_state, 'resolved_at', g.resolved_at,
    -- Timeline: public labels only; consecutive internal stages collapse into one step.
    'timeline', coalesce((
        select jsonb_agg(jsonb_build_object('label', t.label, 'message', t.message, 'at', t.at, 'code', t.code) order by t.at)
        from (select h.changed_at as at, st.public_label as label, st.public_message as message, st.code,
                     lag(st.public_label) over (order by h.changed_at, h.id) as prev
              from public.grievance_status_history h
              join public.grievance_statuses st on st.id = h.to_status_id
              where h.grievance_id = g.id and h.visible_to_complainant) t
        where t.prev is distinct from t.label), '[]'::jsonb),
    'updates', coalesce((
        select jsonb_agg(jsonb_build_object('body', cm.body, 'at', cm.created_at) order by cm.created_at)
        from public.grievance_comments cm where cm.grievance_id = g.id and cm.visibility = 'complainant'), '[]'::jsonb),
    'resolution', (select jsonb_build_object('details', coalesce(r.public_summary, r.details), 'resolved_at', r.resolved_at)
                   from public.grievance_resolutions r where r.grievance_id = g.id and r.is_current),
    'acknowledgement', (select jsonb_build_object('response', a.response, 'reason', a.reason, 'at', a.created_at)
                        from public.grievance_acknowledgements a where a.grievance_id = g.id
                        order by a.created_at desc limit 1))
  into v
  from public.grievance_statuses s where s.id = g.status_id;
  return v;
end $$;

-- Find one of MY grievances by tracking ID (new or legacy format).
create or replace function public.find_my_grievance(p_tracking_id text) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from public.grievances
  where complainant_user_id = auth.uid() and archived_at is null
    and (tracking_id = upper(btrim(p_tracking_id))
         or legacy_tracking_id_norm = upper(regexp_replace(p_tracking_id, '\s', '', 'g')))
  limit 1
$$;

-- ============================== 20260923000700_admin_and_jobs.sql
-- =============================================================================
-- Administration (users, roles, officer scopes), staff read models, and the
-- scheduled overdue scan.
-- =============================================================================

-- ---- users & roles ------------------------------------------------------------------
create or replace function public.admin_set_user_roles(p_user uuid, p_roles text[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old jsonb;
begin
  perform app.require_perm('users.manage');
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if exists (select 1 from unnest(p_roles) r where r not in (select code from public.roles)) then
    raise exception 'role_invalid' using errcode = '22023';
  end if;
  -- Only a Super Admin can grant or remove Super Admin.
  if ('super_admin' = any(p_roles) or app.has_role(p_user, 'super_admin')) and not app.is_super_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  -- Never leave the system without an active Super Admin.
  if app.has_role(p_user, 'super_admin') and not ('super_admin' = any(p_roles))
     and not exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                     join public.profiles p on p.id = ur.user_id
                     where r.code = 'super_admin' and p.is_active and ur.user_id <> p_user) then
    raise exception 'last_super_admin' using errcode = '22023';
  end if;

  select jsonb_agg(r.code order by r.code) into v_old
  from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = p_user;
  delete from public.user_roles where user_id = p_user;
  insert into public.user_roles (user_id, role_id, granted_by)
  select p_user, id, auth.uid() from public.roles where code = any(p_roles);
  perform app.log('user.roles_changed', 'profiles', p_user::text, jsonb_build_object('roles', v_old),
                  jsonb_build_object('roles', to_jsonb(p_roles)));
end $$;

create or replace function public.admin_set_user_active(p_user uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.require_perm('users.manage');
  if p_user = auth.uid() and not p_active then raise exception 'cannot_disable_self' using errcode = '22023'; end if;
  if app.has_role(p_user, 'super_admin') and not app.is_super_admin() then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.profiles set is_active = p_active,
         disabled_at = case when p_active then null else now() end,
         disabled_by = case when p_active then null else auth.uid() end
   where id = p_user;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform app.log(case when p_active then 'user.enabled' else 'user.disabled' end, 'profiles', p_user::text);
end $$;

create or replace function public.admin_update_profile(p_user uuid, p jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.require_perm('users.manage');
  update public.profiles set
    full_name    = case when p ? 'full_name' then app.clean_text(p ->> 'full_name', 120) else full_name end,
    job_title    = case when p ? 'job_title' then app.clean_text(p ->> 'job_title', 120) else job_title end,
    email        = case when p ? 'email' then app.clean_text(p ->> 'email', 200) else email end,
    phone        = case when p ? 'phone' then app.normalize_phone(p ->> 'phone') else phone end,
    community_id = case when p ? 'community_id' then (p ->> 'community_id')::uuid else community_id end
  where id = p_user;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;

-- Replace an officer's responsibility. p_scopes: [{"community_type":"HOST"}, {"cluster_id":3}, {"community_id":"…"}]
create or replace function public.admin_set_officer_scopes(p_officer uuid, p_scopes jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare s jsonb; v_old jsonb;
begin
  perform app.require_perm('users.manage');
  if not app.has_role(p_officer, 'officer') then raise exception 'not_an_officer' using errcode = '22023'; end if;
  select jsonb_agg(to_jsonb(o) - 'id' - 'created_at' - 'created_by') into v_old
  from public.officer_scopes o where officer_id = p_officer;
  delete from public.officer_scopes where officer_id = p_officer;
  for s in select * from jsonb_array_elements(coalesce(p_scopes, '[]'::jsonb)) loop
    insert into public.officer_scopes (officer_id, community_type_id, cluster_id, community_id, auto_assign, created_by)
    values (p_officer,
            (select id from public.community_types where code = s ->> 'community_type'),
            (s ->> 'cluster_id')::smallint,
            (s ->> 'community_id')::uuid,
            coalesce((s ->> 'auto_assign')::boolean, true),
            auth.uid());
  end loop;
  perform app.log('officer.scopes_changed', 'profiles', p_officer::text, v_old, p_scopes);
end $$;

-- Staff directory (names/roles only), for assignment pickers and display.
create or replace function public.list_staff() returns table (
  id uuid, full_name text, job_title text, email text, is_active boolean, roles text[], scopes jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.full_name, p.job_title, p.email, p.is_active,
         array_agg(r.code order by r.code),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'community_type', t.code, 'cluster', cl.name, 'community', cm.name, 'auto_assign', o.auto_assign))
                   from public.officer_scopes o
                   left join public.community_types t on t.id = o.community_type_id
                   left join public.clusters cl on cl.id = o.cluster_id
                   left join public.communities cm on cm.id = o.community_id
                   where o.officer_id = p.id), '[]'::jsonb)
  from public.profiles p
  join public.user_roles ur on ur.user_id = p.id
  join public.roles r on r.id = ur.role_id and r.is_staff
  where app.has_perm('dashboard.view') or app.has_perm('users.manage') or app.has_perm('grievance.assign')
  group by p.id
$$;

-- Bootstrap: make an existing account the first Super Admin.
-- Run once from the SQL editor (postgres); not callable through the API.
create or replace function app.bootstrap_super_admin(p_email text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(p_email);
  if v_id is null then raise exception 'No auth user with email %', p_email; end if;
  insert into public.user_roles (user_id, role_id) select v_id, id from public.roles where code = 'super_admin'
  on conflict do nothing;
  perform app.log('user.bootstrap_super_admin', 'profiles', v_id::text);
end $$;
revoke execute on function app.bootstrap_super_admin(text) from public, authenticated, anon;

-- -----------------------------------------------------------------------------
-- Staff read model: list/detail rows with labels and live SLA figures.
-- security_invoker => the grievances RLS policy decides which rows appear.
-- -----------------------------------------------------------------------------
create or replace view public.grievance_overview with (security_invoker = true) as
select
  g.id, g.tracking_id, g.legacy_tracking_id, g.origin, g.is_legacy, g.legacy_needs_review, g.title, g.description,
  g.date_received, g.date_received_precision, g.submitted_at, g.year, g.updated_at, g.resolved_at, g.closed_at,
  g.complainant_name, g.complainant_phone, g.complainant_gender, g.complainant_user_id,
  g.community_id, cm.name as community_name,
  g.community_type_id, ct.name as community_type, ct.code as community_type_code,
  g.cluster_id, cl.name as cluster_name,
  g.category_id, cat.name as category_name, g.subcategory_id, sub.name as subcategory_name,
  g.severity_id, sev.name as severity_name,
  g.status_id, st.code as status_code, st.staff_label as status_label, st.tone as status_tone, st.is_open,
  g.assigned_officer_id, app.profile_name(g.assigned_officer_id) as assigned_officer_name,
  g.ack_state, g.sla_due_at, g.archived_at,
  case when st.is_open and not st.stops_sla and g.sla_started_at is not null
       then app.days_outstanding(g.sla_started_at) end as days_outstanding,
  (st.is_open and not st.stops_sla and not g.legacy_needs_review and g.sla_due_at < now()) as is_overdue,
  (st.is_open and not st.stops_sla and not g.legacy_needs_review and g.sla_due_at >= now()
     and g.sla_due_at < now() + make_interval(hours => coalesce((app.setting('sla_due_soon_hours'))::int, 24))) as is_due_soon,
  (select count(*) from public.grievance_flags f where f.grievance_id = g.id and f.resolved_at is null) as open_flags
from public.grievances g
join public.grievance_statuses st on st.id = g.status_id
left join public.communities cm on cm.id = g.community_id
left join public.community_types ct on ct.id = g.community_type_id
left join public.clusters cl on cl.id = g.cluster_id
left join public.grievance_categories cat on cat.id = g.category_id
left join public.grievance_subcategories sub on sub.id = g.subcategory_id
left join public.severities sev on sev.id = g.severity_id;

grant execute on function app.days_outstanding(timestamptz, timestamptz), app.setting(text) to authenticated;

-- -----------------------------------------------------------------------------
-- Overdue scan (hourly via pg_cron). Alerts the responsible officer when a
-- grievance passes its deadline, then at most once per re-alert interval.
-- Legacy items awaiting review are excluded so an import can't flood inboxes.
-- -----------------------------------------------------------------------------
create or replace function app.scan_overdue() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record; n int := 0;
  v_realert interval := make_interval(hours => coalesce((app.setting('overdue_realert_hours'))::int, 24));
begin
  for r in
    select g.id, g.tracking_id, g.assigned_officer_id, g.sla_started_at, g.community_id, g.category_id, g.overdue_since
    from public.grievances g
    join public.grievance_statuses st on st.id = g.status_id
    where st.is_open and not st.stops_sla and g.archived_at is null and not g.legacy_needs_review
      and g.sla_due_at < now()
      and (g.last_overdue_alert_at is null or g.last_overdue_alert_at < now() - v_realert)
    for update of g skip locked
  loop
    update public.grievances set overdue_since = coalesce(overdue_since, sla_due_at), last_overdue_alert_at = now()
     where id = r.id;
    if r.assigned_officer_id is not null then
      perform app.notify(r.assigned_officer_id, 'grievance_overdue', 'Attention required',
        format('Grievance %s has been unresolved for %s working days. Community: %s. Category: %s.',
               r.tracking_id, app.days_outstanding(r.sla_started_at), app.community_name(r.community_id),
               coalesce((select name from public.grievance_categories where id = r.category_id), 'Not set')),
        r.id, jsonb_build_object('tracking_id', r.tracking_id, 'days', app.days_outstanding(r.sla_started_at)));
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Daily digest for Super Admins / supervisors: counts only.
create or replace function app.overdue_digest() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count int; v_unassigned int;
begin
  select count(*) filter (where true), count(*) filter (where g.assigned_officer_id is null)
    into v_count, v_unassigned
  from public.grievances g join public.grievance_statuses st on st.id = g.status_id
  where st.is_open and not st.stops_sla and g.archived_at is null and not g.legacy_needs_review and g.sla_due_at < now();
  if v_count = 0 then return; end if;
  perform app.notify(ur.user_id, 'overdue_digest', 'Overdue grievances',
                     format('%s grievances are overdue (%s unassigned).', v_count, v_unassigned), null,
                     jsonb_build_object('count', v_count, 'unassigned', v_unassigned))
  from public.user_roles ur join public.roles r on r.id = ur.role_id
  join public.profiles p on p.id = ur.user_id and p.is_active
  where r.code in ('super_admin','supervisor');
end $$;

-- Schedule when pg_cron is available (Supabase: enable it under Database > Extensions).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('ipl-overdue-scan', '7 * * * *', 'select app.scan_overdue()');
    perform cron.schedule('ipl-overdue-digest', '0 7 * * 1-5', 'select app.overdue_digest()');  -- 08:00 Lagos
  end if;
end $$;

-- ============================== 20260923000800_legacy_import.sql
-- =============================================================================
-- Historical import: batches, verbatim source rows, and legacy value mappings.
-- The importer (Phase 12) writes here; nothing in this migration imports data.
--
-- Rule: every original Excel row is kept verbatim in legacy_source_records,
-- including rows that are NOT turned into grievances (overlap copies and
-- confirmed duplicates), so "what did the original file say?" always has an
-- answer.
-- =============================================================================

create table public.import_batches (
  id           uuid primary key default gen_random_uuid(),
  file_name    text not null,
  file_sha256  text not null,
  workbook     text not null,               -- short label, e.g. 'Complete 2018-2026'
  status       text not null default 'draft' check (status in ('draft','validated','imported','rolled_back','failed')),
  column_map   jsonb,                       -- sheet -> {legacy column -> standard field}
  counts       jsonb not null default '{}'::jsonb,  -- total/valid/invalid/duplicates/imported/skipped
  report       jsonb,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  imported_at  timestamptz,
  rolled_back_at timestamptz
);
create unique index import_batches_file_once on public.import_batches (file_sha256) where status = 'imported';

create table public.legacy_source_records (
  id            bigint generated always as identity primary key,
  batch_id      uuid not null references public.import_batches(id) on delete cascade,
  workbook      text not null,
  sheet         text not null,
  row_number    int not null,
  source_serial text,
  raw           jsonb not null,             -- every original cell, header -> value, verbatim
  grievance_id  uuid references public.grievances(id) on delete set null,
  match_role    text not null check (match_role in ('primary','overlap_copy','excluded_duplicate','excluded_invalid')),
  note          text,
  unique (batch_id, sheet, row_number)
);
create index legacy_source_records_g_idx on public.legacy_source_records (grievance_id);

alter table public.grievances
  add constraint grievances_import_batch_fk foreign key (import_batch_id) references public.import_batches(id);

-- Legacy value -> standard id, editable in the import wizard.
create table public.legacy_value_mappings (
  field             text not null check (field in ('category','subcategory','status','severity','community')),
  legacy_value_norm text not null,
  legacy_value      text not null,
  target_id         text,                 -- id of the standard row (text to cover smallint and uuid keys)
  note              text,
  approved_by       uuid,
  approved_at       timestamptz,
  primary key (field, legacy_value_norm)
);
create trigger legacy_value_mappings_audit after insert or update or delete on public.legacy_value_mappings
  for each row execute function app.audit_row();

-- Proposed mappings from docs/01-data-audit.md §8.2–8.3 (pending approval in the wizard).
insert into public.legacy_value_mappings (field, legacy_value_norm, legacy_value, target_id, note)
select 'category', app.norm_key(m.legacy), m.legacy, c.id::text, 'proposed (data audit §8.2)'
from (values
  ('Employment','Employment & Economic Inclusion'), ('Empowerment','Employment & Economic Inclusion'),
  ('Contracts & Supplies','Employment & Economic Inclusion'), ('Distributions','Employment & Economic Inclusion'),
  ('CSR','Corporate Social Responsibility (CSR) & Community Engagement'),
  ('CSR Project','Corporate Social Responsibility (CSR) & Community Engagement'),
  ('CSR Projects','Corporate Social Responsibility (CSR) & Community Engagement'),
  ('Community Need','Corporate Social Responsibility (CSR) & Community Engagement'),
  ('Electricity','Infrastructure & Public Services'), ('Drinking Water','Infrastructure & Public Services'),
  ('Infrastructure Development','Infrastructure & Public Services'),
  ('Education','Education & Youth Development'), ('Scholarship','Education & Youth Development'),
  ('Skill Acquisition','Education & Youth Development'),
  ('Health','Health & Social Welfare'), ('Feeding','Health & Social Welfare'), ('COVID 19 Pandemic','Health & Social Welfare'),
  ('Equity Share','Governance & Representation'), ('Equity Shares','Governance & Representation'),
  ('Dividends','Governance & Representation'), ('Community Grievance','Governance & Representation'),
  ('Community conflict','Governance & Representation'), ('LGA Grievance','Governance & Representation'),
  ('Security','Governance & Representation'),
  -- a sub-category typed into the category column (tracker 2026.1)
  ('Insufficient Reach of Corporate Social Responsibility (CSR) Initiatives',
   'Corporate Social Responsibility (CSR) & Community Engagement')
) m(legacy, standard)
join public.grievance_categories c on c.name = m.standard;

insert into public.legacy_value_mappings (field, legacy_value_norm, legacy_value, target_id, note)
select 'status', app.norm_key(m.legacy), m.legacy, s.id::text, m.note
from (values
  ('Closed', 'CLOSED', null), ('WIP', 'IN_PROGRESS', 'legacy open: officer review before alerts'),
  ('Resolved', 'RESOLVED', 'acknowledgement not captured'), ('Ongoing', 'IN_PROGRESS', null),
  ('Not Started', 'ASSIGNED', 'SUBMITTED when no officer is recorded')
) m(legacy, code, note)
join public.grievance_statuses s on s.code = m.code;

insert into public.legacy_value_mappings (field, legacy_value_norm, legacy_value, target_id)
select 'severity', app.norm_key(m.legacy), m.legacy, s.id::text
from (values ('High','HIGH'), ('Medium','MEDIUM'), ('Low','LOW')) m(legacy, code)
join public.severities s on s.code = m.code;

-- ============================== 20260923000900_security.sql
-- =============================================================================
-- Security: Row Level Security and privileges for every table and function.
--
-- Model:
--   * Start from nothing: revoke all table privileges and function EXECUTE
--     from anon/authenticated, then grant back exactly what each needs.
--   * Grievance data is only ever WRITTEN through SECURITY DEFINER functions.
--   * Staff READ grievances directly (filtered by RLS below); community members
--     read only through my_grievances()/my_grievance_detail(), which return
--     public fields only.
--   * Helpers are wrapped as (select app.fn()) so they run once per query.
-- =============================================================================

do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

-- ---- master data: readable by everyone (sign-up needs the community list) ----------
do $$
declare t text;
begin
  foreach t in array array['community_types','clusters','communities','community_affiliations','community_aliases',
                           'grievance_categories','grievance_subcategories','grievance_statuses',
                           'grievance_status_transitions','severities','holidays']
  loop
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant insert, update, delete on public.%I to authenticated', t);
    execute format('create policy %1$s_read on public.%1$s for select to anon, authenticated using (true)', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated
                    with check ((select app.has_perm(''masterdata.manage'')))', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated
                    using ((select app.has_perm(''masterdata.manage''))) with check ((select app.has_perm(''masterdata.manage'')))', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated
                    using ((select app.has_perm(''masterdata.manage'')))', t);
  end loop;
end $$;

grant select on public.master_data_version to anon, authenticated;
create policy master_data_version_read on public.master_data_version for select to anon, authenticated using (true);

-- ---- settings ------------------------------------------------------------------------
grant select on public.settings to anon, authenticated;
grant update on public.settings to authenticated;
create policy settings_read on public.settings for select to anon, authenticated
  using (is_public or (select app.has_perm('dashboard.view')) or (select app.has_perm('settings.manage')));
create policy settings_update on public.settings for update to authenticated
  using ((select app.has_perm('settings.manage'))) with check ((select app.has_perm('settings.manage')));

-- ---- RBAC ----------------------------------------------------------------------------
grant select on public.roles, public.permissions, public.role_permissions to authenticated;
grant insert, delete on public.role_permissions to authenticated;
create policy roles_read on public.roles for select to authenticated using (true);
create policy permissions_read on public.permissions for select to authenticated using (true);
create policy role_permissions_read on public.role_permissions for select to authenticated using (true);
-- Permission bundles are configurable, by Super Admins only (super_admin itself is implicit).
create policy role_permissions_insert on public.role_permissions for insert to authenticated
  with check ((select app.is_super_admin()));
create policy role_permissions_delete on public.role_permissions for delete to authenticated
  using ((select app.is_super_admin()));
create trigger role_permissions_audit after insert or update or delete on public.role_permissions
  for each row execute function app.audit_row();

grant select on public.profiles, public.user_roles, public.officer_scopes to authenticated;
create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select app.has_perm('users.manage')));
create policy user_roles_read on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or (select app.has_perm('users.manage')));
create policy officer_scopes_read on public.officer_scopes for select to authenticated
  using (officer_id = (select auth.uid()) or (select app.has_perm('users.manage'))
         or (select app.has_perm('grievance.assign')));

-- ---- grievances ----------------------------------------------------------------------
grant execute on function app.in_officer_scope(uuid, uuid, smallint, smallint) to authenticated;
grant select on public.grievances to authenticated;
create policy grievances_staff_read on public.grievances for select to authenticated using (
  (archived_at is null or (select app.is_super_admin()))
  and (
        (select app.has_perm('grievance.read.all'))
     or ((select app.has_perm('grievance.read.scope'))
         and (assigned_officer_id = (select auth.uid())
              or app.in_officer_scope((select auth.uid()), community_id, community_type_id, cluster_id)))
     or ((select app.has_perm('grievance.read.entered')) and created_by = (select auth.uid()))
  )
);
-- No INSERT/UPDATE/DELETE policies: writes go through the workflow functions.

do $$
declare t text;
begin
  foreach t in array array['grievance_status_history','grievance_assignments','grievance_comments','grievance_actions',
                           'grievance_resolutions','grievance_acknowledgements','attachments','grievance_flags']
  loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %1$s_read on public.%1$s for select to authenticated
                    using (app.can_read_grievance(grievance_id))', t);
  end loop;
end $$;

grant select on public.grievance_overview to authenticated;

-- ---- submission codes ----------------------------------------------------------------
grant select on public.submission_codes to authenticated;
create policy submission_codes_read on public.submission_codes for select to authenticated
  using ((select app.has_perm('codes.manage')));

-- ---- notifications -------------------------------------------------------------------
grant select on public.notifications to authenticated;
create policy notifications_read_own on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
grant select on public.notification_deliveries to authenticated;
create policy notification_deliveries_read on public.notification_deliveries for select to authenticated
  using ((select app.has_perm('notifications.manage')));

-- ---- audit & import --------------------------------------------------------------------
grant select on public.audit_logs to authenticated;
create policy audit_logs_read on public.audit_logs for select to authenticated
  using ((select app.has_perm('audit.view')));

grant select on public.import_batches, public.legacy_source_records, public.legacy_value_mappings to authenticated;
grant insert, update on public.legacy_value_mappings to authenticated;
create policy import_batches_read on public.import_batches for select to authenticated
  using ((select app.has_perm('import.run')));
-- Staff who can read a grievance can see its original Excel row(s).
create policy legacy_source_records_read on public.legacy_source_records for select to authenticated
  using ((select app.has_perm('import.run')) or (grievance_id is not null and app.can_read_grievance(grievance_id)));
create policy legacy_value_mappings_read on public.legacy_value_mappings for select to authenticated
  using ((select app.has_perm('import.run')));
create policy legacy_value_mappings_write on public.legacy_value_mappings for insert to authenticated
  with check ((select app.has_perm('import.run')));
create policy legacy_value_mappings_update on public.legacy_value_mappings for update to authenticated
  using ((select app.has_perm('import.run'))) with check ((select app.has_perm('import.run')));

-- tracking_counters: no access at all outside SECURITY DEFINER code.

-- ---- API functions ---------------------------------------------------------------------
grant execute on function
  public.my_access(), public.my_profile(), public.update_my_profile(jsonb),
  public.get_submission_status(uuid), public.submit_grievance(jsonb), public.submit_grievance_assisted(jsonb),
  public.create_submission_code(jsonb), public.release_submission_code(uuid), public.deactivate_submission_code(uuid, text),
  public.my_notifications(timestamptz, int), public.mark_notifications_read(bigint[]),
  public.assign_grievance(uuid, uuid, text), public.change_grievance_status(uuid, text, text, boolean),
  public.add_grievance_comment(uuid, text, text), public.add_grievance_action(uuid, text, text, date),
  public.update_grievance_triage(uuid, jsonb), public.resolve_grievance(uuid, text, text),
  public.request_acknowledgement(uuid), public.acknowledge_resolution(uuid, text, text),
  public.record_acknowledgement(uuid, text, text, text), public.amend_grievance_text(uuid, text, text, text),
  public.request_grievance_archive(uuid, text), public.archive_grievance(uuid, text), public.restore_grievance(uuid),
  public.hard_delete_grievance(uuid, text),
  public.my_grievances(timestamptz), public.my_grievance_detail(uuid), public.find_my_grievance(text),
  public.admin_set_user_roles(uuid, text[]), public.admin_set_user_active(uuid, boolean),
  public.admin_update_profile(uuid, jsonb), public.admin_set_officer_scopes(uuid, jsonb), public.list_staff()
to authenticated;

-- Notification dispatcher: server-side only.
grant execute on function
  public.claim_notification_deliveries(text, int), public.report_notification_delivery(bigint, boolean, text, text, boolean),
  public.apply_provider_status(text, text, timestamptz, text)
to service_role;

-- ============================== 20260923001000_legacy_import_fn.sql
-- =============================================================================
-- Historical import function + overdue alert batching.
--
-- app.import_legacy_batch(batch, records) takes rows already read and
-- normalised by scripts/migration/import_workbooks.py (dates parsed,
-- duplicates classified) and:
--   * maps legacy values (community aliases, category/status/severity via
--     legacy_value_mappings) — never overwriting the original text, which is
--     kept in legacy_* columns and verbatim in legacy_source_records.raw;
--   * creates one grievance per 'primary' record with an IPL-GRV-YYYY-Hnnnnn ID;
--   * links 'overlap_copy' / 'excluded_duplicate' rows to their primary;
--   * raises review flags instead of guessing.
-- Idempotent per file: a file already imported is refused.
-- =============================================================================

-- Legacy resolutions often have no recorded date; don't invent one.
alter table public.grievance_resolutions alter column resolved_at drop not null;

create or replace function app.import_legacy_batch(p_batch jsonb, p_records jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_batch uuid;
  r jsonb; f jsonb;
  v_key_map jsonb := '{}'::jsonb;         -- record key -> grievance id
  v_comm uuid; v_cat smallint; v_sub smallint; v_sev smallint; v_status smallint; v_status_code text;
  v_received date; v_year int; v_tid text; v_gid uuid; v_officer uuid; v_phone text;
  v_closed_on date; v_is_open boolean; v_flags jsonb;
  n_primary int := 0; n_linked int := 0; n_excluded int := 0; n_flags int := 0;
begin
  if exists (select 1 from public.import_batches where file_sha256 = p_batch ->> 'file_sha256' and status = 'imported') then
    raise exception 'file_already_imported' using errcode = '23505';
  end if;

  insert into public.import_batches (file_name, file_sha256, workbook, status, column_map, created_by)
  values (p_batch ->> 'file_name', p_batch ->> 'file_sha256', p_batch ->> 'workbook', 'draft', p_batch -> 'column_map', auth.uid())
  returning id into v_batch;

  -- ---- pass 1: primary records become grievances ----------------------------------
  for r in select * from jsonb_array_elements(p_records) where value ->> 'role' = 'primary' loop
    f := r -> 'fields';
    v_flags := coalesce(r -> 'flags', '[]'::jsonb);

    -- community: exact name, then alias
    select id into v_comm from public.communities where app.norm_key(name) = app.norm_key(f ->> 'community');
    if v_comm is null then
      select community_id into v_comm from public.community_aliases where alias_norm = app.norm_key(f ->> 'community');
    end if;
    if v_comm is null then
      v_flags := v_flags || jsonb_build_array(jsonb_build_object('flag','community_unknown','detail',
                   jsonb_build_object('value', f ->> 'community')));
    end if;

    -- sub-category / category / severity
    select id, category_id into v_sub, v_cat from public.grievance_subcategories
     where app.norm_key(name) = app.norm_key(f ->> 'subcategory');
    if v_cat is null then
      select id into v_cat from public.grievance_categories where app.norm_key(name) = app.norm_key(f ->> 'category');
    end if;
    if v_cat is null then
      select target_id::smallint into v_cat from public.legacy_value_mappings
       where field = 'category' and legacy_value_norm = app.norm_key(f ->> 'category');
    end if;
    if v_cat is null and nullif(btrim(coalesce(f ->> 'category', '')), '') is not null then
      v_flags := v_flags || jsonb_build_array(jsonb_build_object('flag','unmapped_value','detail',
                   jsonb_build_object('field','category','value', f ->> 'category')));
    end if;
    if v_sub is null and nullif(btrim(coalesce(f ->> 'subcategory', '')), '') is not null then
      v_flags := v_flags || jsonb_build_array(jsonb_build_object('flag','unmapped_value','detail',
                   jsonb_build_object('field','subcategory','value', f ->> 'subcategory')));
    end if;
    select target_id::smallint into v_sev from public.legacy_value_mappings
     where field = 'severity' and legacy_value_norm = app.norm_key(f ->> 'severity');

    -- status (an explicit override carries a reconciliation decision, e.g. Closed vs Resolved)
    v_status_code := null;
    select s.code into v_status_code from public.legacy_value_mappings m
      join public.grievance_statuses s on s.id = m.target_id::smallint
     where m.field = 'status' and m.legacy_value_norm = app.norm_key(coalesce(f ->> 'status_override', f ->> 'status'));
    if v_status_code = 'ASSIGNED' and nullif(f ->> 'closure_officer', '') is null then v_status_code := 'SUBMITTED'; end if;
    if v_status_code is null then
      v_status_code := 'SUBMITTED';
      v_flags := v_flags || jsonb_build_array(jsonb_build_object('flag','unmapped_value','detail',
                   jsonb_build_object('field','status','value', f ->> 'status')));
    end if;
    v_status := app.status_id(v_status_code);
    select is_open into v_is_open from public.grievance_statuses where id = v_status;

    v_phone := app.normalize_phone(f ->> 'phone');
    if v_phone is null and nullif(btrim(coalesce(f ->> 'phone', '')), '') is not null then
      v_flags := v_flags || jsonb_build_array(jsonb_build_object('flag','invalid_phone','detail',
                   jsonb_build_object('value', f ->> 'phone')));
    end if;

    v_received := coalesce((f ->> 'date_received')::date, (f ->> 'submitted_date')::date, (f ->> 'form_issued_date')::date);
    if v_received is null then
      raise exception 'row % of % has no usable date', r ->> 'row', r ->> 'sheet';
    end if;
    v_year := extract(year from v_received)::int;
    v_closed_on := coalesce((f ->> 'closure_date')::date, (f ->> 'review_date')::date);

    select id into v_officer from public.profiles
     where app.norm_key(full_name) = app.norm_key(f ->> 'closure_officer') and is_active limit 1;

    v_tid := app.next_tracking_id(v_year, true);
    insert into public.grievances (
      tracking_id, origin, is_legacy, legacy_needs_review,
      date_received, date_received_precision, form_issued_date, review_date, review_date_precision,
      resolved_at, closed_at,
      complainant_name, complainant_gender, complainant_phone,
      community_id, title, category_id, subcategory_id, severity_id,
      description, incident_details, desired_resolution, suggestions,
      status_id, closure_officer_id, responsibility, ack_state, sla_started_at,
      legacy_tracking_id, legacy_category, legacy_subcategory, legacy_status, legacy_severity,
      legacy_community, legacy_community_category, legacy_community_type, legacy_responsibility, legacy_closure_officer,
      source_workbook, source_sheet, source_row, source_year, import_batch_id)
    values (
      v_tid, 'legacy_import', true, coalesce((f ->> 'needs_review')::boolean, false),
      v_received, coalesce(f ->> 'date_received_precision', 'day'), (f ->> 'form_issued_date')::date,
      (f ->> 'review_date')::date, f ->> 'review_date_precision',
      case when v_status_code in ('RESOLVED','CLOSED') then v_closed_on::timestamptz end,
      case when v_status_code = 'CLOSED' then v_closed_on::timestamptz end,
      nullif(btrim(f ->> 'name'), ''), case lower(f ->> 'gender') when 'male' then 'male' when 'female' then 'female' end, v_phone,
      v_comm, left(regexp_replace(f ->> 'description', '\s+', ' ', 'g'), 80), v_cat, v_sub, v_sev,
      f ->> 'description', nullif(f ->> 'incident_details', ''), nullif(f ->> 'desired_resolution', ''), nullif(f ->> 'suggestions', ''),
      v_status, case when v_status_code = 'CLOSED' then v_officer end, nullif(f ->> 'responsibility', ''),
      case when v_status_code in ('RESOLVED','CLOSED') then 'not_captured' else 'not_requested' end,
      case when v_is_open then v_received::timestamptz end,
      nullif(f ->> 'legacy_tracking_id', ''), f ->> 'category', f ->> 'subcategory', f ->> 'status', f ->> 'severity',
      f ->> 'community', f ->> 'community_category', f ->> 'community_type', f ->> 'responsibility', f ->> 'closure_officer',
      r ->> 'workbook', r ->> 'sheet', (r ->> 'row')::int, (f ->> 'source_year')::int, v_batch)
    returning id into v_gid;

    -- Timeline as far as the source records it.
    insert into public.grievance_status_history (grievance_id, from_status_id, to_status_id, changed_at, note)
    values (v_gid, null, app.status_id('SUBMITTED'), v_received::timestamptz, 'Imported from ' || (r ->> 'workbook'));
    if v_status_code <> 'SUBMITTED' then
      insert into public.grievance_status_history (grievance_id, from_status_id, to_status_id, changed_at, note)
      values (v_gid, app.status_id('SUBMITTED'), v_status,
              coalesce(v_closed_on::timestamptz, v_received::timestamptz), 'Status as recorded in ' || (r ->> 'sheet'));
    end if;

    if nullif(btrim(f ->> 'officer_remarks'), '') is not null then
      insert into public.grievance_comments (grievance_id, kind, visibility, body, created_at)
      values (v_gid, 'officer_remark', 'internal', f ->> 'officer_remarks',
              coalesce((f ->> 'review_date')::timestamptz, v_received::timestamptz));
    end if;
    if nullif(btrim(f ->> 'management_action'), '') is not null then
      insert into public.grievance_actions (grievance_id, action_type, description, action_date, action_date_precision)
      values (v_gid, 'management_action', f ->> 'management_action', (f ->> 'review_date')::date,
              coalesce(f ->> 'review_date_precision', 'day'));
    end if;
    if nullif(btrim(f ->> 'resolution_details'), '') is not null then
      insert into public.grievance_resolutions (grievance_id, details, resolved_at, is_current)
      values (v_gid, f ->> 'resolution_details',
              case when v_status_code in ('RESOLVED','CLOSED') then v_closed_on::timestamptz end,
              v_status_code in ('RESOLVED','CLOSED'));
    end if;

    -- Open items go to the responsible officer, as live work.
    if v_is_open and v_comm is not null then
      v_officer := (select app.pick_officer(g.community_id, g.community_type_id, g.cluster_id)
                    from public.grievances g where g.id = v_gid);
      if v_officer is not null then
        update public.grievances set assigned_officer_id = v_officer where id = v_gid;
        insert into public.grievance_assignments (grievance_id, officer_id, reason) values (v_gid, v_officer, 'import: responsibility');
      end if;
    end if;

    insert into public.grievance_flags (grievance_id, flag, detail)
    select v_gid, x ->> 'flag', x -> 'detail' from jsonb_array_elements(v_flags) x;
    n_flags := n_flags + jsonb_array_length(v_flags);

    insert into public.legacy_source_records (batch_id, workbook, sheet, row_number, source_serial, raw, grievance_id, match_role, note)
    values (v_batch, r ->> 'workbook', r ->> 'sheet', (r ->> 'row')::int, r ->> 'serial', r -> 'raw', v_gid, 'primary', r ->> 'note');

    v_key_map := v_key_map || jsonb_build_object(r ->> 'key', v_gid);
    n_primary := n_primary + 1;
    v_comm := null; v_cat := null; v_sub := null; v_sev := null; v_officer := null;
  end loop;

  -- ---- pass 2: rows that are kept only as source evidence ------------------------------
  for r in select * from jsonb_array_elements(p_records) where value ->> 'role' <> 'primary' loop
    insert into public.legacy_source_records (batch_id, workbook, sheet, row_number, source_serial, raw, grievance_id, match_role, note)
    values (v_batch, r ->> 'workbook', r ->> 'sheet', (r ->> 'row')::int, r ->> 'serial', r -> 'raw',
            (v_key_map ->> (r ->> 'link_key'))::uuid, r ->> 'role', r ->> 'note');
    if r ->> 'role' = 'overlap_copy' then n_linked := n_linked + 1; else n_excluded := n_excluded + 1; end if;
  end loop;

  update public.import_batches set status = 'imported', imported_at = now(),
         counts = jsonb_build_object('total', jsonb_array_length(p_records), 'imported', n_primary,
                                     'linked_copies', n_linked, 'excluded', n_excluded, 'flags', n_flags),
         report = p_batch -> 'report'
   where id = v_batch;
  perform app.log('import.batch_imported', 'import_batches', v_batch::text, null,
                  (select counts from public.import_batches where id = v_batch));
  return (select counts || jsonb_build_object('batch_id', v_batch) from public.import_batches where id = v_batch);
end $$;

-- Undo a whole batch (grievances created by it and their source rows).
create or replace function app.rollback_legacy_batch(p_batch uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  delete from public.grievances where import_batch_id = p_batch;
  get diagnostics n = row_count;
  delete from public.legacy_source_records where batch_id = p_batch;
  update public.import_batches set status = 'rolled_back', rolled_back_at = now() where id = p_batch;
  perform app.log('import.batch_rolled_back', 'import_batches', p_batch::text, null, jsonb_build_object('grievances', n));
  return n;
end $$;

-- -----------------------------------------------------------------------------
-- Overdue alerts, batched: an officer with several newly overdue grievances
-- gets one summary instead of a burst (important right after the import).
-- -----------------------------------------------------------------------------
create or replace function app.scan_overdue() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o record; n int := 0;
  v_realert interval := make_interval(hours => coalesce((app.setting('overdue_realert_hours'))::int, 24));
begin
  create temp table if not exists _due (id uuid, tracking_id text, officer uuid, started timestamptz,
                                        community uuid, category smallint) on commit drop;
  truncate _due;
  insert into _due
  select g.id, g.tracking_id, g.assigned_officer_id, g.sla_started_at, g.community_id, g.category_id
  from public.grievances g
  join public.grievance_statuses st on st.id = g.status_id
  where st.is_open and not st.stops_sla and g.archived_at is null and not g.legacy_needs_review
    and g.sla_due_at < now()
    and (g.last_overdue_alert_at is null or g.last_overdue_alert_at < now() - v_realert)
  for update of g skip locked;

  update public.grievances g set overdue_since = coalesce(g.overdue_since, g.sla_due_at), last_overdue_alert_at = now()
  from _due d where d.id = g.id;

  for o in select officer, count(*) as cnt from _due where officer is not null group by officer loop
    if o.cnt <= 3 then
      perform app.notify(o.officer, 'grievance_overdue', 'Attention required',
        format('Grievance %s has been unresolved for %s working days. Community: %s. Category: %s.',
               d.tracking_id, app.days_outstanding(d.started), app.community_name(d.community),
               coalesce((select name from public.grievance_categories where id = d.category), 'Not set')),
        d.id, jsonb_build_object('tracking_id', d.tracking_id, 'days', app.days_outstanding(d.started)))
      from _due d where d.officer = o.officer;
    else
      perform app.notify(o.officer, 'grievance_overdue', 'Attention required',
        format('%s grievances assigned to you are past the %s-day limit. Open "Overdue" to see them.',
               o.cnt, coalesce((app.setting('sla_threshold_days'))::int, 3)),
        null, jsonb_build_object('count', o.cnt,
                                 'tracking_ids', (select jsonb_agg(tracking_id order by started) from
                                                    (select tracking_id, started from _due where officer = o.officer
                                                     order by started limit 20) x)));
    end if;
  end loop;
  select count(*) into n from _due;
  return n;
end $$;

-- ============================== 20260923001100_app_api.sql
-- =============================================================================
-- App read API. The PWA talks to the database through these functions (plus
-- the workflow functions): one round trip per screen, small payloads,
-- server-side filtering and pagination, and a stable contract.
--
-- Staff list/detail/export are SECURITY INVOKER: the grievances RLS policy
-- decides what each caller sees. Dashboard aggregates are SECURITY DEFINER
-- with an explicit scope so the Viewer role gets totals without row access.
-- =============================================================================

-- ---- master data in one call (cached on the device by version) ------------------------
create or replace function public.get_master_data() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'version', (select version from public.master_data_version),
    'community_types', (select jsonb_agg(jsonb_build_object('id', id, 'code', code, 'name', name, 'has_clusters', has_clusters)
                                         order by sort_order) from public.community_types where active),
    'clusters', (select jsonb_agg(jsonb_build_object('id', id, 'community_type_id', community_type_id, 'name', name)
                                  order by sort_order) from public.clusters where active),
    'communities', (select jsonb_agg(jsonb_build_object(
                       'id', c.id, 'name', c.name,
                       'affiliations', (select jsonb_agg(jsonb_build_object('community_type_id', a.community_type_id,
                                                'cluster_id', a.cluster_id, 'is_primary', a.is_primary)
                                                order by a.is_primary desc)
                                        from public.community_affiliations a where a.community_id = c.id and a.active))
                     order by c.name) from public.communities c where c.active),
    'categories', (select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'public_label', public_label,
                                                       'public_hint', public_hint, 'icon', icon) order by sort_order)
                   from public.grievance_categories where active),
    'subcategories', (select jsonb_agg(jsonb_build_object('id', id, 'category_id', category_id, 'name', name) order by name)
                      from public.grievance_subcategories where active),
    'statuses', (select jsonb_agg(jsonb_build_object('id', id, 'code', code, 'staff_label', staff_label,
                                                     'public_label', public_label, 'public_message', public_message,
                                                     'is_open', is_open, 'tone', tone, 'icon', icon) order by sort_order)
                 from public.grievance_statuses where active),
    'severities', (select jsonb_agg(jsonb_build_object('id', id, 'code', code, 'name', name, 'tone', tone) order by sort_order)
                   from public.severities where active),
    'settings', (select jsonb_object_agg(key, value) from public.settings where is_public))
$$;

-- ---- shared filter predicate ---------------------------------------------------------------
-- Filters: q, year, date_from, date_to, community_type_id, cluster_id, community_id, category_id,
-- subcategory_id, severity_id, status (array of codes), officer_id, open, overdue, due_soon,
-- flagged, legacy, needs_ack.
create or replace function app.matches_filters(g public.grievance_overview, f jsonb) returns boolean
language sql stable set search_path = public, pg_temp as $$
  select (f ->> 'year' is null or g.year = (f ->> 'year')::int)
     and (f ->> 'date_from' is null or g.date_received >= (f ->> 'date_from')::date)
     and (f ->> 'date_to' is null or g.date_received <= (f ->> 'date_to')::date)
     and (f ->> 'community_type_id' is null or g.community_type_id = (f ->> 'community_type_id')::smallint)
     and (f ->> 'cluster_id' is null or g.cluster_id = (f ->> 'cluster_id')::smallint)
     and (f ->> 'community_id' is null or g.community_id = (f ->> 'community_id')::uuid)
     and (f ->> 'category_id' is null or g.category_id = (f ->> 'category_id')::smallint)
     and (f ->> 'subcategory_id' is null or g.subcategory_id = (f ->> 'subcategory_id')::smallint)
     and (f ->> 'severity_id' is null or g.severity_id = (f ->> 'severity_id')::smallint)
     and (f -> 'status' is null or jsonb_array_length(f -> 'status') = 0 or g.status_code in (select jsonb_array_elements_text(f -> 'status')))
     and (f ->> 'officer_id' is null or g.assigned_officer_id = (f ->> 'officer_id')::uuid)
     and (f ->> 'unassigned' is null or ((f ->> 'unassigned')::boolean and g.assigned_officer_id is null and g.is_open))
     and (f ->> 'open' is null or g.is_open = (f ->> 'open')::boolean)
     and (f ->> 'overdue' is null or coalesce(g.is_overdue, false) = (f ->> 'overdue')::boolean)
     and (f ->> 'due_soon' is null or coalesce(g.is_due_soon, false) = (f ->> 'due_soon')::boolean)
     and (f ->> 'flagged' is null or (g.open_flags > 0) = (f ->> 'flagged')::boolean)
     and (f ->> 'legacy' is null or g.is_legacy = (f ->> 'legacy')::boolean)
     and (f ->> 'needs_ack' is null or ((g.status_code = 'RESOLVED' and g.ack_state = 'pending') = (f ->> 'needs_ack')::boolean))
     and (coalesce(btrim(f ->> 'q'), '') = ''
          or g.tracking_id ilike '%' || btrim(f ->> 'q') || '%'
          or upper(coalesce(g.legacy_tracking_id, '')) like '%' || upper(regexp_replace(f ->> 'q', '\s', '', 'g')) || '%'
          or g.complainant_name ilike '%' || btrim(f ->> 'q') || '%'
          or (length(regexp_replace(f ->> 'q', '\D', '', 'g')) >= 6
              and g.complainant_phone like '%' || right(regexp_replace(f ->> 'q', '\D', '', 'g'), 10) || '%')
          or g.community_name ilike '%' || btrim(f ->> 'q') || '%'
          or g.category_name ilike '%' || btrim(f ->> 'q') || '%'
          or g.description ilike '%' || btrim(f ->> 'q') || '%')
$$;
grant execute on function app.matches_filters(public.grievance_overview, jsonb) to authenticated;

-- ---- staff list (paginated, filtered, sorted) -------------------------------------------------
create or replace function public.staff_grievance_list(p_filters jsonb default '{}', p_page int default 1,
                                                      p_page_size int default 25, p_sort text default 'received_desc')
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_size int := least(greatest(coalesce(p_page_size, 25), 1), 100);
  v_offset int := (greatest(coalesce(p_page, 1), 1) - 1) * v_size;
  v_total int; v_rows jsonb;
begin
  if not (app.has_perm('grievance.read.all') or app.has_perm('grievance.read.scope') or app.has_perm('grievance.read.entered')) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  with f as (
    select g.* from public.grievance_overview g
    where app.matches_filters(g, coalesce(p_filters, '{}'))
      and (case when coalesce((p_filters ->> 'archived')::boolean, false) then g.archived_at is not null else g.archived_at is null end)
  ), page as (
    select * from f
    order by
      case when p_sort = 'overdue_first' then f.is_overdue end desc nulls last,
      case when p_sort in ('received_asc') then f.date_received end asc,
      case when p_sort in ('received_desc','overdue_first') or p_sort is null then f.date_received end desc,
      case when p_sort = 'updated_desc' then f.updated_at end desc,
      case when p_sort = 'days_desc' then f.days_outstanding end desc nulls last,
      f.tracking_id desc
    limit v_size offset v_offset
  )
  select (select count(*) from f),
         coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'tracking_id', tracking_id, 'legacy_tracking_id', legacy_tracking_id, 'title', title,
           'date_received', date_received, 'date_received_precision', date_received_precision,
           'complainant_name', complainant_name, 'community_name', community_name, 'community_type', community_type,
           'cluster_name', cluster_name, 'category_name', category_name, 'severity_name', severity_name,
           'status_code', status_code, 'status_label', status_label, 'status_tone', status_tone, 'is_open', is_open,
           'assigned_officer_name', assigned_officer_name, 'days_outstanding', days_outstanding,
           'is_overdue', is_overdue, 'is_due_soon', is_due_soon, 'ack_state', ack_state, 'is_legacy', is_legacy,
           'open_flags', open_flags, 'updated_at', updated_at)), '[]'::jsonb)
    into v_total, v_rows
  from page;
  return jsonb_build_object('total', v_total, 'page', greatest(coalesce(p_page, 1), 1), 'page_size', v_size, 'rows', v_rows);
end $$;

-- ---- staff detail (everything about one grievance the caller may see) --------------------------
create or replace function public.staff_grievance_detail(p_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare o public.grievance_overview; g public.grievances; v jsonb;
begin
  select * into o from public.grievance_overview where id = p_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into g from public.grievances where id = p_id;

  v := to_jsonb(o) || jsonb_build_object(
    'incident_details', g.incident_details, 'desired_resolution', g.desired_resolution, 'suggestions', g.suggestions,
    'complainant_email', g.complainant_email, 'complainant_address', g.complainant_address,
    'form_issued_date', g.form_issued_date, 'review_date', g.review_date, 'first_response_at', g.first_response_at,
    'responsibility', g.responsibility, 'text_amended', g.text_amended, 'sla_started_at', g.sla_started_at,
    'closure_officer_name', app.profile_name(g.closure_officer_id),
    'legacy', jsonb_strip_nulls(jsonb_build_object(
       'tracking_id', g.legacy_tracking_id, 'category', g.legacy_category, 'subcategory', g.legacy_subcategory,
       'status', g.legacy_status, 'severity', g.legacy_severity, 'community', g.legacy_community,
       'community_category', g.legacy_community_category, 'community_type', g.legacy_community_type,
       'responsibility', g.legacy_responsibility, 'closure_officer', g.legacy_closure_officer,
       'workbook', g.source_workbook, 'sheet', g.source_sheet, 'row', g.source_row, 'year', g.source_year)),
    'affiliations', (select jsonb_agg(jsonb_build_object('community_type_id', a.community_type_id, 'type', t.name,
                                                         'cluster', cl.name, 'is_primary', a.is_primary))
                     from public.community_affiliations a join public.community_types t on t.id = a.community_type_id
                     left join public.clusters cl on cl.id = a.cluster_id
                     where a.community_id = g.community_id and a.active),
    'history', (select coalesce(jsonb_agg(x order by x.at), '[]') from (
        select 'status' as kind, h.changed_at as at, app.profile_name(h.changed_by) as by_name,
               fs.staff_label as from_label, ts.staff_label as label, ts.tone, h.note as body, h.visible_to_complainant as public
        from public.grievance_status_history h
        left join public.grievance_statuses fs on fs.id = h.from_status_id
        join public.grievance_statuses ts on ts.id = h.to_status_id
        where h.grievance_id = p_id
        union all
        select 'comment', c.created_at, app.profile_name(c.author_id), null, c.kind, null, c.body, c.visibility = 'complainant'
        from public.grievance_comments c where c.grievance_id = p_id
        union all
        select 'action', coalesce(a.action_date::timestamptz, a.created_at), app.profile_name(a.created_by), null,
               a.action_type, null, a.description, false
        from public.grievance_actions a where a.grievance_id = p_id
        union all
        select 'assignment', s.assigned_at, app.profile_name(s.assigned_by), null, app.profile_name(s.officer_id), null, s.reason, false
        from public.grievance_assignments s where s.grievance_id = p_id
        union all
        select 'acknowledgement', k.created_at, coalesce(app.profile_name(k.recorded_by), 'Complainant'), null, k.response,
               case k.response when 'acknowledged' then 'success' else 'warning' end, k.reason, true
        from public.grievance_acknowledgements k where k.grievance_id = p_id) x),
    'resolution', (select jsonb_build_object('details', r.details, 'public_summary', r.public_summary,
                                             'resolved_at', r.resolved_at, 'resolved_by', app.profile_name(r.resolved_by))
                   from public.grievance_resolutions r where r.grievance_id = p_id and r.is_current),
    'flags', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'flag', f.flag, 'detail', f.detail,
                                                           'created_at', f.created_at, 'resolved_at', f.resolved_at)
                                        order by f.created_at), '[]')
              from public.grievance_flags f where f.grievance_id = p_id),
    'sources', (select coalesce(jsonb_agg(jsonb_build_object('workbook', s.workbook, 'sheet', s.sheet, 'row', s.row_number,
                                                             'role', s.match_role, 'note', s.note, 'raw', s.raw)
                                          order by s.match_role, s.sheet, s.row_number), '[]')
                from public.legacy_source_records s where s.grievance_id = p_id),
    'can', jsonb_build_object(
       'assign', app.has_perm('grievance.assign'), 'update_status', app.has_perm('grievance.update_status'),
       'comment', app.has_perm('grievance.comment'), 'resolve', app.has_perm('grievance.resolve'),
       'close', app.has_perm('grievance.close'), 'triage', app.has_perm('grievance.triage'),
       'record_ack', app.has_perm('grievance.acknowledge.record'), 'amend', app.has_perm('grievance.amend_text'),
       'archive', app.has_perm('grievance.archive'), 'request_archive', app.has_perm('grievance.archive.request'),
       'hard_delete', app.has_perm('grievance.hard_delete')),
    'next_statuses', (select coalesce(jsonb_agg(jsonb_build_object('code', t.code, 'label', t.staff_label) order by t.sort_order), '[]')
                      from public.grievance_status_transitions tr join public.grievance_statuses t on t.id = tr.to_status_id
                      where tr.from_status_id = g.status_id and t.code not in ('RESOLVED')
                        and app.has_perm(tr.required_permission)));
  return v;
end $$;

-- Resolve a review flag (staff who can work the grievance).
create or replace function public.resolve_grievance_flag(p_flag_id bigint, p_resolution text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_gid uuid;
begin
  select grievance_id into v_gid from public.grievance_flags where id = p_flag_id and resolved_at is null;
  if v_gid is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform app.load_for_work(v_gid, 'grievance.triage');
  update public.grievance_flags set resolved_at = now(), resolved_by = auth.uid(), resolution = app.clean_text(p_resolution, 500)
   where id = p_flag_id;
  -- Reviewing an old open item releases it to the normal overdue workflow.
  update public.grievances set legacy_needs_review = false, sla_started_at = coalesce(sla_started_at, now())
   where id = v_gid and legacy_needs_review
     and not exists (select 1 from public.grievance_flags where grievance_id = v_gid and resolved_at is null and flag = 'needs_review');
end $$;

-- ---- dashboards ---------------------------------------------------------------------------
-- Scope: read.all (or dashboard-only roles such as Viewer) -> everything; officers -> their scope.
create or replace function app.dashboard_scope_ok(g public.grievances) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.has_perm('grievance.read.all')
      or (app.has_perm('dashboard.view') and not app.has_perm('grievance.read.scope'))
      or app.can_work(g)
$$;

create or replace function public.dashboard_stats(p_filters jsonb default '{}') returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare f jsonb := coalesce(p_filters, '{}'); v jsonb;
begin
  perform app.require_perm('dashboard.view');
  create temp table if not exists _d on commit drop as select * from public.grievance_overview limit 0;
  truncate _d;
  insert into _d
  select o.* from public.grievance_overview o join public.grievances g on g.id = o.id
  where o.archived_at is null and app.dashboard_scope_ok(g) and app.matches_filters(o, f);

  select jsonb_build_object(
    'kpis', (select jsonb_build_object(
        'total', count(*),
        'open', count(*) filter (where is_open),
        'submitted', count(*) filter (where status_code = 'SUBMITTED'),
        'under_review', count(*) filter (where status_code in ('UNDER_REVIEW','ASSIGNED')),
        'in_progress', count(*) filter (where status_code in ('IN_PROGRESS','AWAITING_ACTION','REOPENED')),
        'resolved', count(*) filter (where status_code = 'RESOLVED'),
        'closed', count(*) filter (where status_code = 'CLOSED'),
        'overdue', count(*) filter (where is_overdue),
        'due_soon', count(*) filter (where is_due_soon),
        'awaiting_ack', count(*) filter (where status_code = 'RESOLVED' and ack_state = 'pending'),
        'resolution_rate', round(100.0 * count(*) filter (where status_code in ('RESOLVED','CLOSED')) / nullif(count(*), 0), 1),
        'avg_resolution_days', round(avg(extract(epoch from (resolved_at - coalesce(submitted_at, date_received::timestamptz))) / 86400)
                                     filter (where resolved_at is not null and date_received_precision = 'day'), 1))
      from _d),
    'by_year', (select coalesce(jsonb_agg(jsonb_build_object('key', year, 'total', n, 'open', o) order by year), '[]')
                from (select year, count(*) n, count(*) filter (where is_open) o from _d group by year) x),
    'by_month', (select coalesce(jsonb_agg(jsonb_build_object('key', to_char(m, 'YYYY-MM'),
                         'received', (select count(*) from _d where date_trunc('month', date_received) = m),
                         'resolved', (select count(*) from _d where date_trunc('month', resolved_at at time zone app.tz()) = m))
                       order by m), '[]')
                 -- every one of the last 12 months, including months with none
                 from generate_series(date_trunc('month', coalesce((f ->> 'date_to')::date, current_date)) - interval '11 months',
                                      date_trunc('month', coalesce((f ->> 'date_to')::date, current_date)), interval '1 month') m),
    'by_type', (select coalesce(jsonb_agg(jsonb_build_object('key', coalesce(community_type, 'Unclassified'), 'id', community_type_id,
                                                             'total', n, 'open', o) order by n desc), '[]')
                from (select community_type, community_type_id, count(*) n, count(*) filter (where is_open) o
                      from _d group by 1, 2) x),
    'by_cluster', (select coalesce(jsonb_agg(jsonb_build_object('key', cluster_name, 'id', cluster_id, 'total', n, 'open', o)
                                             order by cluster_name), '[]')
                   from (select cluster_name, cluster_id, count(*) n, count(*) filter (where is_open) o
                         from _d where cluster_id is not null group by 1, 2) x),
    'by_community', (select coalesce(jsonb_agg(jsonb_build_object('key', coalesce(community_name, 'Unknown'), 'id', community_id,
                                                                  'total', n, 'open', o) order by n desc), '[]')
                     from (select community_name, community_id, count(*) n, count(*) filter (where is_open) o
                           from _d group by 1, 2 order by 3 desc limit 15) x),
    'by_category', (select coalesce(jsonb_agg(jsonb_build_object('key', coalesce(category_name, 'Not categorised'), 'id', category_id,
                                                                 'total', n, 'open', o) order by n desc), '[]')
                    from (select category_name, category_id, count(*) n, count(*) filter (where is_open) o
                          from _d group by 1, 2) x),
    'by_severity', (select coalesce(jsonb_agg(jsonb_build_object('key', coalesce(severity_name, 'Not set'), 'id', severity_id,
                                                                 'total', n) order by sev_order nulls last), '[]')
                    from (select d.severity_name, d.severity_id, count(*) n, max(s.sort_order) sev_order
                          from _d d left join public.severities s on s.id = d.severity_id group by 1, 2) x),
    'by_status', (select coalesce(jsonb_agg(jsonb_build_object('key', status_label, 'code', status_code, 'tone', status_tone,
                                                               'total', n) order by ord), '[]')
                  from (select d.status_label, d.status_code, d.status_tone, count(*) n, max(s.sort_order) ord
                        from _d d join public.grievance_statuses s on s.code = d.status_code group by 1, 2, 3) x),
    'officer_workload', (select coalesce(jsonb_agg(jsonb_build_object('key', coalesce(assigned_officer_name, 'Unassigned'),
                                                                      'id', assigned_officer_id, 'open', o, 'overdue', od,
                                                                      'resolved', r) order by o desc), '[]')
                         from (select assigned_officer_name, assigned_officer_id, count(*) filter (where is_open) o,
                                      count(*) filter (where is_overdue) od,
                                      count(*) filter (where status_code in ('RESOLVED','CLOSED')) r
                               from _d group by 1, 2 having count(*) filter (where is_open) > 0) x),
    'years', (select coalesce(jsonb_agg(distinct year order by year), '[]') from public.grievances where archived_at is null))
  into v;
  return v;
end $$;

-- Officer home cards: my assigned work.
create or replace function public.officer_home() returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'overdue',      count(*) filter (where is_overdue),
    'due_soon',     count(*) filter (where is_due_soon),
    'new',          count(*) filter (where status_code in ('SUBMITTED','ASSIGNED')),
    'under_review', count(*) filter (where status_code = 'UNDER_REVIEW'),
    'in_progress',  count(*) filter (where status_code in ('IN_PROGRESS','AWAITING_ACTION','REOPENED')),
    'awaiting_ack', count(*) filter (where status_code = 'RESOLVED' and ack_state = 'pending'),
    'resolved',     count(*) filter (where status_code in ('RESOLVED','CLOSED')),
    'needs_review', count(*) filter (where legacy_needs_review and is_open),
    'assigned_open', count(*) filter (where is_open))
  from public.grievance_overview
  where archived_at is null and assigned_officer_id = auth.uid()
$$;

-- ---- export (rows the caller may see, filtered) ---------------------------------------------
create or replace function public.export_grievances(p_filters jsonb default '{}') returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare v jsonb;
begin
  perform app.require_perm('export.run');
  select coalesce(jsonb_agg(jsonb_build_object(
    'Tracking ID', o.tracking_id, 'Legacy Tracking ID', o.legacy_tracking_id, 'Date Received', o.date_received,
    'Year', o.year, 'Complainant', o.complainant_name, 'Phone', o.complainant_phone, 'Gender', o.complainant_gender,
    'Community', o.community_name, 'Community Type', o.community_type, 'Cluster', o.cluster_name,
    'Category', o.category_name, 'Sub-Category', o.subcategory_name, 'Severity', o.severity_name,
    'Status', o.status_label, 'Officer', o.assigned_officer_name, 'Days Outstanding', o.days_outstanding,
    'Overdue', o.is_overdue, 'Grievance', o.description, 'Desired Resolution', g.desired_resolution,
    'Resolution', (select details from public.grievance_resolutions r where r.grievance_id = o.id and r.is_current),
    'Date Resolved', o.resolved_at::date, 'Date Closed', o.closed_at::date, 'Acknowledgement', o.ack_state,
    'Legacy Category', g.legacy_category, 'Legacy Status', g.legacy_status, 'Source', g.source_workbook,
    'Source Sheet', g.source_sheet, 'Source Row', g.source_row) order by o.date_received, o.tracking_id), '[]')
  into v
  from public.grievance_overview o join public.grievances g on g.id = o.id
  where o.archived_at is null and app.matches_filters(o, coalesce(p_filters, '{}'));
  perform app.log('export.run', 'grievances', null, null,
                  jsonb_build_object('filters', p_filters, 'rows', jsonb_array_length(v)));
  return v;
end $$;

-- ---- admin lists ---------------------------------------------------------------------------
create or replace function public.list_submission_codes(p_include_inactive boolean default true) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'code', c.code, 'label', c.label, 'scope_type', c.scope_type,
    'scope_name', coalesce(cm.name, cl.name, ct.name, 'All communities'),
    'valid_from', c.valid_from, 'valid_until', c.valid_until, 'max_submissions', c.max_submissions,
    'submission_count', c.submission_count,
    'state', case when c.status = 'deactivated' then 'deactivated' when c.status = 'draft' then 'draft'
                  when now() >= c.valid_until then 'expired' when now() < c.valid_from then 'scheduled'
                  when c.max_submissions is not null and c.submission_count >= c.max_submissions then 'full'
                  else 'active' end,
    'created_by', app.profile_name(c.created_by), 'created_at', c.created_at,
    'released_by', app.profile_name(c.released_by), 'released_at', c.released_at,
    'deactivated_by', app.profile_name(c.deactivated_by), 'deactivated_at', c.deactivated_at,
    'deactivation_reason', c.deactivation_reason) order by c.created_at desc), '[]')
  from public.submission_codes c
  left join public.communities cm on cm.id = c.community_id
  left join public.clusters cl on cl.id = c.cluster_id
  left join public.community_types ct on ct.id = c.community_type_id
  where p_include_inactive or (c.status = 'active' and now() < c.valid_until)
$$;

create or replace function public.list_audit_logs(p_filters jsonb default '{}', p_page int default 1, p_page_size int default 50)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_size int := least(greatest(coalesce(p_page_size, 50), 1), 200); v jsonb; v_total int;
begin
  perform app.require_perm('audit.view');
  with f as (
    select * from public.audit_logs a
    where (p_filters ->> 'entity' is null or a.entity = p_filters ->> 'entity')
      and (p_filters ->> 'entity_id' is null or a.entity_id = p_filters ->> 'entity_id')
      and (p_filters ->> 'action' is null or a.action ilike '%' || (p_filters ->> 'action') || '%')
      and (p_filters ->> 'actor_id' is null or a.actor_id = (p_filters ->> 'actor_id')::uuid)
      and (p_filters ->> 'date_from' is null or a.at >= (p_filters ->> 'date_from')::date)
      and (p_filters ->> 'date_to' is null or a.at < (p_filters ->> 'date_to')::date + 1))
  select (select count(*) from f),
         coalesce((select jsonb_agg(jsonb_build_object('id', id, 'at', at, 'actor', coalesce(app.profile_name(actor_id), actor_role),
                                                        'action', action, 'entity', entity, 'entity_id', entity_id,
                                                        'old', old_value, 'new', new_value) order by at desc)
                   from (select * from f order by at desc limit v_size offset (greatest(p_page, 1) - 1) * v_size) p), '[]')
  into v_total, v;
  return jsonb_build_object('total', v_total, 'rows', v);
end $$;

create or replace function public.list_users(p_filters jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v jsonb;
begin
  perform app.require_perm('users.manage');
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'full_name', p.full_name, 'phone', p.phone, 'email', p.email, 'job_title', p.job_title,
    'community', c.name, 'is_active', p.is_active, 'created_at', p.created_at,
    'roles', (select coalesce(jsonb_agg(r.code order by r.code), '[]') from public.user_roles ur
              join public.roles r on r.id = ur.role_id where ur.user_id = p.id),
    'scopes', (select coalesce(jsonb_agg(jsonb_build_object('community_type', t.code, 'cluster_id', o.cluster_id,
                                                            'cluster', cl.name, 'community_id', o.community_id,
                                                            'community', cm.name, 'auto_assign', o.auto_assign)), '[]')
               from public.officer_scopes o left join public.community_types t on t.id = o.community_type_id
               left join public.clusters cl on cl.id = o.cluster_id left join public.communities cm on cm.id = o.community_id
               where o.officer_id = p.id)) order by p.full_name), '[]')
  into v
  from public.profiles p left join public.communities c on c.id = p.community_id
  where (coalesce(p_filters ->> 'kind', 'all') = 'all'
         or (p_filters ->> 'kind' = 'staff' and exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                                                        where ur.user_id = p.id and r.is_staff))
         or (p_filters ->> 'kind' = 'members' and not exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                                                              where ur.user_id = p.id and r.is_staff)))
    and (coalesce(btrim(p_filters ->> 'q'), '') = '' or p.full_name ilike '%' || (p_filters ->> 'q') || '%'
         or p.phone like '%' || regexp_replace(p_filters ->> 'q', '\D', '', 'g') || '%'
         or p.email ilike '%' || (p_filters ->> 'q') || '%');
  return v;
end $$;

create or replace function public.update_setting(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.require_perm('settings.manage');
  update public.settings set value = p_value, updated_by = auth.uid() where key = p_key;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;

create or replace function public.list_settings() returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', key, 'value', value, 'description', description,
                                               'is_public', is_public, 'updated_at', updated_at) order by key), '[]')
  from public.settings
$$;

grant execute on function
  public.get_master_data() to anon, authenticated;
grant execute on function
  public.staff_grievance_list(jsonb, int, int, text), public.staff_grievance_detail(uuid),
  public.resolve_grievance_flag(bigint, text), public.dashboard_stats(jsonb), public.officer_home(),
  public.export_grievances(jsonb), public.list_submission_codes(boolean), public.list_audit_logs(jsonb, int, int),
  public.list_users(jsonb), public.update_setting(text, jsonb), public.list_settings()
to authenticated;

-- ============================== 20260923001200_ops.sql
-- =============================================================================
-- Operational helpers used by Edge Functions.
-- =============================================================================

-- Audit a PIN reset performed through the admin-reset-pin function (the reset
-- itself happens in Supabase Auth; this records who did it, as the caller).
create or replace function public.log_pin_reset(p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.require_perm('users.manage');
  perform app.log('user.pin_reset', 'profiles', p_user::text);
end $$;
revoke execute on function public.log_pin_reset(uuid) from public, anon;
grant execute on function public.log_pin_reset(uuid) to authenticated;

-- ============================== 20260924000100_community_officers.sql
-- =============================================================================
-- Community-level officer assignment from the app (Super Admin / users.manage).
--
-- "Put <person> in charge of <community>": gives them the Officer role if they
-- don't have it, makes them the community-level officer (most specific scope,
-- so new grievances from that community are auto-assigned to them) and can
-- hand over that community's open grievances.
-- =============================================================================

-- Who is effectively in charge of each community (community > cluster > type scope).
create or replace function public.list_community_officers() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (app.has_perm('users.manage') or app.has_perm('masterdata.manage') or app.has_perm('grievance.assign')) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'community_id', c.id, 'community', c.name, 'active', c.active,
      'officer_id', o.officer_id, 'officer', p.full_name, 'via', o.via,
      'open_grievances', (select count(*) from public.grievances g join public.grievance_statuses s on s.id = g.status_id
                          where g.community_id = c.id and s.is_open and g.archived_at is null))
      order by c.name), '[]'::jsonb)
    from public.communities c
    left join lateral (
      select s.officer_id,
             case when s.community_id is not null then 'community'
                  when s.cluster_id is not null then 'cluster' else 'community type' end as via
      from public.officer_scopes s
      join public.profiles pr on pr.id = s.officer_id and pr.is_active
      join public.community_affiliations a on a.community_id = c.id and a.active and a.is_primary
      where s.auto_assign and (s.community_id = c.id or s.cluster_id = a.cluster_id or s.community_type_id = a.community_type_id)
      order by case when s.community_id is not null then 1 when s.cluster_id is not null then 2 else 3 end
      limit 1) o on true
    left join public.profiles p on p.id = o.officer_id);
end $$;

create or replace function public.admin_set_community_officer(p_community uuid, p_officer uuid, p_reassign_open boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_moved int := 0;
  g record;
begin
  perform app.require_perm('users.manage');
  if not exists (select 1 from public.communities where id = p_community) then raise exception 'community_invalid' using errcode = '22023'; end if;
  if not exists (select 1 from public.profiles where id = p_officer and is_active) then raise exception 'officer_invalid' using errcode = '22023'; end if;

  -- Anyone can be made an officer; the role is granted if missing.
  if not app.has_role(p_officer, 'officer') then
    insert into public.user_roles (user_id, role_id, granted_by)
    select p_officer, id, auth.uid() from public.roles where code = 'officer' on conflict do nothing;
    perform app.log('user.roles_changed', 'profiles', p_officer::text, null, jsonb_build_object('added', 'officer'));
  end if;

  -- One community-level officer per community.
  delete from public.officer_scopes where community_id = p_community and officer_id <> p_officer;
  insert into public.officer_scopes (officer_id, community_id, auto_assign, created_by)
  select p_officer, p_community, true, auth.uid()
  where not exists (select 1 from public.officer_scopes where officer_id = p_officer and community_id = p_community);

  if p_reassign_open then
    for g in
      select gr.id, gr.tracking_id, gr.assigned_officer_id, gr.status_id from public.grievances gr
      join public.grievance_statuses s on s.id = gr.status_id
      where gr.community_id = p_community and s.is_open and gr.archived_at is null
        and gr.assigned_officer_id is distinct from p_officer
    loop
      update public.grievance_assignments set unassigned_at = now() where grievance_id = g.id and unassigned_at is null;
      insert into public.grievance_assignments (grievance_id, officer_id, assigned_by, reason)
      values (g.id, p_officer, auth.uid(), 'community officer changed');
      update public.grievances set assigned_officer_id = p_officer where id = g.id;
      v_moved := v_moved + 1;
    end loop;
    if v_moved > 0 then
      perform app.notify(p_officer, 'officer_assigned', 'Grievances assigned to you',
        format('You are now in charge of %s. %s open grievance(s) were handed to you.', app.community_name(p_community), v_moved),
        null, jsonb_build_object('community_id', p_community, 'count', v_moved));
    end if;
  end if;

  perform app.log('community.officer_set', 'communities', p_community::text, null,
                  jsonb_build_object('officer', p_officer, 'reassigned_open', v_moved));
  return jsonb_build_object('reassigned', v_moved);
end $$;

-- Remove a community-level officer (falls back to the cluster / type officer).
create or replace function public.admin_clear_community_officer(p_community uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.require_perm('users.manage');
  delete from public.officer_scopes where community_id = p_community;
  perform app.log('community.officer_cleared', 'communities', p_community::text);
end $$;

revoke execute on function public.list_community_officers(), public.admin_set_community_officer(uuid, uuid, boolean),
  public.admin_clear_community_officer(uuid) from public, anon;
grant execute on function public.list_community_officers(), public.admin_set_community_officer(uuid, uuid, boolean),
  public.admin_clear_community_officer(uuid) to authenticated;

-- ============================== 20260925000100_shared_responsibility.sql
-- =============================================================================
-- Responsibility by community type, shared by several people.
--
-- * Put someone in charge of a whole community type (Host, Pipeline, Indirectly
--   Impacted, Jetty), a pipeline cluster, or one community, in one step.
-- * Any number of people can be in charge of the same thing. They all see and
--   can work its grievances; new grievances go to whoever of them has the
--   fewest open ones (app.pick_officer: most specific level first).
-- * Removing someone hands their open grievances that they no longer cover to
--   the others in charge (or leaves them unassigned if nobody is left).
-- * A community's secondary groups count too: whoever is in charge of Pipeline
--   Cluster 1 also sees grievances from Akpajo (Host by default, also Pipeline C1).
-- =============================================================================

-- Visibility: a scope matches the grievance's own classification, or any active
-- group its community belongs to.
create or replace function app.in_officer_scope(p_officer uuid, p_community uuid, p_type smallint, p_cluster smallint)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.officer_scopes s
    where s.officer_id = p_officer
      and (s.community_id = p_community
           or s.cluster_id = p_cluster
           or s.community_type_id = p_type
           or exists (select 1 from public.community_affiliations a
                      where a.community_id = p_community and a.active
                        and (a.community_type_id = s.community_type_id or a.cluster_id = s.cluster_id))))
$$;

-- Move one grievance to another officer (or to nobody), keeping the history.
create or replace function app.reassign_grievance(p_id uuid, p_officer uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.grievance_assignments set unassigned_at = now() where grievance_id = p_id and unassigned_at is null;
  if p_officer is not null then
    insert into public.grievance_assignments (grievance_id, officer_id, assigned_by, reason) values (p_id, p_officer, auth.uid(), p_reason);
  end if;
  update public.grievances set assigned_officer_id = p_officer where id = p_id;
end $$;

-- {"community_type":"HOST"} | {"cluster_id":3} | {"community_id":"…"}  ->  (type, cluster, community, label)
create or replace function app.resolve_scope(p_scope jsonb, out type_id smallint, out cluster_id smallint, out community_id uuid, out label text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  type_id := (select t.id from public.community_types t where t.code = p_scope ->> 'community_type');
  cluster_id := (select c.id from public.clusters c where c.id = (p_scope ->> 'cluster_id')::smallint);
  community_id := (select c.id from public.communities c where c.id = (p_scope ->> 'community_id')::uuid);
  if num_nonnulls(type_id, cluster_id, community_id) <> 1 then raise exception 'scope_invalid' using errcode = '22023'; end if;
  label := coalesce(
    (select 'all ' || t.name || ' communities' from public.community_types t where t.id = type_id),
    (select t.name || ' ' || c.name from public.clusters c join public.community_types t on t.id = c.community_type_id where c.id = cluster_id),
    (select c.name from public.communities c where c.id = community_id));
end $$;

-- Add a person to the people in charge. Open grievances there that nobody is
-- working on are shared out straight away.
create or replace function public.admin_add_responsibility(p_officer uuid, p_scope jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  sc record; g record; v uuid; v_picked int := 0;
begin
  perform app.require_perm('users.manage');
  if not exists (select 1 from public.profiles where id = p_officer and is_active) then raise exception 'officer_invalid' using errcode = '22023'; end if;
  select * into sc from app.resolve_scope(p_scope);

  if not app.has_role(p_officer, 'officer') then
    insert into public.user_roles (user_id, role_id, granted_by)
    select p_officer, id, auth.uid() from public.roles where code = 'officer' on conflict do nothing;
    perform app.log('user.roles_changed', 'profiles', p_officer::text, null, jsonb_build_object('added', 'officer'));
  end if;

  insert into public.officer_scopes (officer_id, community_type_id, cluster_id, community_id, auto_assign, created_by)
  select p_officer, sc.type_id, sc.cluster_id, sc.community_id, true, auth.uid()
  where not exists (select 1 from public.officer_scopes s where s.officer_id = p_officer
                    and s.community_type_id is not distinct from sc.type_id and s.cluster_id is not distinct from sc.cluster_id
                    and s.community_id is not distinct from sc.community_id);

  for g in
    select gr.id, gr.community_id, gr.community_type_id, gr.cluster_id from public.grievances gr
    join public.grievance_statuses st on st.id = gr.status_id
    where st.is_open and gr.archived_at is null and gr.assigned_officer_id is null
      and (gr.community_id = sc.community_id or gr.cluster_id = sc.cluster_id or gr.community_type_id = sc.type_id)
  loop
    v := app.pick_officer(g.community_id, g.community_type_id, g.cluster_id);
    if v is not null then perform app.reassign_grievance(g.id, v, 'responsibility added'); v_picked := v_picked + 1; end if;
  end loop;

  perform app.notify(p_officer, 'officer_assigned', 'New responsibility',
    format('You are now one of the people in charge of %s.', sc.label), null, p_scope);
  perform app.log('officer.responsibility_added', 'profiles', p_officer::text, null, p_scope || jsonb_build_object('picked_up', v_picked));
  return jsonb_build_object('label', sc.label, 'picked_up', v_picked);
end $$;

-- Remove a person. Their open grievances that they no longer cover go to the
-- least busy of the remaining people in charge.
create or replace function public.admin_remove_responsibility(p_officer uuid, p_scope jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  sc record; g record; v uuid; v_moved int := 0; v_orphaned int := 0; v_to jsonb := '{}'::jsonb; k text;
begin
  perform app.require_perm('users.manage');
  select * into sc from app.resolve_scope(p_scope);
  delete from public.officer_scopes s where s.officer_id = p_officer
    and s.community_type_id is not distinct from sc.type_id and s.cluster_id is not distinct from sc.cluster_id
    and s.community_id is not distinct from sc.community_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;

  for g in
    select gr.id, gr.community_id, gr.community_type_id, gr.cluster_id from public.grievances gr
    join public.grievance_statuses st on st.id = gr.status_id
    where st.is_open and gr.archived_at is null and gr.assigned_officer_id = p_officer
      and not app.in_officer_scope(p_officer, gr.community_id, gr.community_type_id, gr.cluster_id)
  loop
    v := app.pick_officer(g.community_id, g.community_type_id, g.cluster_id);
    perform app.reassign_grievance(g.id, v, 'responsibility removed');
    if v is null then v_orphaned := v_orphaned + 1;
    else v_moved := v_moved + 1; v_to := jsonb_set(v_to, array[v::text], to_jsonb(coalesce((v_to ->> v::text)::int, 0) + 1)); end if;
  end loop;

  for k in select jsonb_object_keys(v_to) loop
    perform app.notify(k::uuid, 'officer_assigned', 'Grievances assigned to you',
      format('%s open grievance(s) from %s were handed to you.', v_to ->> k, sc.label), null, p_scope);
  end loop;

  perform app.log('officer.responsibility_removed', 'profiles', p_officer::text, p_scope,
                  jsonb_build_object('handed_over', v_moved, 'unassigned', v_orphaned));
  return jsonb_build_object('label', sc.label, 'handed_over', v_moved, 'unassigned', v_orphaned);
end $$;

-- Who is in charge of each community type and cluster.
create or replace function public.list_responsibilities() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (app.has_perm('users.manage') or app.has_perm('masterdata.manage') or app.has_perm('grievance.assign')) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'code', t.code, 'name', t.name, 'has_clusters', t.has_clusters,
      'communities', (select count(distinct a.community_id) from public.community_affiliations a
                      join public.communities c on c.id = a.community_id and c.active
                      where a.community_type_id = t.id and a.active),
      'open_grievances', (select count(*) from public.grievances g join public.grievance_statuses st on st.id = g.status_id
                          where g.community_type_id = t.id and st.is_open and g.archived_at is null),
      'unassigned', (select count(*) from public.grievances g join public.grievance_statuses st on st.id = g.status_id
                     where g.community_type_id = t.id and st.is_open and g.archived_at is null and g.assigned_officer_id is null),
      'officers', app.scope_people(t.id, null),
      'clusters', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', cl.id, 'name', cl.name,
                     'communities', (select count(*) from public.community_affiliations a join public.communities c on c.id = a.community_id and c.active
                                     where a.cluster_id = cl.id and a.active),
                     'open_grievances', (select count(*) from public.grievances g join public.grievance_statuses st on st.id = g.status_id
                                         where g.cluster_id = cl.id and st.is_open and g.archived_at is null),
                     'officers', app.scope_people(null, cl.id)) order by cl.sort_order), '[]'::jsonb)
                   from public.clusters cl where cl.community_type_id = t.id)
    ) order by t.sort_order), '[]'::jsonb)
    from public.community_types t);
end $$;

create or replace function app.scope_people(p_type smallint, p_cluster smallint) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'name', p.full_name, 'job_title', p.job_title, 'active', p.is_active,
           'open_grievances', (select count(*) from public.grievances g join public.grievance_statuses st on st.id = g.status_id
                               where g.assigned_officer_id = p.id and st.is_open and g.archived_at is null))
         order by p.full_name), '[]'::jsonb)
  from public.officer_scopes s join public.profiles p on p.id = s.officer_id
  where s.community_type_id is not distinct from p_type and s.cluster_id is not distinct from p_cluster and s.community_id is null
$$;

-- Everyone covering each community (not just the first), most specific first.
create or replace function public.list_community_officers() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (app.has_perm('users.manage') or app.has_perm('masterdata.manage') or app.has_perm('grievance.assign')) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'community_id', c.id, 'community', c.name, 'active', c.active,
      'officer_id', o.list -> 0 ->> 'id', 'officer', o.list -> 0 ->> 'name', 'via', o.list -> 0 ->> 'via',
      'officers', coalesce(o.list, '[]'::jsonb),
      'open_grievances', (select count(*) from public.grievances g join public.grievance_statuses s on s.id = g.status_id
                          where g.community_id = c.id and s.is_open and g.archived_at is null))
      order by c.name), '[]'::jsonb)
    from public.communities c
    left join lateral (
      select jsonb_agg(jsonb_build_object('id', x.officer_id, 'name', x.full_name, 'via', x.via, 'group', x.grp)
                       order by x.rank, x.full_name) as list
      from (
        select distinct on (s.officer_id) s.officer_id, pr.full_name,
               case when s.community_id is not null then 1 when s.cluster_id is not null then 2 else 3 end as rank,
               case when s.community_id is not null then 'community' when s.cluster_id is not null then 'cluster' else 'community type' end as via,
               coalesce(cl.name, t.name) as grp
        from public.officer_scopes s
        join public.profiles pr on pr.id = s.officer_id and pr.is_active
        left join public.clusters cl on cl.id = s.cluster_id
        left join public.community_types t on t.id = s.community_type_id
        where s.community_id = c.id
           or exists (select 1 from public.community_affiliations a where a.community_id = c.id and a.active
                      and (a.cluster_id = s.cluster_id or a.community_type_id = s.community_type_id))
        order by s.officer_id, rank) x) o on true);
end $$;

-- "Put in charge of one community" now adds a person; it no longer removes the others.
create or replace function public.admin_set_community_officer(p_community uuid, p_officer uuid, p_reassign_open boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_moved int := 0;
  g record;
begin
  perform app.require_perm('users.manage');
  if not exists (select 1 from public.communities where id = p_community) then raise exception 'community_invalid' using errcode = '22023'; end if;
  perform public.admin_add_responsibility(p_officer, jsonb_build_object('community_id', p_community));

  if p_reassign_open then
    for g in
      select gr.id from public.grievances gr join public.grievance_statuses s on s.id = gr.status_id
      where gr.community_id = p_community and s.is_open and gr.archived_at is null
        and gr.assigned_officer_id is distinct from p_officer
    loop
      perform app.reassign_grievance(g.id, p_officer, 'community officer changed');
      v_moved := v_moved + 1;
    end loop;
    if v_moved > 0 then
      perform app.notify(p_officer, 'officer_assigned', 'Grievances assigned to you',
        format('%s open grievance(s) from %s were handed to you.', v_moved, app.community_name(p_community)),
        null, jsonb_build_object('community_id', p_community, 'count', v_moved));
    end if;
  end if;

  perform app.log('community.officer_set', 'communities', p_community::text, null,
                  jsonb_build_object('officer', p_officer, 'reassigned_open', v_moved));
  return jsonb_build_object('reassigned', v_moved);
end $$;

revoke execute on function public.admin_add_responsibility(uuid, jsonb), public.admin_remove_responsibility(uuid, jsonb),
  public.list_responsibilities() from public, anon;
grant execute on function public.admin_add_responsibility(uuid, jsonb), public.admin_remove_responsibility(uuid, jsonb),
  public.list_responsibilities() to authenticated;
revoke execute on function app.reassign_grievance(uuid, uuid, text), app.resolve_scope(jsonb), app.scope_people(smallint, smallint) from public, anon;
