// Resolve the caller from their JWT and check a permission *as the caller*,
// so the database's own rules decide (and the audit log records who acted).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export function callerClient(req: Request): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false },
  });
}

export const adminClient = () =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

export async function requirePermission(caller: SupabaseClient, perm: string): Promise<boolean> {
  const { data } = await caller.rpc('my_access');
  const a = data as { roles: string[]; permissions: string[]; is_active: boolean } | null;
  return !!a?.is_active && (a.roles.includes('super_admin') || a.permissions.includes(perm));
}

export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });
