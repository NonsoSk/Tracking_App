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
