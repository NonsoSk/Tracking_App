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
