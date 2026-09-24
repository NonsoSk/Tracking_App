-- UPDATE (26 Sep 2026): members must type the exact submission code; only the Super Admin creates codes.
-- Run after 03-update-2026-09-24.sql and 04-update-2026-09-25.sql. Safe to run more than once.

-- =============================================================================
-- Submission codes: only the Super Admin creates them, and members must type
-- the exact code they got from their community leader.
--
-- * The app never shows or fills in a code for a member: get_submission_status
--   says whether collection is open, never which code.
-- * Only the Super Admin can create, release or deactivate codes (no other role
--   holds codes.manage any more; the Super Admin passes every check).
-- * check_submission_code lets the app confirm a typed code before the member
--   writes their grievance, with a limit on wrong guesses. The code is still
--   checked again, exactly, when the grievance is submitted.
-- * Every grievance still gets its own tracking ID (IPL-GRV-YYYY-NNNNNN), even
--   when many people use the same code.
-- =============================================================================

delete from public.role_permissions where permission_code = 'codes.manage';
update public.permissions set description = 'Create, release and deactivate submission codes (Super Admin only)'
 where code = 'codes.manage';

-- Status for the member's home screen: open or closed, never the code itself.
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
    'valid_from', c.valid_from,
    'valid_until', c.valid_until,
    'server_time', now());
end $$;

-- Wrong-code attempts, to slow down guessing.
create table if not exists app.code_attempts (
  user_id uuid not null,
  at      timestamptz not null default now()
);
create index if not exists code_attempts_user_idx on app.code_attempts (user_id, at);

-- Confirm a typed code before the member writes their grievance.
-- Returns {"ok": true, "scope": "Agbonchia", "valid_until": …} or {"ok": false, "error": "code_invalid" | …}.
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
  end;
  if v_err is not null then
    insert into app.code_attempts (user_id) values (auth.uid());
    return jsonb_build_object('ok', false, 'error', v_err);
  end if;
  return jsonb_build_object('ok', true, 'valid_until', c.valid_until,
    'scope', coalesce((select name from public.communities where id = c.community_id),
                      (select t.name || ' ' || cl.name from public.clusters cl join public.community_types t on t.id = cl.community_type_id where cl.id = c.cluster_id),
                      (select 'all ' || name || ' communities' from public.community_types where id = c.community_type_id),
                      'all communities'));
end $$;

-- Members are told collection is open, and to get the code from their leader.
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
                     format('Grievances are being collected for %s until %s. Ask your community leader for the submission code.', c.name,
                            to_char(v.valid_until at time zone app.tz(), 'FMDD Mon YYYY')),
                     null, jsonb_build_object('code_id', v.id))
  from public.profiles p
  join public.communities c on c.id = p.community_id
  where p.is_active and app.code_covers(v, p.community_id) and app.has_role(p.id, 'community_member');
  return v;
end $$;

revoke execute on function public.check_submission_code(text, uuid) from public, anon;
grant execute on function public.check_submission_code(text, uuid) to authenticated;
