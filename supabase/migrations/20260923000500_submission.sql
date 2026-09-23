-- =============================================================================
-- Accounts (sign-up hook, profile updates), submission codes, and grievance
-- submission (self-service and assisted/paper).
-- =============================================================================

-- ---- sign-up ------------------------------------------------------------------
-- Every self-registered account is a community member. Metadata from the
-- client is never trusted for roles; staff roles are granted by an admin.
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_comm uuid;
begin
  select id into v_comm from public.communities
  where active and id::text = m ->> 'community_id';

  insert into public.profiles (id, full_name, phone, email, community_id, address, gender)
  values (new.id,
          coalesce(nullif(btrim(m ->> 'full_name'), ''), 'Community member'),
          app.normalize_phone(coalesce(new.phone, m ->> 'phone')),
          -- Members sign in with a phone mapped to a login-only address; that address
          -- is not their email. Staff accounts use their real email.
          case when m ? 'phone' then nullif(btrim(m ->> 'email'), '') else coalesce(new.email, nullif(btrim(m ->> 'email'), '')) end,
          v_comm,
          nullif(btrim(m ->> 'address'), ''),
          case when m ->> 'gender' in ('male','female') then m ->> 'gender' end);

  insert into public.user_roles (user_id, role_id)
  select new.id, id from public.roles where code = 'community_member';
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

create or replace function public.update_my_profile(p jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_comm uuid;
begin
  if auth.uid() is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if p ? 'community_id' then
    select id into v_comm from public.communities where active and id::text = p ->> 'community_id';
    if v_comm is null then raise exception 'community_invalid' using errcode = '22023'; end if;
  end if;
  update public.profiles set
    full_name    = case when p ? 'full_name' then nullif(btrim(p ->> 'full_name'), '') else full_name end,
    community_id = case when p ? 'community_id' then v_comm else community_id end,
    email        = case when p ? 'email' then nullif(btrim(p ->> 'email'), '') else email end,
    address      = case when p ? 'address' then nullif(btrim(p ->> 'address'), '') else address end,
    gender       = case when p ? 'gender' then nullif(p ->> 'gender', '') else gender end
  where id = auth.uid();
end $$;

create or replace function public.my_profile() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', p.id, 'full_name', p.full_name, 'phone', p.phone, 'email', p.email, 'address', p.address,
    'gender', p.gender, 'community_id', p.community_id, 'community_name', c.name, 'is_active', p.is_active)
  from public.profiles p left join public.communities c on c.id = p.community_id
  where p.id = auth.uid()
$$;

-- ---- submission codes ------------------------------------------------------------
create table public.submission_codes (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique check (code ~ '^[A-Z0-9]{2,5}-[0-9]{4}-[0-9]{4}-[A-Z0-9]{4}$'),
  label               text,
  scope_type          text not null check (scope_type in ('all','community_type','cluster','community')),
  community_type_id   smallint references public.community_types(id),
  cluster_id          smallint references public.clusters(id),
  community_id        uuid references public.communities(id),
  valid_from          timestamptz not null,
  valid_until         timestamptz not null,
  max_submissions     int check (max_submissions is null or max_submissions > 0),
  submission_count    int not null default 0,
  status              text not null default 'draft' check (status in ('draft','active','deactivated')),
  created_by          uuid,
  created_at          timestamptz not null default now(),
  released_by         uuid,
  released_at         timestamptz,
  deactivated_by      uuid,
  deactivated_at      timestamptz,
  deactivation_reason text,
  check (valid_until > valid_from),
  check ((scope_type = 'all'            and num_nonnulls(community_type_id, cluster_id, community_id) = 0)
      or (scope_type = 'community_type' and community_type_id is not null and cluster_id is null and community_id is null)
      or (scope_type = 'cluster'        and cluster_id is not null and community_type_id is null and community_id is null)
      or (scope_type = 'community'      and community_id is not null and community_type_id is null and cluster_id is null))
);
create index submission_codes_active_idx on public.submission_codes (valid_until) where status = 'active';
create trigger submission_codes_audit after insert or update or delete on public.submission_codes
  for each row execute function app.audit_row();

alter table public.grievances
  add constraint grievances_submission_code_fk foreign key (submission_code_id) references public.submission_codes(id);

create or replace function app.code_covers(c public.submission_codes, p_community uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case c.scope_type
    when 'all' then true
    when 'community' then c.community_id = p_community
    when 'cluster' then exists (select 1 from public.community_affiliations a
                                where a.community_id = p_community and a.active and a.cluster_id = c.cluster_id)
    when 'community_type' then exists (select 1 from public.community_affiliations a
                                where a.community_id = p_community and a.active and a.community_type_id = c.community_type_id)
  end
$$;

-- Ambiguity-free alphabet (no 0/O, 1/I/L).
create or replace function app.random_token(p_len int) returns text
language plpgsql volatile as $$
declare
  alphabet text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  b bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  s text := '';
begin
  for i in 0 .. p_len - 1 loop
    s := s || substr(alphabet, (get_byte(b, i) % length(alphabet)) + 1, 1);
  end loop;
  return s;
end $$;

-- Officers may only create codes inside their own responsibility.
create or replace function app.code_scope_allowed(p_scope text, p_type smallint, p_cluster smallint, p_comm uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select app.has_perm('grievance.read.all') or case p_scope
    when 'community_type' then exists (select 1 from public.officer_scopes s where s.officer_id = auth.uid() and s.community_type_id = p_type)
    when 'cluster' then exists (select 1 from public.officer_scopes s
                                join public.clusters c on c.id = p_cluster
                                where s.officer_id = auth.uid() and (s.cluster_id = p_cluster or s.community_type_id = c.community_type_id))
    when 'community' then exists (select 1 from public.community_affiliations a
                                  where a.community_id = p_comm and a.active
                                    and app.in_officer_scope(auth.uid(), p_comm, a.community_type_id, a.cluster_id))
    else false end
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
                                       valid_from, valid_until, max_submissions, created_by)
  values (v_code, nullif(btrim(p ->> 'label'), ''), v_scope, v_type, v_cluster, v_comm,
          v_from, v_until, (p ->> 'max_submissions')::int, auth.uid())
  returning * into v;
  perform app.log('submission_code.generated', 'submission_codes', v.id::text, null, to_jsonb(v));

  if coalesce((p ->> 'release')::boolean, false) then
    v := public.release_submission_code(v.id);
  end if;
  return v;
end $$;

create or replace function public.release_submission_code(p_id uuid) returns public.submission_codes
language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.submission_codes; v_scope_name text;
begin
  perform app.require_perm('codes.manage');
  select * into v from public.submission_codes where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not app.code_scope_allowed(v.scope_type, v.community_type_id, v.cluster_id, v.community_id) then
    raise exception 'outside_your_responsibility' using errcode = '42501';
  end if;
  if v.status <> 'draft' then raise exception 'code_not_draft' using errcode = '22023'; end if;

  update public.submission_codes set status = 'active', released_by = auth.uid(), released_at = now()
  where id = p_id returning * into v;
  perform app.log('submission_code.released', 'submission_codes', v.id::text);

  -- Tell members in the covered communities (in-app only: no cost to them).
  perform app.notify(p.id, 'submission_window_opened',
                     'Grievance collection is open',
                     format('You can now submit a grievance for %s until %s.', c.name,
                            to_char(v.valid_until at time zone app.tz(), 'FMDD Mon YYYY')),
                     null, jsonb_build_object('code_id', v.id))
  from public.profiles p
  join public.communities c on c.id = p.community_id
  where p.is_active and app.code_covers(v, p.community_id) and app.has_role(p.id, 'community_member');
  return v;
end $$;

create or replace function public.deactivate_submission_code(p_id uuid, p_reason text default null) returns public.submission_codes
language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.submission_codes;
begin
  perform app.require_perm('codes.manage');
  select * into v from public.submission_codes where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not app.code_scope_allowed(v.scope_type, v.community_type_id, v.cluster_id, v.community_id) then
    raise exception 'outside_your_responsibility' using errcode = '42501';
  end if;
  if v.status = 'deactivated' then return v; end if;
  update public.submission_codes
     set status = 'deactivated', deactivated_by = auth.uid(), deactivated_at = now(), deactivation_reason = p_reason
   where id = p_id returning * into v;
  perform app.log('submission_code.deactivated', 'submission_codes', v.id::text, null, jsonb_build_object('reason', p_reason));
  return v;
end $$;

-- What a signed-in member sees on Home / Get Code for their community.
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
    'open', c.id is not null,
    'community_id', v_comm,
    'community_name', (select name from public.communities where id = v_comm),
    'code', c.code,
    'valid_from', c.valid_from,
    'valid_until', c.valid_until,
    'server_time', now());
end $$;

-- -----------------------------------------------------------------------------
-- Auto-assignment: most specific scope wins (community > cluster > type),
-- ties go to the officer with the fewest open grievances.
-- -----------------------------------------------------------------------------
create or replace function app.pick_officer(p_comm uuid, p_type smallint, p_cluster smallint) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select s.officer_id
  from public.officer_scopes s
  join public.profiles p on p.id = s.officer_id and p.is_active
  where s.auto_assign
    and (s.community_id = p_comm or s.cluster_id = p_cluster or s.community_type_id = p_type)
    and app.has_role(s.officer_id, 'officer')
  order by case when s.community_id is not null then 1 when s.cluster_id is not null then 2 else 3 end,
           (select count(*) from public.grievances g join public.grievance_statuses st on st.id = g.status_id
             where g.assigned_officer_id = s.officer_id and st.is_open and g.archived_at is null),
           s.officer_id
  limit 1
$$;

create or replace function app.status_id(p_code text) returns smallint
language sql stable security definer set search_path = public, pg_temp as $$
  select id from public.grievance_statuses where code = p_code
$$;

create or replace function app.clean_text(p text, p_max int) returns text
language plpgsql immutable as $$
declare v text := nullif(btrim(regexp_replace(coalesce(p, ''), '[​\u0000]', '', 'g')), '');
begin
  if v is not null and length(v) > p_max then raise exception 'text_too_long' using errcode = '22001', detail = p_max::text; end if;
  return v;
end $$;

-- Shared insert path for self-service and assisted submissions.
create or replace function app.create_grievance(p jsonb, p_origin text, p_complainant uuid, p_code_id uuid)
returns public.grievances
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  g public.grievances;
  v_desc text := app.clean_text(p ->> 'description', 5000);
  v_comm uuid;
  v_today date := (now() at time zone app.tz())::date;
  v_received date := coalesce((p ->> 'date_received')::date, v_today);
  v_prof public.profiles;
  v_officer uuid;
begin
  if v_desc is null or length(v_desc) < 10 then raise exception 'description_too_short' using errcode = '22023'; end if;
  if v_received > v_today then raise exception 'date_in_future' using errcode = '22023'; end if;
  select id into v_comm from public.communities where active and id::text = p ->> 'community_id';
  if v_comm is null then raise exception 'community_invalid' using errcode = '22023'; end if;
  if (p ->> 'category_id') is not null and not exists
       (select 1 from public.grievance_categories where active and id = (p ->> 'category_id')::smallint) then
    raise exception 'category_invalid' using errcode = '22023';
  end if;
  if (p ->> 'subcategory_id') is not null and not exists
       (select 1 from public.grievance_subcategories where active and id = (p ->> 'subcategory_id')::smallint) then
    raise exception 'subcategory_invalid' using errcode = '22023';
  end if;

  if p_complainant is not null then
    select * into v_prof from public.profiles where id = p_complainant;
  end if;

  insert into public.grievances (
    tracking_id, client_submission_id, origin, date_received, submitted_at, client_created_at, form_issued_date,
    complainant_user_id, complainant_name, complainant_gender, complainant_phone, complainant_email, complainant_address,
    community_id, title, category_id, subcategory_id, description, incident_details, desired_resolution, suggestions,
    status_id, submission_code_id, created_by)
  values (
    app.next_tracking_id(extract(year from v_today)::int),
    (p ->> 'client_submission_id')::uuid, p_origin, v_received, now(),
    least((p ->> 'client_created_at')::timestamptz, now()), (p ->> 'form_issued_date')::date,
    p_complainant,
    coalesce(v_prof.full_name, app.clean_text(p ->> 'complainant_name', 120)),
    coalesce(v_prof.gender, nullif(p ->> 'complainant_gender', '')),
    coalesce(v_prof.phone, app.normalize_phone(p ->> 'complainant_phone')),
    coalesce(v_prof.email, app.clean_text(p ->> 'complainant_email', 200)),
    coalesce(v_prof.address, app.clean_text(p ->> 'complainant_address', 300)),
    v_comm,
    coalesce(app.clean_text(p ->> 'title', 120), left(regexp_replace(v_desc, '\s+', ' ', 'g'), 80)),
    (p ->> 'category_id')::smallint, (p ->> 'subcategory_id')::smallint,
    v_desc, app.clean_text(p ->> 'incident_details', 5000),
    app.clean_text(p ->> 'desired_resolution', 2000), app.clean_text(p ->> 'suggestions', 2000),
    app.status_id('SUBMITTED'), p_code_id, auth.uid())
  returning * into g;

  insert into public.grievance_status_history (grievance_id, from_status_id, to_status_id, changed_by, note)
  values (g.id, null, g.status_id, auth.uid(), null);

  v_officer := app.pick_officer(g.community_id, g.community_type_id, g.cluster_id);
  if v_officer is not null then
    update public.grievances set assigned_officer_id = v_officer where id = g.id returning * into g;
    insert into public.grievance_assignments (grievance_id, officer_id, assigned_by, reason)
    values (g.id, v_officer, null, 'auto: responsibility');
    perform app.notify(v_officer, 'officer_assigned', 'New grievance assigned',
                       format('%s · %s', g.tracking_id, (select name from public.communities where id = g.community_id)),
                       g.id);
  end if;

  perform app.log('grievance.created', 'grievances', g.id::text, null,
                  jsonb_build_object('tracking_id', g.tracking_id, 'origin', p_origin));
  return g;
end $$;

-- Self-service submission (community member). Idempotent on client_submission_id.
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

-- Staff entry of paper forms / assisted submissions. No code needed.
create or replace function public.submit_grievance_assisted(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_client uuid := (p ->> 'client_submission_id')::uuid;
  v_existing public.grievances;
  v_origin text := coalesce(p ->> 'origin', 'paper');
  g public.grievances;
begin
  perform app.require_perm('grievance.create.assisted');
  if v_origin not in ('paper','assisted') then raise exception 'origin_invalid' using errcode = '22023'; end if;
  if app.clean_text(p ->> 'complainant_name', 120) is null then raise exception 'name_required' using errcode = '22023'; end if;
  if nullif(btrim(p ->> 'complainant_phone'), '') is not null and app.normalize_phone(p ->> 'complainant_phone') is null then
    raise exception 'phone_invalid' using errcode = '22023';
  end if;
  if v_client is not null then
    select * into v_existing from public.grievances where client_submission_id = v_client;
    if found then
      return jsonb_build_object('id', v_existing.id, 'tracking_id', v_existing.tracking_id, 'result', 'already_submitted');
    end if;
  end if;

  g := app.create_grievance(p, v_origin, null, null);
  if g.complainant_phone is not null then
    perform app.notify(null, 'grievance_submitted', 'Grievance received',
                       format('Your grievance %s has been received by IPL Community Relations.', g.tracking_id),
                       g.id, jsonb_build_object('tracking_id', g.tracking_id),
                       g.complainant_phone, 'grievance_received',
                       jsonb_build_array(g.complainant_name, g.tracking_id));
  end if;
  return jsonb_build_object('id', g.id, 'tracking_id', g.tracking_id, 'submitted_at', g.submitted_at, 'result', 'created');
end $$;
