// admin-reset-pin: give a community member a new temporary 6-digit PIN (Users & officers → Manage → Reset PIN).
// Self-contained single file so it can be pasted into Supabase Dashboard → Edge Functions →
// "Deploy a new function" → Via editor (name it exactly: admin-reset-pin).
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
    const caller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false },
    });
    const { data: access } = await caller.rpc('my_access');
    const a = access as { roles: string[]; permissions: string[]; is_active: boolean } | null;
    if (!a?.is_active || !(a.roles.includes('super_admin') || a.permissions.includes('users.manage'))) return json({ error: 'not_allowed' }, 403);

    const { user_id } = await req.json();
    const pin = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const { error } = await admin.auth.admin.updateUserById(user_id, { password: pin });
    if (error) return json({ error: error.message }, 400);
    await caller.rpc('log_pin_reset', { p_user: user_id });
    return json({ pin });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
