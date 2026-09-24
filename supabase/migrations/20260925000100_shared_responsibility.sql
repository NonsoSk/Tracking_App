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
