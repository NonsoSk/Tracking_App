-- =============================================================================
-- Phone number check by text message (OTP) when a community member registers.
--
-- * The app asks for a 6-digit code sent by SMS to the number being registered.
--   The code is generated and checked here; the phone-otp Edge Function only
--   sends the text (so the SMS key stays on the server).
-- * A member account can only be created for a number that was confirmed in the
--   last 30 minutes, and each confirmation can be used once. Together with one
--   login per phone number, this stops duplicate accounts and made-up numbers.
-- * Limits: one code a minute, five a day per number, ten an hour per network
--   address; a code lasts 10 minutes and allows 5 tries.
-- * Settings → "phone_otp_required" can switch the check off (e.g. while the SMS
--   provider is being set up).
-- Also: staff see the complainant's full profile (complainant_details).
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

insert into public.settings (key, value, description, is_public) values
  ('phone_otp_required', 'true', 'Community members must confirm their phone number with a text-message code when they register', true)
on conflict (key) do nothing;

alter table public.profiles add column if not exists phone_verified_at timestamptz;

create table if not exists public.phone_verifications (
  id          bigint generated always as identity primary key,
  phone       text not null,
  code_hash   text not null,
  ip          text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  attempts    int not null default 0,
  verified_at timestamptz,
  consumed_at timestamptz
);
create index if not exists phone_verifications_phone_idx on public.phone_verifications (phone, created_at desc);
create index if not exists phone_verifications_ip_idx on public.phone_verifications (ip, created_at desc);
alter table public.phone_verifications enable row level security;
revoke all on public.phone_verifications from public, anon, authenticated;

-- Make a code for a number (called by the phone-otp Edge Function with the service role).
create or replace function public.otp_request(p_phone text, p_ip text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v text := app.normalize_phone(p_phone); v_code text;
begin
  if v is null then raise exception 'phone_invalid' using errcode = '22023'; end if;
  if exists (select 1 from public.profiles where phone = v) then raise exception 'account_exists' using errcode = '23505'; end if;
  if exists (select 1 from public.phone_verifications where phone = v and created_at > now() - interval '60 seconds') then
    raise exception 'otp_too_soon' using errcode = '22023';
  end if;
  if (select count(*) from public.phone_verifications where phone = v and created_at > now() - interval '1 day') >= 5
     or (p_ip is not null and (select count(*) from public.phone_verifications where ip = p_ip and created_at > now() - interval '1 hour') >= 10) then
    raise exception 'otp_limit' using errcode = '22023';
  end if;
  v_code := lpad((abs(('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::int) % 1000000)::text, 6, '0');
  insert into public.phone_verifications (phone, code_hash, ip, expires_at)
  values (v, encode(digest(v || ':' || v_code, 'sha256'), 'hex'), p_ip, now() + interval '10 minutes');
  return jsonb_build_object('phone', v, 'code', v_code);
end $$;

-- Check a code. Returns {"ok":true} or {"ok":false,"error":"otp_wrong|otp_expired|otp_locked","tries_left":n}.
create or replace function public.otp_verify(p_phone text, p_code text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v text := app.normalize_phone(p_phone); r public.phone_verifications;
begin
  select * into r from public.phone_verifications
  where phone = v and verified_at is null and consumed_at is null
  order by created_at desc limit 1 for update;
  if r.id is null or r.expires_at < now() then return jsonb_build_object('ok', false, 'error', 'otp_expired'); end if;
  if r.attempts >= 5 then return jsonb_build_object('ok', false, 'error', 'otp_locked'); end if;
  if r.code_hash = encode(digest(v || ':' || btrim(coalesce(p_code, '')), 'sha256'), 'hex') then
    update public.phone_verifications set verified_at = now() where id = r.id;
    return jsonb_build_object('ok', true, 'phone', v);
  end if;
  update public.phone_verifications set attempts = attempts + 1 where id = r.id;
  return jsonb_build_object('ok', false, 'error', case when r.attempts + 1 >= 5 then 'otp_locked' else 'otp_wrong' end,
                            'tries_left', greatest(0, 4 - r.attempts));
end $$;

-- The text could not be sent: forget the unsent code so the person can try again at once.
create or replace function public.otp_discard(p_phone text) returns void
language sql security definer set search_path = public, pg_temp as $$
  delete from public.phone_verifications
  where id = (select id from public.phone_verifications where phone = app.normalize_phone(p_phone)
              and verified_at is null order by created_at desc limit 1)
$$;

revoke execute on function public.otp_request(text, text), public.otp_verify(text, text), public.otp_discard(text) from public, anon, authenticated;
grant execute on function public.otp_request(text, text), public.otp_verify(text, text), public.otp_discard(text) to service_role;

-- A member login can only be created for a recently confirmed number (used once).
create or replace function app.require_verified_phone() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb); v text; v_at timestamptz;
begin
  if not (m ? 'phone') or coalesce((app.setting('phone_otp_required'))::boolean, false) is not true then return new; end if;
  v := app.normalize_phone(m ->> 'phone');
  update public.phone_verifications set consumed_at = now()
  where id = (select id from public.phone_verifications
              where phone = v and consumed_at is null and verified_at > now() - interval '30 minutes'
              order by verified_at desc limit 1)
  returning verified_at into v_at;
  if v_at is null then raise exception 'phone_not_verified' using errcode = '42501'; end if;
  new.raw_user_meta_data := m || jsonb_build_object('phone_verified_at', v_at);
  return new;
end $$;
drop trigger if exists before_auth_user_created_phone on auth.users;
create trigger before_auth_user_created_phone before insert on auth.users
  for each row execute function app.require_verified_phone();

create or replace function app.record_phone_verified() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.raw_user_meta_data ? 'phone_verified_at' then
    update public.profiles set phone_verified_at = (new.raw_user_meta_data ->> 'phone_verified_at')::timestamptz where id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_created_phone on auth.users;
create trigger on_auth_user_created_phone after insert on auth.users
  for each row execute function app.record_phone_verified();

-- The complainant's full profile, for staff who may see contact details.
create or replace function public.complainant_details(p_grievance uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare g public.grievances; p public.profiles;
begin
  select * into g from public.grievances where id = p_grievance;
  if g.id is null or not (app.can_work(g) or app.is_super_admin()) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not app.has_perm('grievance.read.contact') then return null; end if;
  if g.complainant_user_id is null then return jsonb_build_object('registered', false); end if;
  select * into p from public.profiles where id = g.complainant_user_id;
  return jsonb_build_object(
    'registered', true,
    'full_name', p.full_name, 'phone', p.phone, 'phone_verified', p.phone_verified_at is not null,
    'gender', p.gender, 'email', p.email, 'address', p.address,
    'home_community', (select name from public.communities where id = p.community_id),
    'member_since', p.created_at,
    'grievances_total', (select count(*) from public.grievances x where x.complainant_user_id = p.id and x.archived_at is null),
    'grievances_open', (select count(*) from public.grievances x join public.grievance_statuses s on s.id = x.status_id
                        where x.complainant_user_id = p.id and s.is_open and x.archived_at is null));
end $$;
revoke execute on function public.complainant_details(uuid) from public, anon;
grant execute on function public.complainant_details(uuid) to authenticated;
