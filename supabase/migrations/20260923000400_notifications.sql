-- =============================================================================
-- Notifications: in-app items + a provider-agnostic delivery outbox.
--
-- Every outbound message (WhatsApp now; SMS/email later) is a row in
-- notification_deliveries. The `notify-dispatch` Edge Function claims queued
-- rows, calls the configured provider and reports back. Status only reaches
-- 'delivered'/'read' when the provider's webhook confirms it; nothing here
-- ever assumes success.
-- =============================================================================

create table public.notifications (
  id           bigint generated always as identity primary key,
  user_id      uuid references public.profiles(id) on delete cascade,  -- null: complainant without an account
  type         text not null check (type in (
                 'grievance_submitted','grievance_status_changed','grievance_resolved','acknowledgement_required',
                 'grievance_disputed','grievance_comment','officer_assigned','grievance_overdue','overdue_digest',
                 'submission_window_opened','submission_window_closed','archive_requested')),
  title        text not null,
  body         text not null,
  grievance_id uuid references public.grievances(id) on delete cascade,
  data         jsonb not null default '{}'::jsonb,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

create table public.notification_deliveries (
  id                  bigint generated always as identity primary key,
  notification_id     bigint not null references public.notifications(id) on delete cascade,
  channel             text not null check (channel in ('whatsapp','sms','email')),
  recipient           text not null,
  provider            text,
  template_name       text,
  template_params     jsonb,
  status              text not null default 'queued'
                        check (status in ('queued','sending','sent','delivered','read','failed','skipped')),
  provider_message_id text unique,
  attempts            smallint not null default 0,
  next_attempt_at     timestamptz not null default now(),
  last_error          text,
  sent_at             timestamptz,
  delivered_at        timestamptz,
  read_at             timestamptz,
  failed_at           timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index notification_deliveries_queue_idx on public.notification_deliveries (channel, next_attempt_at) where status = 'queued';
create index notification_deliveries_notif_idx on public.notification_deliveries (notification_id);
create trigger notification_deliveries_touch before update on public.notification_deliveries
  for each row execute function app.touch_updated_at();

-- Phone normaliser for Nigerian mobile numbers -> E.164 (+234XXXXXXXXXX) or null.
create or replace function app.normalize_phone(p text) returns text
language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if d ~ '^234[789][01][0-9]{8}$' then return '+' || d; end if;
  if d ~ '^0[789][01][0-9]{8}$'    then return '+234' || substr(d, 2); end if;
  if d ~ '^[789][01][0-9]{8}$'     then return '+234' || d; end if;
  return null;
end $$;

-- Create an in-app notification and, when asked, queue a WhatsApp delivery.
-- If WhatsApp is switched off the delivery is recorded as 'skipped' (honest
-- record, and no surprise backlog when it is switched on later).
create or replace function app.notify(
  p_user uuid, p_type text, p_title text, p_body text,
  p_grievance uuid default null, p_data jsonb default '{}'::jsonb,
  p_whatsapp_to text default null, p_template text default null, p_template_params jsonb default null
) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id bigint; v_phone text := app.normalize_phone(p_whatsapp_to); v_enabled boolean;
begin
  insert into public.notifications (user_id, type, title, body, grievance_id, data)
  values (p_user, p_type, p_title, p_body, p_grievance, coalesce(p_data, '{}'::jsonb))
  returning id into v_id;

  if v_phone is not null then
    v_enabled := coalesce((app.setting('whatsapp_enabled'))::boolean, false);
    insert into public.notification_deliveries (notification_id, channel, recipient, provider, template_name, template_params,
                                                status, last_error)
    values (v_id, 'whatsapp', v_phone, 'meta_cloud', p_template, p_template_params,
            case when v_enabled then 'queued' else 'skipped' end,
            case when v_enabled then null else 'whatsapp_disabled' end);
  end if;
  return v_id;
end $$;

-- ---- dispatcher API (service role only) --------------------------------------
create or replace function public.claim_notification_deliveries(p_channel text, p_limit int default 20)
returns setof public.notification_deliveries
language sql security definer set search_path = public, pg_temp as $$
  update public.notification_deliveries d
     set status = 'sending', attempts = d.attempts + 1
   where d.id in (select id from public.notification_deliveries
                  where status = 'queued' and channel = p_channel and next_attempt_at <= now()
                  order by next_attempt_at
                  limit greatest(p_limit, 1)
                  for update skip locked)
  returning d.*
$$;

-- Result of the provider API call (accepted or not). Accepted = 'sent', not delivered.
create or replace function public.report_notification_delivery(
  p_id bigint, p_ok boolean, p_provider_message_id text default null,
  p_error text default null, p_permanent boolean default false
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_attempts smallint;
begin
  select attempts into v_attempts from public.notification_deliveries where id = p_id and status = 'sending' for update;
  if not found then return; end if;
  if p_ok then
    update public.notification_deliveries
       set status = 'sent', provider_message_id = p_provider_message_id, sent_at = now(), last_error = null
     where id = p_id;
  elsif p_permanent or v_attempts >= 6 then
    update public.notification_deliveries set status = 'failed', failed_at = now(), last_error = p_error where id = p_id;
  else
    -- exponential backoff: 2, 4, 8, 16, 32 minutes
    update public.notification_deliveries
       set status = 'queued', last_error = p_error,
           next_attempt_at = now() + make_interval(mins => power(2, v_attempts)::int)
     where id = p_id;
  end if;
end $$;

-- Provider webhook (delivery receipts). Status only moves forward.
create or replace function public.apply_provider_status(
  p_provider_message_id text, p_status text, p_at timestamptz default now(), p_error text default null
) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_rank int; v_cur text;
begin
  select status into v_cur from public.notification_deliveries where provider_message_id = p_provider_message_id for update;
  if not found then return false; end if;
  v_rank := array_position(array['sending','sent','delivered','read'], v_cur);
  if p_status = 'failed' then
    if v_cur in ('sending','sent') then
      update public.notification_deliveries set status = 'failed', failed_at = p_at, last_error = p_error
       where provider_message_id = p_provider_message_id;
    end if;
  elsif array_position(array['sending','sent','delivered','read'], p_status) > coalesce(v_rank, 0) then
    update public.notification_deliveries
       set status = p_status,
           sent_at = coalesce(sent_at, p_at),
           delivered_at = case when p_status in ('delivered','read') then coalesce(delivered_at, p_at) else delivered_at end,
           read_at = case when p_status = 'read' then p_at else read_at end
     where provider_message_id = p_provider_message_id;
  end if;
  return true;
end $$;

-- ---- member / staff API --------------------------------------------------------
create or replace function public.my_notifications(p_since timestamptz default null, p_limit int default 50)
returns table (id bigint, type text, title text, body text, grievance_id uuid, data jsonb, read_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select n.id, n.type, n.title, n.body, n.grievance_id, n.data, n.read_at, n.created_at
  from public.notifications n
  where n.user_id = auth.uid() and (p_since is null or n.created_at > p_since)
  order by n.created_at desc
  limit least(greatest(p_limit, 1), 200)
$$;

create or replace function public.mark_notifications_read(p_ids bigint[] default null) returns int
language sql security definer set search_path = public, pg_temp as $$
  with u as (
    update public.notifications set read_at = now()
    where user_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids))
    returning 1)
  select count(*)::int from u
$$;
