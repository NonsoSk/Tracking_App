// Reset a community member's PIN (members have no email/SMS recovery; they ask the office).
// Returns a temporary 6-digit PIN for staff to give the member in person or by phone.
import { adminClient, callerClient, cors, json, requirePermission } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const caller = callerClient(req);
  if (!(await requirePermission(caller, 'users.manage'))) return json({ error: 'not_allowed' }, 403);
  const { user_id } = await req.json();
  const pin = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
  const { error } = await adminClient().auth.admin.updateUserById(user_id, { password: pin });
  if (error) return json({ error: error.message }, 400);
  await caller.rpc('log_pin_reset', { p_user: user_id });
  return json({ pin });
});
