-- =============================================================================
-- Operational helpers used by Edge Functions.
-- =============================================================================

-- Audit a PIN reset performed through the admin-reset-pin function (the reset
-- itself happens in Supabase Auth; this records who did it, as the caller).
create or replace function public.log_pin_reset(p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.require_perm('users.manage');
  perform app.log('user.pin_reset', 'profiles', p_user::text);
end $$;
revoke execute on function public.log_pin_reset(uuid) from public, anon;
grant execute on function public.log_pin_reset(uuid) to authenticated;
