-- =============================================================================
-- Scoped access for staff and community leaders.
--
-- * Officers, Supervisors, Community Relations staff and Viewers can SEE the
--   submission codes for the communities assigned to them (codes.view); only the
--   Super Admin creates them (codes.manage).
-- * Any staff member (including Viewers, e.g. community leaders) can be given
--   communities. Officers, CR staff and Viewers see only the grievances, reports
--   and codes of those communities. Supervisors keep the organisation-wide view.
-- * Only the Super Admin and Officers in charge resolve grievances.
-- * Viewers see grievances without the complainant's name, phone, email or
--   address (grievance.read.contact), so leaders can follow progress without
--   exposing who complained.
-- * Grievances by gender for dashboards and reports.
-- =============================================================================

insert into public.permissions (code, description) values
  ('codes.view', 'See the submission codes for my communities'),
  ('grievance.read.contact', 'See the complainant''s name and contact details')
on conflict (code) do nothing;

-- Role changes
delete from public.role_permissions rp using public.roles r
 where rp.role_id = r.id and (
       (r.code = 'supervisor' and rp.permission_code = 'grievance.resolve')     -- only Super Admin + Officers resolve
    or (r.code = 'cr_staff'   and rp.permission_code = 'grievance.read.all'));  -- CR staff: their communities only
insert into public.role_permissions (role_id, permission_code)
select r.id, p from public.roles r, (values
  ('officer', 'codes.view'), ('officer', 'grievance.read.contact'),
  ('supervisor', 'codes.view'), ('supervisor', 'grievance.read.contact'),
  ('cr_staff', 'codes.view'), ('cr_staff', 'grievance.read.scope'), ('cr_staff', 'grievance.read.contact'),
  ('data_entry', 'grievance.read.contact'),
  ('viewer', 'codes.view'), ('viewer', 'grievance.read.scope')
) v(role_code, p)
where r.code = v.role_code
on conflict do nothing;
update public.roles set description = 'Sees the grievances, reports and submission codes of the communities assigned to them (no complainant contact details); cannot change anything.'
 where code = 'viewer';

-- Codes a person may see: all (Super Admin), or those covering a community in their scope.
create or replace function app.code_in_my_scope(c public.submission_codes) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.communities cm
    join public.community_affiliations a on a.community_id = cm.id and a.active
    where app.code_covers(c, cm.id)
      and app.in_officer_scope(auth.uid(), cm.id, a.community_type_id, a.cluster_id))
$$;
drop policy if exists submission_codes_read on public.submission_codes;
create policy submission_codes_read on public.submission_codes for select to authenticated
  using ((select app.has_perm('codes.manage'))
         or ((select app.has_perm('codes.view')) and status <> 'draft' and app.code_in_my_scope(submission_codes)));

-- Dashboards count only what the person may see.
create or replace function app.dashboard_scope_ok(g public.grievances) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.has_perm('grievance.read.all') or app.can_work(g)
$$;

-- The overview hides complainant identity from people without grievance.read.contact.
create or replace view public.grievance_overview with (security_invoker = true) as
select
  g.id, g.tracking_id, g.legacy_tracking_id, g.origin, g.is_legacy, g.legacy_needs_review, g.title, g.description,
  g.date_received, g.date_received_precision, g.submitted_at, g.year, g.updated_at, g.resolved_at, g.closed_at,
  case when app.has_perm('grievance.read.contact') or g.complainant_user_id = auth.uid() then g.complainant_name end as complainant_name,
  case when app.has_perm('grievance.read.contact') or g.complainant_user_id = auth.uid() then g.complainant_phone end as complainant_phone,
  g.complainant_gender, g.complainant_user_id,
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

-- Grievances by gender (same filters and scope as the dashboard).
create or replace function public.dashboard_gender(p_filters jsonb default '{}') returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select case when not app.has_perm('dashboard.view') then null else
    (select coalesce(jsonb_agg(jsonb_build_object('key', k, 'total', total, 'open', open) order by ord), '[]'::jsonb)
     from (select case o.complainant_gender when 'female' then 'Female' when 'male' then 'Male' else 'Not stated' end as k,
                  case o.complainant_gender when 'female' then 1 when 'male' then 2 else 3 end as ord,
                  count(*) as total, count(*) filter (where o.is_open) as open
           from public.grievance_overview o join public.grievances g on g.id = o.id
           where o.archived_at is null and app.dashboard_scope_ok(g) and app.matches_filters(o, coalesce(p_filters, '{}'))
           group by 1, 2) x)
  end
$$;
revoke execute on function public.dashboard_gender(jsonb) from public, anon;
grant execute on function public.dashboard_gender(jsonb) to authenticated;

-- Any staff member can be given communities (officers are also put in charge;
-- others, such as Viewers, simply see those communities).
create or replace function public.admin_set_officer_scopes(p_officer uuid, p_scopes jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare s jsonb; v_old jsonb;
begin
  perform app.require_perm('users.manage');
  if not exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                 where ur.user_id = p_officer and r.is_staff and r.code <> 'super_admin') then
    raise exception 'not_staff' using errcode = '22023';
  end if;
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

-- "People in charge" lists officers only (Viewers with communities are not in charge).
create or replace function app.scope_people(p_type smallint, p_cluster smallint) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'name', p.full_name, 'job_title', p.job_title, 'active', p.is_active,
           'open_grievances', (select count(*) from public.grievances g join public.grievance_statuses st on st.id = g.status_id
                               where g.assigned_officer_id = p.id and st.is_open and g.archived_at is null))
         order by p.full_name), '[]'::jsonb)
  from public.officer_scopes s join public.profiles p on p.id = s.officer_id
  where s.community_type_id is not distinct from p_type and s.cluster_id is not distinct from p_cluster and s.community_id is null
    and app.has_role(p.id, 'officer')
$$;

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
        where app.has_role(s.officer_id, 'officer')
          and (s.community_id = c.id
               or exists (select 1 from public.community_affiliations a where a.community_id = c.id and a.active
                          and (a.cluster_id = s.cluster_id or a.community_type_id = s.community_type_id)))
        order by s.officer_id, rank) x) o on true);
end $$;


-- ---- Communities chosen when inviting (e.g. a community leader as Viewer) ----------------
alter table public.staff_invitations add column if not exists scopes jsonb not null default '[]'::jsonb;

-- Replace someone's communities (no permission check: callers check).
create or replace function app.set_scopes(p_user uuid, p_scopes jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare s jsonb;
begin
  delete from public.officer_scopes where officer_id = p_user;
  for s in select * from jsonb_array_elements(coalesce(p_scopes, '[]'::jsonb)) loop
    insert into public.officer_scopes (officer_id, community_type_id, cluster_id, community_id, auto_assign, created_by)
    values (p_user,
            (select id from public.community_types where code = s ->> 'community_type'),
            (s ->> 'cluster_id')::smallint,
            (s ->> 'community_id')::uuid,
            coalesce((s ->> 'auto_assign')::boolean, true),
            auth.uid());
  end loop;
end $$;
revoke execute on function app.set_scopes(uuid, jsonb) from public, anon, authenticated;

create or replace function app.apply_invitation_roles(inv public.staff_invitations) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.user_roles where user_id = inv.account_id;
  insert into public.user_roles (user_id, role_id, granted_by)
  select inv.account_id, r.id, inv.invited_by from public.roles r where r.code = any(inv.roles);
  update public.profiles set full_name = inv.full_name, job_title = inv.job_title, email = inv.email,
         must_set_password = true, is_active = true
  where id = inv.account_id;
  perform app.set_scopes(inv.account_id, inv.scopes);
end $$;

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
    insert into public.staff_invitations (email, full_name, job_title, roles, invited_by, scopes)
    values (v_email, v_name, nullif(btrim(coalesce(p ->> 'job_title', '')), ''), v_roles, auth.uid(), coalesce(p -> 'scopes', '[]'::jsonb))
    returning * into inv;
    perform app.log('user.invited', 'staff_invitations', inv.id::text, null, jsonb_build_object('email', v_email, 'roles', v_roles));
  else
    update public.staff_invitations set full_name = v_name, job_title = nullif(btrim(coalesce(p ->> 'job_title', '')), ''),
           roles = v_roles, last_sent_at = now(), scopes = coalesce(p -> 'scopes', scopes)
    where id = inv.id returning * into inv;
    if inv.account_id is not null then   -- login already made by the first email: keep it in step
      perform app.apply_invitation_roles(inv);
    end if;
  end if;
  return jsonb_build_object('id', inv.id, 'email', inv.email);
end $$;
