// Meta webhook: verification handshake (GET) and delivery receipts (POST).
// Deploy with --no-verify-jwt (Meta can't send a Supabase JWT); requests are
// authenticated with the X-Hub-Signature-256 HMAC instead.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { parseStatusWebhook, verifySignature } from '../_shared/whatsapp.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === 'GET') {
    const ok = url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === Deno.env.get('WHATSAPP_VERIFY_TOKEN');
    return ok ? new Response(url.searchParams.get('hub.challenge') ?? '') : new Response('forbidden', { status: 403 });
  }
  const raw = await req.text();
  if (!(await verifySignature(raw, req.headers.get('x-hub-signature-256'), Deno.env.get('WHATSAPP_APP_SECRET') ?? ''))) {
    return new Response('bad signature', { status: 401 });
  }
  for (const u of parseStatusWebhook(JSON.parse(raw))) {
    await admin.rpc('apply_provider_status', { p_provider_message_id: u.messageId, p_status: u.status, p_at: u.at, p_error: u.error ?? null });
  }
  return new Response('ok');   // always 200 quickly, or Meta retries
});
