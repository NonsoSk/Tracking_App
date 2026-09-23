-- Structural security guarantees: RLS everywhere, no direct writes, no anonymous access.
begin;
set search_path = public, extensions, tests;
select plan(12);

select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity), 0,
  'every public table has row level security enabled');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'anon'
      and table_name in ('grievances','profiles','notifications','audit_logs','submission_codes')), 0,
  'anon has no privileges on personal or grievance tables');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'authenticated' and table_name = 'grievances'
      and privilege_type in ('INSERT','UPDATE','DELETE')), 0,
  'no one can write grievances directly (functions only)');

select ok(not has_function_privilege('anon', 'public.submit_grievance(jsonb)', 'execute'),
  'anon cannot call submit_grievance');
select ok(not has_function_privilege('authenticated', 'public.claim_notification_deliveries(text,int)', 'execute'),
  'users cannot drive the notification dispatcher');
select ok(not has_function_privilege('authenticated', 'app.bootstrap_super_admin(text)', 'execute'),
  'bootstrap_super_admin is not callable through the API');

-- Anonymous visitor: can read the community list (for sign-up) and nothing personal.
select tests.login_anon();
select is((select count(*)::int from public.communities), 48, 'anon can read the community list (48 communities; Akpajo counted once)');
select throws_ok('select * from public.grievances', '42501', null, 'anon cannot read grievances');
select tests.logout();

-- A community member cannot write around the workflow.
select tests.login(tests.create_user('Member One', 'Agbonchia'));
select throws_ok(
  $$insert into public.grievances (tracking_id, origin, date_received, description, status_id, community_id)
    values ('X', 'app', current_date, 'sneaky insert', 1, tests.community('Agbonchia'))$$,
  '42501', null, 'members cannot insert grievances directly');
update public.communities set name = 'Hacked' where name = 'Ogu';
select is_empty($$select 1 from public.audit_logs$$, 'members see nothing in the audit log');
select tests.logout();
select ok(exists (select 1 from public.communities where name = 'Ogu'), 'members cannot edit master data (update matched no rows)');

select throws_ok($$update public.audit_logs set action = 'x'$$, '42501', 'append_only',
  'audit log is append-only even for the database owner');

select * from finish();
rollback;
