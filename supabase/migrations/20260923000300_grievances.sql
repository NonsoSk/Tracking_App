-- =============================================================================
-- Grievances (central entity), workflow history tables, officer scopes,
-- tracking IDs and the SLA (working-day) clock.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Officer responsibility. A scope row matches by community, by cluster, or by
-- community type (most specific wins for auto-assignment). Seeded officers:
--   Godpower Jaka       -> HOST, PIPELINE
--   Godwin Bebe-Okpabi  -> INDIRECT
--   Esther Walter Anga  -> JETTY
-- Their accounts are created by the Super Admin (see docs); scopes are then
-- set with admin_set_officer_scopes().
-- -----------------------------------------------------------------------------
create table public.officer_scopes (
  id                smallint generated always as identity primary key,
  officer_id        uuid not null references public.profiles(id) on delete cascade,
  community_type_id smallint references public.community_types(id),
  cluster_id        smallint references public.clusters(id),
  community_id      uuid references public.communities(id),
  auto_assign       boolean not null default true,
  created_at        timestamptz not null default now(),
  created_by        uuid,
  check (num_nonnulls(community_type_id, cluster_id, community_id) = 1)
);
create unique index officer_scopes_unique on public.officer_scopes
  (officer_id, coalesce(community_type_id, 0), coalesce(cluster_id, 0), coalesce(community_id, '00000000-0000-0000-0000-000000000000'));
create index officer_scopes_type_idx on public.officer_scopes (community_type_id);
create index officer_scopes_cluster_idx on public.officer_scopes (cluster_id);
create index officer_scopes_comm_idx on public.officer_scopes (community_id);
create trigger officer_scopes_audit after insert or update or delete on public.officer_scopes
  for each row execute function app.audit_row();

create or replace function app.in_officer_scope(p_officer uuid, p_community uuid, p_type smallint, p_cluster smallint)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.officer_scopes s
    where s.officer_id = p_officer
      and (s.community_id = p_community
           or s.cluster_id = p_cluster
           or s.community_type_id = p_type))
$$;

-- -----------------------------------------------------------------------------
-- Tracking IDs: IPL-GRV-2026-000123 (live) and IPL-GRV-2019-H00012 (history).
-- Counter rows are locked by the upsert, so concurrent submissions serialise
-- on the year's counter and can never receive the same number; the UNIQUE
-- constraint on grievances.tracking_id is the final guarantee.
-- -----------------------------------------------------------------------------
create table public.tracking_counters (
  year       int  not null,
  series     text not null check (series in ('live','legacy')),
  last_value int  not null,
  primary key (year, series)
);

create or replace function app.next_tracking_id(p_year int, p_legacy boolean default false) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v int; s text := case when p_legacy then 'legacy' else 'live' end;
begin
  insert into public.tracking_counters as c (year, series, last_value) values (p_year, s, 1)
  on conflict (year, series) do update set last_value = c.last_value + 1
  returning last_value into v;
  return case when p_legacy then format('IPL-GRV-%s-H%s', p_year, lpad(v::text, 5, '0'))
              else format('IPL-GRV-%s-%s', p_year, lpad(v::text, 6, '0')) end;
end $$;

-- -----------------------------------------------------------------------------
-- SLA clock. Working days = ISO weekdays in settings.sla_work_days minus
-- public.holidays, evaluated in the operational time zone.
-- A clock that starts on a non-working day starts at 00:00 on the next
-- working day. Due = start + N working days at the same local time.
-- -----------------------------------------------------------------------------
create or replace function app.is_working_day(p_day date) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select extract(isodow from p_day)::int in (select jsonb_array_elements_text(app.setting('sla_work_days'))::int)
     and not exists (select 1 from public.holidays h where h.day = p_day)
$$;

create or replace function app.sla_due_at(p_start timestamptz) returns timestamptz
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  tz text := app.tz();
  n int := coalesce((app.setting('sla_threshold_days'))::int, 3);
  mode text := coalesce(app.setting('sla_clock') #>> '{}', 'working_days');
  local_ts timestamp := p_start at time zone tz;
  d date := local_ts::date;
  t time := local_ts::time;
  i int := 0;
begin
  if p_start is null then return null; end if;
  if mode = 'calendar_days' then return p_start + make_interval(days => n); end if;
  if not app.is_working_day(d) then
    t := '00:00';
    loop d := d + 1; exit when app.is_working_day(d); end loop;
  end if;
  while i < n loop
    d := d + 1;
    if app.is_working_day(d) then i := i + 1; end if;
  end loop;
  return (d + t) at time zone tz;
end $$;

-- Whole days outstanding on the configured clock (for "unresolved for 4 days").
create or replace function app.days_outstanding(p_start timestamptz, p_end timestamptz default now()) returns int
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  tz text := app.tz();
  mode text := coalesce(app.setting('sla_clock') #>> '{}', 'working_days');
  d date; e date; n int := 0;
begin
  if p_start is null then return null; end if;
  d := (p_start at time zone tz)::date; e := (p_end at time zone tz)::date;
  if mode = 'calendar_days' then return greatest(e - d, 0); end if;
  while d < e loop
    d := d + 1;
    if app.is_working_day(d) then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- -----------------------------------------------------------------------------
-- Grievances
-- -----------------------------------------------------------------------------
create table public.grievances (
  id                        uuid primary key default gen_random_uuid(),
  tracking_id               text not null unique,
  client_submission_id      uuid unique,               -- idempotency key from the device
  origin                    text not null check (origin in ('app','assisted','paper','legacy_import')),
  is_legacy                 boolean not null default false,
  legacy_needs_review       boolean not null default false,  -- legacy open items: no alerts until reviewed

  -- dates
  date_received             date not null,
  date_received_precision   text not null default 'day' check (date_received_precision in ('day','month','year')),
  submitted_at              timestamptz,               -- when the IPL system received it (null for legacy)
  client_created_at         timestamptz,               -- when the draft was written on the device
  form_issued_date          date,
  review_date               date,
  review_date_precision     text check (review_date_precision in ('day','month','year')),
  first_response_at         timestamptz,
  resolved_at               timestamptz,
  closed_at                 timestamptz,
  year                      int generated always as (extract(year from date_received)::int) stored,

  -- complainant (snapshot at submission; legacy and paper records have no account)
  complainant_user_id       uuid references public.profiles(id) on delete set null,
  complainant_name          text,
  complainant_gender        text check (complainant_gender in ('male','female')),
  complainant_phone         text,
  complainant_email         text,
  complainant_address       text,

  -- community (type and cluster are derived, never typed)
  community_id              uuid references public.communities(id),
  community_type_id         smallint references public.community_types(id),
  cluster_id                smallint references public.clusters(id),

  -- the grievance
  title                     text,
  category_id               smallint references public.grievance_categories(id),
  subcategory_id            smallint references public.grievance_subcategories(id),
  severity_id               smallint references public.severities(id),
  description               text not null,
  incident_details          text,
  desired_resolution        text,
  suggestions               text,
  text_amended              boolean not null default false,

  -- workflow
  status_id                 smallint not null references public.grievance_statuses(id),
  assigned_officer_id       uuid references public.profiles(id) on delete set null,
  responsibility            text,
  closure_officer_id        uuid references public.profiles(id) on delete set null,
  submission_code_id        uuid,                      -- FK added with submission_codes
  ack_state                 text not null default 'not_requested'
                              check (ack_state in ('not_requested','pending','acknowledged','disputed','not_captured')),

  -- SLA
  sla_started_at            timestamptz,
  sla_due_at                timestamptz,
  overdue_since             timestamptz,
  last_overdue_alert_at     timestamptz,

  -- legacy / provenance (the original Excel values, verbatim)
  legacy_tracking_id        text,
  legacy_tracking_id_norm   text generated always as (upper(regexp_replace(legacy_tracking_id, '\s', '', 'g'))) stored,
  legacy_category           text,
  legacy_subcategory        text,
  legacy_status             text,
  legacy_severity           text,
  legacy_community          text,
  legacy_community_category text,
  legacy_community_type     text,
  legacy_responsibility     text,
  legacy_closure_officer    text,
  source_workbook           text,
  source_sheet              text,
  source_row                int,
  source_year               int,
  import_batch_id           uuid,

  -- lifecycle
  created_at                timestamptz not null default now(),
  created_by                uuid,
  updated_at                timestamptz not null default now(),
  archived_at               timestamptz,
  archived_by               uuid,
  archive_reason            text,

  search_tsv tsvector generated always as (
    to_tsvector('english', coalesce(title,'') || ' ' || description || ' ' ||
                coalesce(desired_resolution,'') || ' ' || coalesce(incident_details,''))) stored,

  check (length(btrim(description)) > 0),
  check (complainant_phone is null or complainant_phone ~ '^\+234[789][01][0-9]{8}$')
);

create index grievances_status_officer_idx on public.grievances (status_id, assigned_officer_id) where archived_at is null;
create index grievances_officer_idx        on public.grievances (assigned_officer_id) where archived_at is null;
create index grievances_community_idx      on public.grievances (community_id, date_received);
create index grievances_class_idx          on public.grievances (community_type_id, cluster_id);
create index grievances_category_idx       on public.grievances (category_id, subcategory_id);
create index grievances_year_idx           on public.grievances (year);
create index grievances_received_idx       on public.grievances (date_received desc);
create index grievances_complainant_idx    on public.grievances (complainant_user_id, updated_at desc);
create index grievances_sla_idx            on public.grievances (sla_due_at) where resolved_at is null and archived_at is null;
create index grievances_legacy_id_idx      on public.grievances (legacy_tracking_id_norm);
create index grievances_tsv_idx            on public.grievances using gin (search_tsv);
create index grievances_tracking_trgm      on public.grievances using gin (tracking_id extensions.gin_trgm_ops);
create index grievances_legacy_trgm        on public.grievances using gin (legacy_tracking_id_norm extensions.gin_trgm_ops);
create index grievances_name_trgm          on public.grievances using gin (complainant_name extensions.gin_trgm_ops);
create index grievances_phone_trgm         on public.grievances using gin (complainant_phone extensions.gin_trgm_ops);

-- Classification snapshot + consistency checks.
create or replace function app.grievance_before_write() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_sub_cat smallint; v_type smallint; v_cluster smallint; v_req smallint;
begin
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.tracking_id <> old.tracking_id then
      raise exception 'immutable_identifier' using errcode = '42501';
    end if;
    -- The complainant's own words are never silently changed.
    if (new.description, new.incident_details, new.desired_resolution, new.suggestions)
       is distinct from (old.description, old.incident_details, old.desired_resolution, old.suggestions)
       and coalesce(current_setting('app.allow_text_amend', true), '') <> 'on' then
      raise exception 'original_text_is_protected' using errcode = '42501';
    end if;
  end if;

  -- Derive type/cluster from the community master: the primary affiliation,
  -- unless one of the community's other affiliations is explicitly requested
  -- (e.g. staff reclassifying an Akpajo grievance as Pipeline / Cluster 1).
  if new.community_id is not null
     and (tg_op = 'INSERT' or new.community_id is distinct from old.community_id
          or new.community_type_id is distinct from old.community_type_id
          or new.cluster_id is distinct from old.cluster_id) then
    v_req := case when tg_op = 'INSERT' or new.community_type_id is distinct from old.community_type_id
                  then new.community_type_id end;
    select c.community_type_id, c.cluster_id into v_type, v_cluster
    from app.community_classification(new.community_id, v_req) c;
    if not found then
      raise exception '%', case when v_req is null then 'community_unclassified' else 'invalid_affiliation' end
        using errcode = '23514';
    end if;
    new.community_type_id := v_type;
    new.cluster_id := v_cluster;
  elsif new.community_id is null and not new.is_legacy then
    raise exception 'community_required' using errcode = '23514';
  end if;

  if new.subcategory_id is not null then
    select category_id into v_sub_cat from public.grievance_subcategories where id = new.subcategory_id;
    if new.category_id is null then new.category_id := v_sub_cat;
    elsif new.category_id <> v_sub_cat then raise exception 'subcategory_mismatch' using errcode = '23514';
    end if;
  end if;

  if tg_op = 'INSERT' and new.sla_started_at is null and new.submitted_at is not null then
    new.sla_started_at := new.submitted_at;
  end if;
  if new.sla_started_at is distinct from (case when tg_op = 'UPDATE' then old.sla_started_at end) then
    new.sla_due_at := app.sla_due_at(new.sla_started_at);
  end if;

  new.updated_at := now();
  return new;
end $$;

create trigger grievances_before_write before insert or update on public.grievances
  for each row execute function app.grievance_before_write();
create trigger grievances_audit after insert or update or delete on public.grievances
  for each row execute function app.audit_row();

-- Recompute open deadlines when holidays or clock settings change.
create or replace function app.recompute_open_sla() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.grievances g set sla_due_at = app.sla_due_at(g.sla_started_at)
  from public.grievance_statuses s
  where s.id = g.status_id and not s.stops_sla and g.sla_started_at is not null and g.archived_at is null;
  return null;
end $$;
create trigger holidays_recompute_sla after insert or update or delete on public.holidays
  for each statement execute function app.recompute_open_sla();
create trigger settings_recompute_sla after update on public.settings
  for each row when (new.key in ('sla_threshold_days','sla_clock','sla_work_days','timezone'))
  execute function app.recompute_open_sla();

-- -----------------------------------------------------------------------------
-- Workflow history
-- -----------------------------------------------------------------------------
create table public.grievance_status_history (
  id                     bigint generated always as identity primary key,
  grievance_id           uuid not null references public.grievances(id) on delete cascade,
  from_status_id         smallint references public.grievance_statuses(id),
  to_status_id           smallint not null references public.grievance_statuses(id),
  changed_by             uuid,
  changed_at             timestamptz not null default now(),
  note                   text,
  visible_to_complainant boolean not null default true
);
create index grievance_status_history_g_idx on public.grievance_status_history (grievance_id, changed_at);

create table public.grievance_assignments (
  id            bigint generated always as identity primary key,
  grievance_id  uuid not null references public.grievances(id) on delete cascade,
  officer_id    uuid references public.profiles(id) on delete set null,
  assigned_by   uuid,
  assigned_at   timestamptz not null default now(),
  unassigned_at timestamptz,
  reason        text
);
create index grievance_assignments_g_idx on public.grievance_assignments (grievance_id, assigned_at);

create table public.grievance_comments (
  id           bigint generated always as identity primary key,
  grievance_id uuid not null references public.grievances(id) on delete cascade,
  author_id    uuid,
  kind         text not null default 'remark' check (kind in ('remark','officer_remark','question','reply','system')),
  visibility   text not null default 'internal' check (visibility in ('internal','complainant')),
  body         text not null check (length(btrim(body)) > 0),
  created_at   timestamptz not null default now()
);
create index grievance_comments_g_idx on public.grievance_comments (grievance_id, created_at);

create table public.grievance_actions (
  id           bigint generated always as identity primary key,
  grievance_id uuid not null references public.grievances(id) on delete cascade,
  action_type  text not null default 'action' check (action_type in ('action','management_action','field_visit','meeting','referral','call')),
  description  text not null check (length(btrim(description)) > 0),
  action_date  date,
  action_date_precision text not null default 'day' check (action_date_precision in ('day','month','year')),
  created_by   uuid,
  created_at   timestamptz not null default now()
);
create index grievance_actions_g_idx on public.grievance_actions (grievance_id, created_at);

create table public.grievance_resolutions (
  id             bigint generated always as identity primary key,
  grievance_id   uuid not null references public.grievances(id) on delete cascade,
  details        text not null check (length(btrim(details)) > 0),
  public_summary text,
  resolved_by    uuid,
  resolved_at    timestamptz not null default now(),
  is_current     boolean not null default true
);
create unique index grievance_resolutions_current on public.grievance_resolutions (grievance_id) where is_current;

create table public.grievance_acknowledgements (
  id           bigint generated always as identity primary key,
  grievance_id uuid not null references public.grievances(id) on delete cascade,
  resolution_id bigint references public.grievance_resolutions(id) on delete set null,
  response     text not null check (response in ('acknowledged','disputed')),
  reason       text,
  user_id      uuid,                    -- complainant (when self-service)
  recorded_by  uuid,                    -- staff member recording on their behalf
  channel      text not null default 'app' check (channel in ('app','phone','in_person','whatsapp','paper')),
  created_at   timestamptz not null default now(),
  check (response = 'acknowledged' or length(btrim(coalesce(reason, ''))) > 0)
);
create index grievance_acknowledgements_g_idx on public.grievance_acknowledgements (grievance_id, created_at);

create table public.attachments (
  id           uuid primary key default gen_random_uuid(),
  grievance_id uuid not null references public.grievances(id) on delete cascade,
  storage_path text not null unique,
  file_name    text not null,
  mime_type    text not null check (mime_type in ('image/jpeg','image/png','image/webp','application/pdf')),
  size_bytes   int not null check (size_bytes between 1 and 5242880),
  sha256       text,
  visibility   text not null default 'internal' check (visibility in ('internal','complainant')),
  uploaded_by  uuid,
  created_at   timestamptz not null default now()
);
create index attachments_g_idx on public.attachments (grievance_id);

create table public.grievance_flags (
  id           bigint generated always as identity primary key,
  grievance_id uuid not null references public.grievances(id) on delete cascade,
  flag         text not null check (flag in ('duplicate_candidate','id_collision','date_suspect','unmapped_value',
                                             'invalid_phone','community_unknown','needs_review','archive_requested')),
  detail       jsonb,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  resolved_at  timestamptz,
  resolved_by  uuid,
  resolution   text
);
create index grievance_flags_open_idx on public.grievance_flags (flag) where resolved_at is null;
create index grievance_flags_g_idx on public.grievance_flags (grievance_id);

do $$
declare t text;
begin
  foreach t in array array['grievance_assignments','grievance_resolutions','grievance_acknowledgements','attachments','grievance_flags']
  loop
    execute format('create trigger %1$s_audit after insert or update or delete on public.%1$s
                    for each row execute function app.audit_row()', t);
  end loop;
end $$;

-- Read check reused by child-table policies: evaluated as the caller, so the
-- grievances RLS policy decides.
create or replace function app.can_read_grievance(p_id uuid) returns boolean
language sql stable set search_path = public, pg_temp as $$
  select exists (select 1 from public.grievances where id = p_id)
$$;
grant execute on function app.can_read_grievance(uuid) to authenticated;
