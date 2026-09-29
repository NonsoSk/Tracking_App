-- =============================================================================
-- 1. Tracking IDs that show where a grievance comes from:
--      HC-2026-0001  Host community         PC-2026-0001  Pipeline community
--      IC-2026-0001  Indirectly impacted    JC-2026-0001  Jetty community
--      GC-2026-0001  no community recorded (e.g. old rows logged as "Individual" or "PAC")
--    Numbered per prefix and year. Every existing grievance is renumbered
--    (oldest first); its previous ID is kept in former_tracking_id and still
--    finds it (member "Find my grievance", staff search). The paper-form ID
--    (e.g. IPL20261391F) stays in legacy_tracking_id.
--    An ID never changes after it is issued, even if the grievance is later
--    moved to another community.
--
-- 2. Updating the history from a newer copy of the workbook
--    (app.import_or_update_legacy): each row is matched to the row imported
--    before; a change (status, resolution, name, sub-category, text) is applied
--    only if the grievance still holds the earlier value. If it was changed in
--    the app since, nothing is overwritten and the grievance is flagged for
--    review. On a project without the earlier import, it is a normal import.
-- =============================================================================

-- ---------------------------------------------------------------- 1. prefixes
alter table public.community_types add column if not exists id_prefix text;
update public.community_types set id_prefix = case code
  when 'HOST' then 'HC' when 'PIPELINE' then 'PC' when 'INDIRECT' then 'IC' when 'JETTY' then 'JC' end
where id_prefix is null;
do $$ begin
  alter table public.community_types add constraint community_types_id_prefix_check check (id_prefix ~ '^[A-Z]{2}$');
exception when duplicate_object then null; end $$;
create unique index if not exists community_types_id_prefix_key on public.community_types (id_prefix);

alter table public.grievances add column if not exists former_tracking_id text;
create index if not exists grievances_former_tid_idx on public.grievances (former_tracking_id);

alter table public.tracking_counters drop constraint if exists tracking_counters_series_check;

-- Issue the next ID for a community type and year (GC when the type is unknown).
create or replace function app.issue_tracking_id(p_type smallint, p_year int) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v int; v_prefix text := coalesce((select id_prefix from public.community_types where id = p_type), 'GC');
begin
  insert into public.tracking_counters as c (year, series, last_value) values (p_year, v_prefix, 1)
  on conflict (year, series) do update set last_value = c.last_value + 1
  returning last_value into v;
  return format('%s-%s-%s', v_prefix, p_year, lpad(v::text, 4, '0'));
end $$;

-- Callers ask for an ID before the row exists; the community type is only known
-- once the classification trigger has run, so hand out a placeholder that the
-- trigger below replaces.
create or replace function app.next_tracking_id(p_year int, p_legacy boolean default false) returns text
language sql volatile as $$ select '~' || p_year || '~' || gen_random_uuid() $$;

create or replace function app.grievance_assign_tracking_id() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.tracking_id is null or new.tracking_id like '~%' then
    new.tracking_id := app.issue_tracking_id(new.community_type_id,
      coalesce(nullif(split_part(coalesce(new.tracking_id, ''), '~', 2), '')::int,
               extract(year from coalesce(new.date_received, (now() at time zone app.tz())::date))::int));
  end if;
  return new;
end $$;
-- Named to run after grievances_before_write (which sets community_type_id).
drop trigger if exists grievances_before_write_tracking_id on public.grievances;
create trigger grievances_before_write_tracking_id before insert on public.grievances
  for each row execute function app.grievance_assign_tracking_id();

-- Renumber existing grievances (once; safe to run again).
do $$
declare g record; v_new text;
begin
  alter table public.grievances disable trigger grievances_before_write;   -- allows the one-time ID change
  for g in
    select id, tracking_id, community_type_id,
           coalesce(substring(tracking_id from '^IPL-GRV-(\d{4})-')::int, extract(year from date_received)::int) as yr
    from public.grievances
    where tracking_id !~ '^[A-Z]{2}-\d{4}-\d{4,}$'
    order by 4, date_received, created_at, tracking_id
  loop
    v_new := app.issue_tracking_id(g.community_type_id, g.yr);
    update public.grievances set former_tracking_id = g.tracking_id, tracking_id = v_new where id = g.id;
  end loop;
  alter table public.grievances enable trigger grievances_before_write;
end $$;

-- Old IDs still find the grievance.
create or replace function public.find_my_grievance(p_tracking_id text) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from public.grievances
  where complainant_user_id = auth.uid() and archived_at is null
    and (tracking_id = upper(btrim(p_tracking_id))
         or former_tracking_id = upper(btrim(p_tracking_id))
         or legacy_tracking_id_norm = upper(regexp_replace(p_tracking_id, '\s', '', 'g')))
  limit 1
$$;

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
          or exists (select 1 from public.grievances x where x.id = g.id and x.former_tracking_id ilike '%' || btrim(f ->> 'q') || '%')
          or g.complainant_name ilike '%' || btrim(f ->> 'q') || '%'
          or (length(regexp_replace(f ->> 'q', '\D', '', 'g')) >= 6
              and g.complainant_phone like '%' || right(regexp_replace(f ->> 'q', '\D', '', 'g'), 10) || '%')
          or g.community_name ilike '%' || btrim(f ->> 'q') || '%'
          or g.category_name ilike '%' || btrim(f ->> 'q') || '%'
          or g.description ilike '%' || btrim(f ->> 'q') || '%')
$$;

-- ---------------------------------------------------------------- 2. history update
create or replace function app.status_code(p_id smallint) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select code from public.grievance_statuses where id = p_id
$$;

-- Legacy status text -> status code, exactly as the import maps it.
create or replace function app.legacy_status_code(p_status text, p_closure_officer text) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v text;
begin
  select s.code into v from public.legacy_value_mappings m join public.grievance_statuses s on s.id = m.target_id::smallint
  where m.field = 'status' and m.legacy_value_norm = app.norm_key(p_status);
  if v = 'ASSIGNED' and nullif(p_closure_officer, '') is null then v := 'SUBMITTED'; end if;
  return coalesce(v, 'SUBMITTED');
end $$;

create or replace function app.legacy_subcategory_id(p_name text) returns smallint
language sql stable security definer set search_path = public, pg_temp as $$
  select id from public.grievance_subcategories where app.norm_key(name) = app.norm_key(p_name) limit 1
$$;

create or replace function app.import_or_update_legacy(p_batch jsonb, p_records jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_batch uuid; r jsonb; c jsonb; v_gid uuid; v_role text; g public.grievances;
  v_label text := coalesce(p_records -> 0 ->> 'workbook', p_batch ->> 'workbook');
  v_old text; v_new text; v_ok boolean; v_res public.grievance_resolutions; v_sub smallint;
  n_rows int := 0; n_applied int := 0; n_flagged int := 0; n_missing int := 0;
  v_applied jsonb := '[]'::jsonb; v_flag_list jsonb := '[]'::jsonb;
begin
  if exists (select 1 from public.import_batches where file_sha256 = p_batch ->> 'file_sha256' and status = 'imported') then
    raise exception 'file_already_imported' using errcode = '23505';
  end if;
  -- A project that never had the earlier import: import normally.
  if not exists (select 1 from public.legacy_source_records s join public.import_batches b on b.id = s.batch_id
                 where b.status = 'imported') then
    return app.import_legacy_batch(p_batch, p_records);
  end if;

  insert into public.import_batches (file_name, file_sha256, workbook, status, created_by)
  values (p_batch ->> 'file_name', p_batch ->> 'file_sha256', p_batch ->> 'workbook', 'draft', auth.uid())
  returning id into v_batch;

  for r in select * from jsonb_array_elements(p_records) loop
    -- The same row as imported before.
    select s.grievance_id, s.match_role into v_gid, v_role
    from public.legacy_source_records s join public.import_batches b on b.id = s.batch_id and b.status = 'imported'
    where s.batch_id <> v_batch and s.workbook = r -> 'prev' ->> 'workbook' and s.sheet = r -> 'prev' ->> 'sheet'
      and s.row_number = (r -> 'prev' ->> 'row')::int
    order by b.imported_at desc limit 1;
    if not found then
      raise exception 'Row % of sheet % was not in the earlier import. Nothing was changed.', r ->> 'row', r ->> 'sheet';
    end if;
    if v_role <> r ->> 'role' then
      raise exception 'Row % of sheet % was classified differently before (% vs %). Nothing was changed.',
        r ->> 'row', r ->> 'sheet', v_role, r ->> 'role';
    end if;

    insert into public.legacy_source_records (batch_id, workbook, sheet, row_number, source_serial, raw, grievance_id, match_role, note)
    values (v_batch, r ->> 'workbook', r ->> 'sheet', (r ->> 'row')::int, r ->> 'serial', r -> 'raw', v_gid, r ->> 'role', r ->> 'note');
    n_rows := n_rows + 1;

    if r ->> 'role' <> 'primary' then continue; end if;
    if v_gid is null then
      if jsonb_array_length(coalesce(nullif(r -> 'changes', 'null'::jsonb), '[]')) > 0 then n_missing := n_missing + 1; end if;
      continue;   -- the grievance was deleted in the app; nothing to update
    end if;

    for c in select * from jsonb_array_elements(coalesce(nullif(r -> 'changes', 'null'::jsonb), '[]')) loop
      select * into g from public.grievances where id = v_gid for update;
      v_ok := false;

      if c ->> 'field' = 'status' then
        v_old := app.legacy_status_code(c ->> 'old', c ->> 'old_closure_officer');
        v_new := app.legacy_status_code(c ->> 'new', c ->> 'closure_officer');
        if app.status_code(g.status_id) = v_old then
          v_ok := true;
          if v_new <> v_old then
            update public.grievances set
              status_id = app.status_id(v_new), legacy_status = c ->> 'new',
              resolved_at = case when v_new in ('RESOLVED','CLOSED') then resolved_at end,
              closed_at = case when v_new = 'CLOSED' then closed_at end,
              ack_state = case when v_new in ('RESOLVED','CLOSED') then 'not_captured' else ack_state end
            where id = v_gid;
            insert into public.grievance_status_history (grievance_id, from_status_id, to_status_id, changed_at, note)
            values (v_gid, g.status_id, app.status_id(v_new), now(), 'Updated from ' || v_label);
          end if;
        end if;

      elsif c ->> 'field' = 'resolution_details' then
        select * into v_res from public.grievance_resolutions where grievance_id = v_gid
        order by is_current desc, id desc limit 1;
        if c ->> 'old' is null and v_res.id is null and c ->> 'new' is not null then
          v_ok := true;
          insert into public.grievance_resolutions (grievance_id, details, resolved_at, is_current)
          values (v_gid, c ->> 'new', null,
                  app.status_code((select status_id from public.grievances where id = v_gid)) in ('RESOLVED','CLOSED'));
        elsif v_res.id is not null and v_res.details = c ->> 'old' and c ->> 'new' is not null then
          v_ok := true;
          update public.grievance_resolutions set details = c ->> 'new' where id = v_res.id;
        end if;

      elsif c ->> 'field' = 'subcategory' then
        v_sub := app.legacy_subcategory_id(c ->> 'new');
        if g.subcategory_id is not distinct from app.legacy_subcategory_id(c ->> 'old') and v_sub is not null then
          v_ok := true;
          update public.grievances set subcategory_id = v_sub, legacy_subcategory = c ->> 'new',
                 category_id = (select category_id from public.grievance_subcategories where id = v_sub)
          where id = v_gid;
        end if;

      elsif c ->> 'field' = 'name' then
        if g.complainant_name is not distinct from nullif(btrim(c ->> 'old'), '') and nullif(btrim(c ->> 'new'), '') is not null then
          v_ok := true;
          update public.grievances set complainant_name = btrim(c ->> 'new') where id = v_gid;
        end if;

      elsif c ->> 'field' = 'description' then
        if g.description = c ->> 'old' and nullif(btrim(c ->> 'new'), '') is not null then
          v_ok := true;
          perform set_config('app.allow_text_amend', 'on', true);
          update public.grievances set description = c ->> 'new', text_amended = true,
                 title = case when title = left(regexp_replace(c ->> 'old', '\s+', ' ', 'g'), 80)
                              then left(regexp_replace(c ->> 'new', '\s+', ' ', 'g'), 80) else title end
          where id = v_gid;
          perform set_config('app.allow_text_amend', '', true);
        end if;
      end if;

      if v_ok then
        n_applied := n_applied + 1;
        v_applied := v_applied || jsonb_build_object('tracking_id', g.tracking_id, 'field', c ->> 'field');
      else
        -- Changed in the app since the import: keep the app's value and ask an officer.
        insert into public.grievance_flags (grievance_id, flag, detail)
        values (v_gid, 'needs_review', jsonb_build_object(
          'reason', 'The updated workbook has a different ' || replace(c ->> 'field', '_', ' ')
                    || ', but this grievance was changed in the app since it was imported, so it was not overwritten.',
          'field', c ->> 'field', 'workbook_value', c -> 'new', 'workbook', v_label));
        n_flagged := n_flagged + 1;
        v_flag_list := v_flag_list || jsonb_build_object('tracking_id', g.tracking_id, 'field', c ->> 'field');
      end if;
    end loop;

    -- Copies of this row were edited in the workbook but the row itself was not.
    if jsonb_array_length(coalesce(nullif(r -> 'review', 'null'::jsonb), '[]')) > 0 then
      insert into public.grievance_flags (grievance_id, flag, detail)
      values (v_gid, 'needs_review', jsonb_build_object(
        'reason', 'Duplicate copies of this grievance were edited in the updated workbook, but this row was not. Check which wording is right.',
        'copies', r -> 'review', 'workbook', v_label));
      n_flagged := n_flagged + 1;
      v_flag_list := v_flag_list || jsonb_build_object('tracking_id', (select tracking_id from public.grievances where id = v_gid),
                                                       'field', 'copies edited');
    end if;
  end loop;

  update public.import_batches set status = 'imported', imported_at = now(),
         counts = jsonb_build_object('total', n_rows, 'changes_applied', n_applied, 'flagged_for_review', n_flagged,
                                     'deleted_in_app', n_missing, 'grievances_now', (select count(*) from public.grievances where is_legacy)),
         report = coalesce(p_batch -> 'report', '{}'::jsonb) || jsonb_build_object('applied', v_applied, 'flagged', v_flag_list)
  where id = v_batch;
  perform app.log('import.batch_updated', 'import_batches', v_batch::text, null,
                  (select counts from public.import_batches where id = v_batch));
  return (select counts || jsonb_build_object('batch_id', v_batch, 'applied', v_applied, 'flagged', v_flag_list)
          from public.import_batches where id = v_batch);
end $$;

revoke execute on function app.import_or_update_legacy(jsonb, jsonb), app.issue_tracking_id(smallint, int),
  app.legacy_status_code(text, text), app.legacy_subcategory_id(text) from public, anon, authenticated;
