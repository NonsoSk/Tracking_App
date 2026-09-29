// phone-otp: sends and checks the 6-digit text-message code a community member
// must enter before their registration can finish. Codes are made, limited and
// checked in the database (otp_request / otp_verify); this function only sends
// the text, so the SMS provider's key never reaches the app.
//
// Deploy: Supabase → Edge Functions → Deploy a new function → Via editor,
// name it exactly  phone-otp , paste this file, Deploy. Then open the function's
// Details and switch OFF "Enforce JWT verification" (people are not signed in yet).
//
// Secrets (Edge Functions → Secrets), for ONE provider:
//   Termii (Nigeria):  TERMII_API_KEY, TERMII_SENDER_ID  (optional TERMII_BASE_URL, e.g. https://v3.api.termii.com)
//   Twilio:            SMS_PROVIDER=twilio, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });
const env = (k: string) => Deno.env.get(k)?.trim() || '';

const KNOWN = ['phone_invalid', 'account_exists', 'otp_too_soon', 'otp_limit'];

async function sendSms(to: string, text: string): Promise<'sent' | 'not_configured' | 'failed'> {
  const provider = env('SMS_PROVIDER').toLowerCase() || (env('TERMII_API_KEY') ? 'termii' : env('TWILIO_ACCOUNT_SID') ? 'twilio' : '');
  try {
    if (provider === 'termii') {
      if (!env('TERMII_API_KEY') || !env('TERMII_SENDER_ID')) return 'not_configured';
      const r = await fetch(`${env('TERMII_BASE_URL') || 'https://api.ng.termii.com'}/api/sms/send`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // "dnd" route: delivers to numbers on the Do-Not-Disturb list too (needed for codes in Nigeria).
        body: JSON.stringify({ api_key: env('TERMII_API_KEY'), from: env('TERMII_SENDER_ID'), to: to.replace('+', ''),
          sms: text, type: 'plain', channel: 'dnd' }),
      });
      if (!r.ok) console.error('termii', r.status, await r.text());
      return r.ok ? 'sent' : 'failed';
    }
    if (provider === 'twilio') {
      const sid = env('TWILIO_ACCOUNT_SID');
      if (!sid || !env('TWILIO_AUTH_TOKEN') || !env('TWILIO_FROM')) return 'not_configured';
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: `Basic ${btoa(`${sid}:${env('TWILIO_AUTH_TOKEN')}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: to, From: env('TWILIO_FROM'), Body: text }),
      });
      if (!r.ok) console.error('twilio', r.status, await r.text());
      return r.ok ? 'sent' : 'failed';
    }
    return 'not_configured';
  } catch (e) {
    console.error('sms', e);
    return 'failed';
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const body = await req.json().catch(() => ({}));
  const phone = typeof body.phone === 'string' ? body.phone : '';

  if (body.action === 'send') {
    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || null;
    const { data, error } = await db.rpc('otp_request', { p_phone: phone, p_ip: ip });
    if (error) {
      const key = KNOWN.find((k) => error.message.includes(k));
      if (!key) console.error('otp_request', error.message);
      return json({ error: key ?? 'otp_failed' }, key ? 400 : 500);
    }
    const { phone: to, code } = data as { phone: string; code: string };
    const sent = await sendSms(to, `${code} is your Indorama Grievance Portal code. It expires in 10 minutes. Do not share it with anyone.`);
    if (sent !== 'sent') {
      await db.rpc('otp_discard', { p_phone: to });
      return json({ error: sent === 'not_configured' ? 'sms_not_configured' : 'sms_failed' }, 503);
    }
    return json({ sent: true, phone: to });
  }

  if (body.action === 'verify') {
    const code = typeof body.code === 'string' ? body.code : '';
    const { data, error } = await db.rpc('otp_verify', { p_phone: phone, p_code: code });
    if (error) { console.error('otp_verify', error.message); return json({ error: 'otp_failed' }, 500); }
    return json(data);
  }

  return json({ error: 'action_invalid' }, 400);
});
