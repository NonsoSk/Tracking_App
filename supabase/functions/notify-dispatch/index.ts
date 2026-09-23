// Sends queued notification deliveries (WhatsApp via Meta Cloud API).
// Invoke every minute (pg_cron + pg_net, or Supabase scheduled functions)
// with header  x-dispatch-secret: $DISPATCH_SECRET.
// A message is marked 'sent' when Meta accepts it; 'delivered'/'read' only
// arrive later through whatsapp-webhook.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { GRAPH_VERSION, buildTemplateMessage, interpretSendResponse, type Delivery } from '../_shared/whatsapp.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

Deno.serve(async (req) => {
  if (req.headers.get('x-dispatch-secret') !== Deno.env.get('DISPATCH_SECRET')) return new Response('forbidden', { status: 403 });
  const token = Deno.env.get('WHATSAPP_TOKEN');
  const phoneId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
  if (!token || !phoneId) return Response.json({ skipped: 'whatsapp not configured' });

  const { data, error } = await admin.rpc('claim_notification_deliveries', { p_channel: 'whatsapp', p_limit: 25 });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const results = { sent: 0, failed: 0 };
  for (const d of (data ?? []) as Delivery[]) {
    let outcome;
    try {
      const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(buildTemplateMessage(d, Deno.env.get('WHATSAPP_TEMPLATE_LANG') ?? 'en')),
      });
      outcome = interpretSendResponse(res.status, await res.json().catch(() => ({})));
    } catch (e) {
      outcome = { ok: false, error: `network: ${(e as Error).message}`, permanent: false };   // retried with back-off
    }
    await admin.rpc('report_notification_delivery', {
      p_id: d.id, p_ok: outcome.ok, p_provider_message_id: outcome.messageId ?? null,
      p_error: outcome.error ?? null, p_permanent: outcome.permanent ?? false,
    });
    outcome.ok ? results.sent++ : results.failed++;
  }
  return Response.json(results);
});
