-- UPDATE (3 Oct 2026): monthly submission limit per member (Settings) and the officer home "Resolved" card (latest first).
-- Run after 12-update-2026-10-02.sql. Safe to run more than once.

-- =============================================================================
-- 1. Monthly submission limit (Settings -> "monthly_submission_limit").
--    Empty = unlimited. A number N = each member may send N grievances per
--    calendar month (Lagos time). Unused submissions do not carry over; the
--    count starts again on the 1st. Retries of a grievance already received
--    never count twice. Staff entering paper forms are not limited.
-- 2. Staff list: sort "resolved_desc" (most recently resolved first), used by
--    the officer home "Resolved" card.
-- =============================================================================

insert into public.settings (key, value, description, is_public) values
  ('monthly_submission_limit', 'null', 'How many grievances a member may send each calendar month (empty = unlimited)', true)
on conflict (key) do nothing;

create or replace function app.monthly_limit() returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select case when jsonb_typeof(app.setting('monthly_submission_limit')) = 'number'
              and (app.setting('monthly_submission_limit'))::int > 0
              then (app.setting('monthly_submission_limit'))::int end
$$;

-- Grievances this member may still send this month (null = unlimited).
create or replace function app.monthly_left(p_user uuid) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select case when app.monthly_limit() is null then null else greatest(0, app.monthly_limit() - (
    select count(*)::int from public.grievances
    where complainant_user_id = p_user and origin = 'app'
      and submitted_at >= (date_trunc('month', now() at time zone app.tz()) at time zone app.tz()))) end
$$;

create index if not exists grievances_member_month_idx on public.grievances (complainant_user_id, submitted_at);

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

  -- Monthly limit set by the Super Admin (Settings): counts this calendar month only, nothing carries over.
  if app.monthly_left(auth.uid()) = 0 then
    raise exception 'monthly_limit' using errcode = '22023';
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
    'monthly_limit', app.monthly_limit(),
    'monthly_left', app.monthly_left(auth.uid()),
    -- Shown only when the Super Admin chose to share this code with everyone.
    'code', case when c.show_to_members then c.code end,
    'uses_left', case when c.max_per_person is not null then greatest(0, c.max_per_person - app.code_used_by(c.id, auth.uid())) end,
    'community_id', v_comm,
    'community_name', (select name from public.communities where id = v_comm),
    'valid_from', c.valid_from,
    'valid_until', c.valid_until,
    'server_time', now());
end $$;

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
      case when p_sort = 'resolved_desc' then coalesce(f.resolved_at, f.closed_at, f.updated_at) end desc nulls last,
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

-- An emptied number setting (e.g. "unlimited") is stored as JSON null.
create or replace function public.update_setting(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.require_perm('settings.manage');
  update public.settings set value = coalesce(p_value, 'null'::jsonb), updated_by = auth.uid() where key = p_key;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;
