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
