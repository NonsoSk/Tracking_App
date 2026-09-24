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
