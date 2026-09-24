// admin-create-user: create a staff login from the app (Users & officers → Add staff member).
// Self-contained single file so it can be pasted into Supabase Dashboard → Edge Functions →
// "Deploy a new function" → Via editor (name it exactly: admin-create-user).
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    // The caller acts as themselves, so the database checks their permission and audits the change.
    const caller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false },
    });
    const { data: access } = await caller.rpc('my_access');
    const a = access as { roles: string[]; permissions: string[]; is_active: boolean } | null;
    if (!a?.is_active || !(a.roles.includes('super_admin') || a.permissions.includes('users.manage'))) return json({ error: 'not_allowed' }, 403);

    const b = await req.json();
    if (!String(b.email ?? '').includes('@') || !b.full_name || typeof b.password !== 'string' || b.password.length < 10 || !Array.isArray(b.roles)) {
      return json({ error: 'invalid_request' }, 400);
    }
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const { data, error } = await admin.auth.admin.createUser({
      email: String(b.email).trim().toLowerCase(), password: b.password, email_confirm: true, user_metadata: { full_name: b.full_name },
    });
    if (error) return json({ error: /already/i.test(error.message) ? 'account_exists' : error.message }, 400);

    const r = await caller.rpc('admin_set_user_roles', { p_user: data.user.id, p_roles: b.roles });
    if (r.error) return json({ error: r.error.message }, 400);
    await caller.rpc('admin_update_profile', { p_user: data.user.id, p: { full_name: b.full_name, ...(b.job_title ? { job_title: b.job_title } : {}) } });
    return json({ id: data.user.id });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
