// Create a staff account (Auth admin API needs the service role, so it lives here).
import { adminClient, callerClient, cors, json, requirePermission } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const caller = callerClient(req);
  if (!(await requirePermission(caller, 'users.manage'))) return json({ error: 'not_allowed' }, 403);
  const b = await req.json();
  if (!b.email?.includes('@') || !b.full_name || typeof b.password !== 'string' || b.password.length < 10 || !Array.isArray(b.roles)) {
    return json({ error: 'invalid_request' }, 400);
  }
  const { data, error } = await adminClient().auth.admin.createUser({
    email: String(b.email).toLowerCase(), password: b.password, email_confirm: true, user_metadata: { full_name: b.full_name },
  });
  if (error) return json({ error: /already/i.test(error.message) ? 'account_exists' : error.message }, 400);
  // Roles are set as the caller, so the database checks the grant and audits it.
  const r = await caller.rpc('admin_set_user_roles', { p_user: data.user.id, p_roles: b.roles });
  if (r.error) return json({ error: r.error.message }, 400);
  if (b.job_title) await caller.rpc('admin_update_profile', { p_user: data.user.id, p: { job_title: b.job_title } });
  return json({ id: data.user.id });
});
