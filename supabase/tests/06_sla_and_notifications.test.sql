-- Working-day SLA clock, overdue alerts, and honest notification delivery states.
begin;
set search_path = public, extensions, tests;
select plan(20);

-- ---- working-day clock (3 working days, Africa/Lagos) -------------------------------------
-- 2026-09-25 is a Friday.
select is(app.sla_due_at('2026-09-25 10:00+01'), '2026-09-30 10:00+01'::timestamptz,
  'Friday 10:00 + 3 working days = Wednesday 10:00 (weekend skipped)');
select is(app.sla_due_at('2026-09-26 15:00+01'), '2026-10-01 00:00+01'::timestamptz,
  'a Saturday submission starts the clock on Monday 00:00');
insert into public.holidays values ('2026-10-01', 'Independence Day');
select is(app.sla_due_at('2026-09-29 10:00+01'), '2026-10-05 10:00+01'::timestamptz,
  'public holidays are skipped (Tue -> Mon over Independence Day and the weekend)');
select is(app.days_outstanding('2026-09-25 10:00+01', '2026-09-30 12:00+01'), 3,
  'days outstanding counts working days only');
update public.settings set value = '"calendar_days"' where key = 'sla_clock';
select is(app.sla_due_at('2026-09-25 10:00+01'), '2026-09-28 10:00+01'::timestamptz, 'clock is configurable: calendar days');
update public.settings set value = '"working_days"' where key = 'sla_clock';
update public.settings set value = '5' where key = 'sla_threshold_days';
select is(app.sla_due_at('2026-09-25 10:00+01'), '2026-10-05 10:00+01'::timestamptz,
  'threshold is configurable (5 working days, holiday skipped)');
update public.settings set value = '3' where key = 'sla_threshold_days';

-- ---- overdue scan ----------------------------------------------------------------------------
create temp table ids (k text primary key, v uuid);
insert into ids values ('officer', tests.create_user('Godpower Jaka', null, array['officer'])),
                       ('admin',   tests.create_user('Super Admin', null, array['super_admin']));
select tests.set_scopes((select v from ids where k = 'officer'), '[{"community_type":"HOST"}]');

create temp table g as
select 'fresh' as k, (app.create_grievance(jsonb_build_object('community_id', tests.community('Aleto'),
         'description', 'Fresh grievance, still within time'), 'paper', null, null)).id
union all
select 'late', (app.create_grievance(jsonb_build_object('community_id', tests.community('Aleto'),
         'description', 'Old grievance that nobody resolved'), 'paper', null, null)).id
union all
select 'legacy', (app.create_grievance(jsonb_build_object('community_id', tests.community('Aleto'),
         'description', 'Imported WIP item from 2021'), 'paper', null, null)).id;
grant select on g to authenticated;
update public.grievances set sla_started_at = now() - interval '14 days' where id in (select id from g where k in ('late','legacy'));
update public.grievances set legacy_needs_review = true where id = (select id from g where k = 'legacy');

select is(app.scan_overdue(), 1, 'overdue scan flags exactly the late grievance (legacy item awaiting review is excluded)');
select is((select count(*)::int from public.notifications where type = 'grievance_overdue'
             and user_id = (select v from ids where k = 'officer')), 1, 'the responsible officer receives an overdue alert');
select ok((select body like 'Grievance IPL-GRV-%unresolved for % working days. Community: Aleto.%' from public.notifications
           where type = 'grievance_overdue'), 'alert says which grievance, how long, and where');
select is(app.scan_overdue(), 0, 'no repeat alert within the re-alert interval');
update public.grievances set last_overdue_alert_at = now() - interval '25 hours' where id = (select id from g where k = 'late');
select is(app.scan_overdue(), 1, 'the officer is reminded again after 24 hours');

select tests.login((select v from ids where k = 'admin'));
select is((select count(*)::int from public.grievance_overview where is_overdue), 1, 'dashboard overdue count');
select ok((select days_outstanding >= 9 from public.grievance_overview where id = (select id from g where k = 'late')),
  'days outstanding shown in working days');
select tests.logout();

-- ---- notification delivery honesty ----------------------------------------------------------
select app.notify(null, 'grievance_resolved', 't', 'b', null, '{}', '08031234567', 'grievance_resolved', '[]') as n1 \gset
select is((select status || '/' || last_error from public.notification_deliveries where notification_id = :n1),
  'skipped/whatsapp_disabled', 'with WhatsApp switched off the message is recorded as skipped, not sent');

update public.settings set value = 'true' where key = 'whatsapp_enabled';
select app.notify(null, 'grievance_resolved', 't', 'b', null, '{}', '0803 123 4567', 'grievance_resolved', '[]') as n2 \gset
select is((select status from public.notification_deliveries where notification_id = :n2), 'queued', 'queued for the dispatcher');

set local role service_role;
select is((select count(*)::int from public.claim_notification_deliveries('whatsapp', 10)), 1, 'dispatcher claims the queued message');
select public.report_notification_delivery((select id from public.notification_deliveries where notification_id = :n2),
                                           true, 'wamid.TEST1');
select is((select status from public.notification_deliveries where notification_id = :n2), 'sent',
  'provider accepted the message: "sent", not "delivered"');
select public.apply_provider_status('wamid.TEST1', 'delivered');
select public.apply_provider_status('wamid.TEST1', 'sent');
select is((select status from public.notification_deliveries where notification_id = :n2), 'delivered',
  'delivered only when the provider confirms it; states never move backwards');
reset role;

select app.notify(null, 'grievance_resolved', 't', 'b', null, '{}', '08031234567', 'grievance_resolved', '[]') as n3 \gset
set local role service_role;
select count(*) from public.claim_notification_deliveries('whatsapp', 10);
select public.report_notification_delivery((select id from public.notification_deliveries where notification_id = :n3),
                                           false, null, 'network timeout');
select is((select status from public.notification_deliveries where notification_id = :n3), 'queued',
  'a failed attempt is queued again with back-off (e.g. provider unreachable)');
reset role;
select ok((select next_attempt_at > now() from public.notification_deliveries where notification_id = :n3), 'retry is scheduled later');

select * from finish();
rollback;
