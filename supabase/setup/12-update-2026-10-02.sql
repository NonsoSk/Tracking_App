-- UPDATE (2 Oct 2026): members can reply to staff messages; Settings switch to let members send without a code;
-- per code: show it to all members, and a limit per person. Run after 11-update-2026-10-01.sql. Safe to run more than once.

-- =============================================================================
-- Conversations and submission-code settings.
--
-- 1. Members can reply to a message from staff on their grievance
--    (reply_to_grievance). The officer in charge is notified. Staff who may not
--    see complainant identities see the sender as "Complainant".
-- 2. Settings -> "submission_code_required": the Super Admin can let members
--    send grievances without a code (a code typed anyway is still checked).
-- 3. Per code:
--    * show_to_members: the code is shown to members in the app (and in the
--      "collection is open" notice), so everyone can use it, not only those
--      who got it from a community leader;
--    * max_per_person: how many grievances one member may send with the code.
--    Both can be changed later (update_submission_code).
-- =============================================================================

insert into public.settings (key, value, description, is_public) values
  ('submission_code_required', 'true', 'Members need a submission code to send a grievance', true)
on conflict (key) do nothing;

alter table public.submission_codes add column if not exists show_to_members boolean not null default false;
alter table public.submission_codes add column if not exists max_per_person int;
do $$ begin
  alter table public.submission_codes add constraint submission_codes_max_per_person_check check (max_per_person is null or max_per_person > 0);
exception when duplicate_object then null; end $$;
create index if not exists grievances_code_person_idx on public.grievances (submission_code_id, complainant_user_id);

create or replace function app.code_required() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((app.setting('submission_code_required'))::boolean, true)
$$;

create or replace function app.code_used_by(p_code uuid, p_user uuid) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::int from public.grievances where submission_code_id = p_code and complainant_user_id = p_user
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
                                       valid_from, valid_until, max_submissions, created_by, show_to_members, max_per_person)
  values (v_code, nullif(btrim(p ->> 'label'), ''), v_scope, v_type, v_cluster, v_comm,
          v_from, v_until, (p ->> 'max_submissions')::int, auth.uid(),
          coalesce((p ->> 'show_to_members')::boolean, false), (p ->> 'max_per_person')::int)
  returning * into v;
  perform app.log('submission_code.generated', 'submission_codes', v.id::text, null, to_jsonb(v));

  if coalesce((p ->> 'release')::boolean, false) then
    v := public.release_submission_code(v.id);
  end if;
  return v;
end $$;

create or replace function public.release_submission_code(p_id uuid) returns public.submission_codes
language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.submission_codes;
begin
  perform app.require_perm('codes.manage');
  select * into v from public.submission_codes where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v.status <> 'draft' then raise exception 'code_not_draft' using errcode = '22023'; end if;

  update public.submission_codes set status = 'active', released_by = auth.uid(), released_at = now()
  where id = p_id returning * into v;
  perform app.log('submission_code.released', 'submission_codes', v.id::text);

  -- In-app only, and without the code: members get it from their community leader.
  perform app.notify(p.id, 'submission_window_opened',
                     'Grievance collection is open',
                     case when v.show_to_members
                       then format('Grievances are being collected for %s until %s. The submission code is %s.', c.name,
                                   to_char(v.valid_until at time zone app.tz(), 'FMDD Mon YYYY'), v.code)
                       else format('Grievances are being collected for %s until %s. Ask your community leader for the submission code.', c.name,
                                   to_char(v.valid_until at time zone app.tz(), 'FMDD Mon YYYY')) end,
                     null, jsonb_build_object('code_id', v.id))
  from public.profiles p
  join public.communities c on c.id = p.community_id
  where p.is_active and app.code_covers(v, p.community_id) and app.has_role(p.id, 'community_member');
  return v;
end $$;

create or replace function public.check_submission_code(p_code text, p_community uuid default null) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  c public.submission_codes;
  v_comm uuid := coalesce(p_community, (select community_id from public.profiles where id = auth.uid()));
  v_err text;
begin
  if auth.uid() is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  delete from app.code_attempts where at < now() - interval '1 day';
  if (select count(*) from app.code_attempts where user_id = auth.uid() and at > now() - interval '15 minutes') >= 8 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  select * into c from public.submission_codes where code = upper(btrim(coalesce(p_code, '')));
  v_err := case
    when not found or c.status = 'draft' then 'code_invalid'
    when c.status = 'deactivated' then 'code_deactivated'
    when now() < c.valid_from then 'code_not_yet_valid'
    when now() >= c.valid_until then 'code_expired'
    when c.max_submissions is not null and c.submission_count >= c.max_submissions then 'code_full'
    when v_comm is not null and not app.code_covers(c, v_comm) then 'code_wrong_community'
    when c.max_per_person is not null and app.code_used_by(c.id, auth.uid()) >= c.max_per_person then 'code_person_limit'
  end;
  if v_err is not null then
    insert into app.code_attempts (user_id) values (auth.uid());
    return jsonb_build_object('ok', false, 'error', v_err);
  end if;
  return jsonb_build_object('ok', true, 'valid_until', c.valid_until,
    'uses_left', case when c.max_per_person is not null then c.max_per_person - app.code_used_by(c.id, auth.uid()) end,
    'scope', coalesce((select name from public.communities where id = c.community_id),
                      (select t.name || ' ' || cl.name from public.clusters cl join public.community_types t on t.id = cl.community_type_id where cl.id = c.cluster_id),
                      (select 'all ' || name || ' communities' from public.community_types where id = c.community_type_id),
                      'all communities'));
end $$;

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
    'open', c.id is not null or not app.code_required(),
    'code_required', app.code_required(),
    -- Shown only when the Super Admin chose to share this code with everyone.
    'code', case when c.show_to_members then c.code end,
    'uses_left', case when c.max_per_person is not null then greatest(0, c.max_per_person - app.code_used_by(c.id, auth.uid())) end,
    'community_id', v_comm,
    'community_name', (select name from public.communities where id = v_comm),
    'valid_from', c.valid_from,
    'valid_until', c.valid_until,
    'server_time', now());
end $$;

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

  -- Codes switched off by the Super Admin, and none typed: accept without a code.
  if not app.code_required() and nullif(btrim(coalesce(p ->> 'submission_code', '')), '') is null then
    if not exists (select 1 from public.communities where active and id = v_comm) then
      raise exception 'community_invalid' using errcode = '22023';
    end if;
    g := app.create_grievance(p, 'app', auth.uid(), null);
    perform app.notify(auth.uid(), 'grievance_submitted', 'Grievance received',
                       format('Your grievance %s has been received. Keep this tracking ID for reference.', g.tracking_id),
                       g.id, jsonb_build_object('tracking_id', g.tracking_id));
    return jsonb_build_object('id', g.id, 'tracking_id', g.tracking_id, 'submitted_at', g.submitted_at, 'result', 'created');
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
  if c.max_per_person is not null and app.code_used_by(c.id, auth.uid()) >= c.max_per_person then
    raise exception 'code_person_limit' using errcode = '22023';
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
        select jsonb_agg(jsonb_build_object('body', cm.body, 'at', cm.created_at,
                                            'from', case when cm.kind = 'reply' then 'me' else 'staff' end) order by cm.created_at, cm.id)
        from public.grievance_comments cm where cm.grievance_id = g.id and cm.visibility = 'complainant'), '[]'::jsonb),
    'can_reply', s.code <> 'CLOSED',
    'resolution', (select jsonb_build_object('details', coalesce(r.public_summary, r.details), 'resolved_at', r.resolved_at)
                   from public.grievance_resolutions r where r.grievance_id = g.id and r.is_current),
    'acknowledgement', (select jsonb_build_object('response', a.response, 'reason', a.reason, 'at', a.created_at)
                        from public.grievance_acknowledgements a where a.grievance_id = g.id
                        order by a.created_at desc limit 1))
  into v
  from public.grievance_statuses s where s.id = g.status_id;
  return v;
end $$;

create or replace function public.staff_grievance_detail(p_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare o public.grievance_overview; g public.grievances; v jsonb;
begin
  select * into o from public.grievance_overview where id = p_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into g from public.grievances where id = p_id;

  v := to_jsonb(o) || jsonb_build_object(
    'incident_details', g.incident_details, 'desired_resolution', g.desired_resolution, 'suggestions', g.suggestions,
    'complainant_email', case when app.has_perm('grievance.read.contact') then g.complainant_email end,
    'complainant_address', case when app.has_perm('grievance.read.contact') then g.complainant_address end,
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
        select 'comment', c.created_at,
               case when c.kind = 'reply' then
                 case when app.has_perm('grievance.read.contact') then coalesce(app.profile_name(c.author_id), 'Complainant') || ' (complainant)'
                      else 'Complainant' end
               else app.profile_name(c.author_id) end,
               null, c.kind, null, c.body, c.visibility = 'complainant'
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

create or replace function public.list_submission_codes(p_include_inactive boolean default true) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'code', c.code, 'label', c.label, 'scope_type', c.scope_type,
    'scope_name', coalesce(cm.name, cl.name, ct.name, 'All communities'),
    'valid_from', c.valid_from, 'valid_until', c.valid_until, 'max_submissions', c.max_submissions,
    'submission_count', c.submission_count, 'show_to_members', c.show_to_members, 'max_per_person', c.max_per_person,
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

-- Change a code's options after it was created.
create or replace function public.update_submission_code(p_id uuid, p jsonb) returns public.submission_codes
language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.submission_codes;
begin
  perform app.require_perm('codes.manage');
  select * into v from public.submission_codes where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p ? 'max_submissions' and (p ->> 'max_submissions')::int is not null and (p ->> 'max_submissions')::int < v.submission_count then
    raise exception 'max_below_used' using errcode = '22023';
  end if;
  update public.submission_codes set
    show_to_members = case when p ? 'show_to_members' then coalesce((p ->> 'show_to_members')::boolean, false) else show_to_members end,
    max_per_person  = case when p ? 'max_per_person' then (p ->> 'max_per_person')::int else max_per_person end,
    max_submissions = case when p ? 'max_submissions' then (p ->> 'max_submissions')::int else max_submissions end,
    label           = case when p ? 'label' then nullif(btrim(p ->> 'label'), '') else label end
  where id = p_id returning * into v;
  perform app.log('submission_code.updated', 'submission_codes', v.id::text, null, p);
  return v;
end $$;
revoke execute on function public.update_submission_code(uuid, jsonb) from public, anon;
grant execute on function public.update_submission_code(uuid, jsonb) to authenticated;

-- A member replies to staff on their own grievance.
create or replace function public.reply_to_grievance(p_id uuid, p_body text) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.grievances; v_id bigint; v_body text := app.clean_text(p_body, 2000);
begin
  if auth.uid() is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  select * into g from public.grievances where id = p_id and complainant_user_id = auth.uid() and archived_at is null;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if app.status_code(g.status_id) = 'CLOSED' then raise exception 'grievance_closed' using errcode = '22023'; end if;
  if v_body is null or length(v_body) < 2 then raise exception 'reply_too_short' using errcode = '22023'; end if;
  if (select count(*) from public.grievance_comments where grievance_id = p_id and author_id = auth.uid()
        and kind = 'reply' and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'rate_limited' using errcode = '22023';
  end if;

  insert into public.grievance_comments (grievance_id, author_id, kind, visibility, body)
  values (p_id, auth.uid(), 'reply', 'complainant', v_body) returning id into v_id;
  update public.grievances set updated_at = now() where id = p_id;
  perform app.log('grievance.reply_added', 'grievances', p_id::text, null, jsonb_build_object('comment_id', v_id));
  if g.assigned_officer_id is not null then
    perform app.notify(g.assigned_officer_id, 'grievance_comment', 'Reply from the complainant',
                       format('%s: %s', g.tracking_id, left(v_body, 200)), g.id, jsonb_build_object('tracking_id', g.tracking_id));
  end if;
  return v_id;
end $$;
revoke execute on function public.reply_to_grievance(uuid, text) from public, anon;
grant execute on function public.reply_to_grievance(uuid, text) to authenticated;
