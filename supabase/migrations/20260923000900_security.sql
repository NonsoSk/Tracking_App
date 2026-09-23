-- =============================================================================
-- Security: Row Level Security and privileges for every table and function.
--
-- Model:
--   * Start from nothing: revoke all table privileges and function EXECUTE
--     from anon/authenticated, then grant back exactly what each needs.
--   * Grievance data is only ever WRITTEN through SECURITY DEFINER functions.
--   * Staff READ grievances directly (filtered by RLS below); community members
--     read only through my_grievances()/my_grievance_detail(), which return
--     public fields only.
--   * Helpers are wrapped as (select app.fn()) so they run once per query.
-- =============================================================================

do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

-- ---- master data: readable by everyone (sign-up needs the community list) ----------
do $$
declare t text;
begin
  foreach t in array array['community_types','clusters','communities','community_affiliations','community_aliases',
                           'grievance_categories','grievance_subcategories','grievance_statuses',
                           'grievance_status_transitions','severities','holidays']
  loop
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant insert, update, delete on public.%I to authenticated', t);
    execute format('create policy %1$s_read on public.%1$s for select to anon, authenticated using (true)', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated
                    with check ((select app.has_perm(''masterdata.manage'')))', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated
                    using ((select app.has_perm(''masterdata.manage''))) with check ((select app.has_perm(''masterdata.manage'')))', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated
                    using ((select app.has_perm(''masterdata.manage'')))', t);
  end loop;
end $$;

grant select on public.master_data_version to anon, authenticated;
create policy master_data_version_read on public.master_data_version for select to anon, authenticated using (true);

-- ---- settings ------------------------------------------------------------------------
grant select on public.settings to anon, authenticated;
grant update on public.settings to authenticated;
create policy settings_read on public.settings for select to anon, authenticated
  using (is_public or (select app.has_perm('dashboard.view')) or (select app.has_perm('settings.manage')));
create policy settings_update on public.settings for update to authenticated
  using ((select app.has_perm('settings.manage'))) with check ((select app.has_perm('settings.manage')));

-- ---- RBAC ----------------------------------------------------------------------------
grant select on public.roles, public.permissions, public.role_permissions to authenticated;
grant insert, delete on public.role_permissions to authenticated;
create policy roles_read on public.roles for select to authenticated using (true);
create policy permissions_read on public.permissions for select to authenticated using (true);
create policy role_permissions_read on public.role_permissions for select to authenticated using (true);
-- Permission bundles are configurable, by Super Admins only (super_admin itself is implicit).
create policy role_permissions_insert on public.role_permissions for insert to authenticated
  with check ((select app.is_super_admin()));
create policy role_permissions_delete on public.role_permissions for delete to authenticated
  using ((select app.is_super_admin()));
create trigger role_permissions_audit after insert or update or delete on public.role_permissions
  for each row execute function app.audit_row();

grant select on public.profiles, public.user_roles, public.officer_scopes to authenticated;
create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select app.has_perm('users.manage')));
create policy user_roles_read on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or (select app.has_perm('users.manage')));
create policy officer_scopes_read on public.officer_scopes for select to authenticated
  using (officer_id = (select auth.uid()) or (select app.has_perm('users.manage'))
         or (select app.has_perm('grievance.assign')));

-- ---- grievances ----------------------------------------------------------------------
grant execute on function app.in_officer_scope(uuid, uuid, smallint, smallint) to authenticated;
grant select on public.grievances to authenticated;
create policy grievances_staff_read on public.grievances for select to authenticated using (
  (archived_at is null or (select app.is_super_admin()))
  and (
        (select app.has_perm('grievance.read.all'))
     or ((select app.has_perm('grievance.read.scope'))
         and (assigned_officer_id = (select auth.uid())
              or app.in_officer_scope((select auth.uid()), community_id, community_type_id, cluster_id)))
     or ((select app.has_perm('grievance.read.entered')) and created_by = (select auth.uid()))
  )
);
-- No INSERT/UPDATE/DELETE policies: writes go through the workflow functions.

do $$
declare t text;
begin
  foreach t in array array['grievance_status_history','grievance_assignments','grievance_comments','grievance_actions',
                           'grievance_resolutions','grievance_acknowledgements','attachments','grievance_flags']
  loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %1$s_read on public.%1$s for select to authenticated
                    using (app.can_read_grievance(grievance_id))', t);
  end loop;
end $$;

grant select on public.grievance_overview to authenticated;

-- ---- submission codes ----------------------------------------------------------------
grant select on public.submission_codes to authenticated;
create policy submission_codes_read on public.submission_codes for select to authenticated
  using ((select app.has_perm('codes.manage')));

-- ---- notifications -------------------------------------------------------------------
grant select on public.notifications to authenticated;
create policy notifications_read_own on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
grant select on public.notification_deliveries to authenticated;
create policy notification_deliveries_read on public.notification_deliveries for select to authenticated
  using ((select app.has_perm('notifications.manage')));

-- ---- audit & import --------------------------------------------------------------------
grant select on public.audit_logs to authenticated;
create policy audit_logs_read on public.audit_logs for select to authenticated
  using ((select app.has_perm('audit.view')));

grant select on public.import_batches, public.legacy_source_records, public.legacy_value_mappings to authenticated;
grant insert, update on public.legacy_value_mappings to authenticated;
create policy import_batches_read on public.import_batches for select to authenticated
  using ((select app.has_perm('import.run')));
-- Staff who can read a grievance can see its original Excel row(s).
create policy legacy_source_records_read on public.legacy_source_records for select to authenticated
  using ((select app.has_perm('import.run')) or (grievance_id is not null and app.can_read_grievance(grievance_id)));
create policy legacy_value_mappings_read on public.legacy_value_mappings for select to authenticated
  using ((select app.has_perm('import.run')));
create policy legacy_value_mappings_write on public.legacy_value_mappings for insert to authenticated
  with check ((select app.has_perm('import.run')));
create policy legacy_value_mappings_update on public.legacy_value_mappings for update to authenticated
  using ((select app.has_perm('import.run'))) with check ((select app.has_perm('import.run')));

-- tracking_counters: no access at all outside SECURITY DEFINER code.

-- ---- API functions ---------------------------------------------------------------------
grant execute on function
  public.my_access(), public.my_profile(), public.update_my_profile(jsonb),
  public.get_submission_status(uuid), public.submit_grievance(jsonb), public.submit_grievance_assisted(jsonb),
  public.create_submission_code(jsonb), public.release_submission_code(uuid), public.deactivate_submission_code(uuid, text),
  public.my_notifications(timestamptz, int), public.mark_notifications_read(bigint[]),
  public.assign_grievance(uuid, uuid, text), public.change_grievance_status(uuid, text, text, boolean),
  public.add_grievance_comment(uuid, text, text), public.add_grievance_action(uuid, text, text, date),
  public.update_grievance_triage(uuid, jsonb), public.resolve_grievance(uuid, text, text),
  public.request_acknowledgement(uuid), public.acknowledge_resolution(uuid, text, text),
  public.record_acknowledgement(uuid, text, text, text), public.amend_grievance_text(uuid, text, text, text),
  public.request_grievance_archive(uuid, text), public.archive_grievance(uuid, text), public.restore_grievance(uuid),
  public.hard_delete_grievance(uuid, text),
  public.my_grievances(timestamptz), public.my_grievance_detail(uuid), public.find_my_grievance(text),
  public.admin_set_user_roles(uuid, text[]), public.admin_set_user_active(uuid, boolean),
  public.admin_update_profile(uuid, jsonb), public.admin_set_officer_scopes(uuid, jsonb), public.list_staff()
to authenticated;

-- Notification dispatcher: server-side only.
grant execute on function
  public.claim_notification_deliveries(text, int), public.report_notification_delivery(bigint, boolean, text, text, boolean),
  public.apply_provider_status(text, text, timestamptz, text)
to service_role;
