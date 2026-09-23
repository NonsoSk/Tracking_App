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
