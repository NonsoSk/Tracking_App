/**
 * Meta WhatsApp Cloud API: pure helpers (no I/O) shared by the Edge Functions
 * and unit-tested with Vitest. Business-initiated messages must use a
 * template approved by Meta; see docs/04-deployment.md for the template texts.
 */
export const GRAPH_VERSION = 'v20.0';

export interface Delivery {
  id: number;
  recipient: string;             // +2348031234567
  template_name: string | null;
  template_params: unknown;      // JSON array of strings
}

/** Template parameters may not contain newlines, tabs or more than 4 spaces in a row, and are length-limited. */
export function cleanParam(v: unknown, max = 600): string {
  const s = String(v ?? '').replace(/ *[\r\n\t]+ */g, ' ').replace(/ {4,}/g, '   ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s || '-';
}

export function buildTemplateMessage(d: Delivery, languageCode = 'en') {
  if (!d.template_name) throw new Error('template_missing');
  const params = Array.isArray(d.template_params) ? d.template_params : [];
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: d.recipient.replace(/^\+/, ''),
    type: 'template',
    template: {
      name: d.template_name,
      language: { code: languageCode },
      components: params.length ? [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: cleanParam(p) })) }] : [],
    },
  };
}

export interface SendOutcome { ok: boolean; messageId?: string; error?: string; permanent?: boolean }

/** Meta error codes that will never succeed on retry (bad number, template missing/paused, bad params, not allowed). */
const PERMANENT_CODES = new Set([100, 131008, 131009, 131021, 131026, 131047, 131051, 132000, 132001, 132005, 132007, 132012, 132015, 132016, 133010]);

export function interpretSendResponse(status: number, body: unknown): SendOutcome {
  const b = body as { messages?: { id: string }[]; error?: { code?: number; message?: string; error_data?: { details?: string } } };
  if (status >= 200 && status < 300 && b?.messages?.[0]?.id) return { ok: true, messageId: b.messages[0].id };
  const code = b?.error?.code;
  const msg = `${code ?? status}: ${b?.error?.message ?? 'send failed'}${b?.error?.error_data?.details ? ` (${b.error.error_data.details})` : ''}`;
  const permanent = (code !== undefined && PERMANENT_CODES.has(code)) || (status >= 400 && status < 500 && status !== 429 && code === undefined);
  return { ok: false, error: msg.slice(0, 500), permanent };
}

export interface StatusUpdate { messageId: string; status: 'sent' | 'delivered' | 'read' | 'failed'; at: string; error?: string }

/** Extract delivery receipts from a webhook payload. */
export function parseStatusWebhook(payload: unknown): StatusUpdate[] {
  const out: StatusUpdate[] = [];
  const p = payload as { entry?: { changes?: { value?: { statuses?: { id: string; status: string; timestamp: string; errors?: { code: number; title?: string; message?: string }[] }[] } }[] }[] };
  for (const e of p?.entry ?? []) for (const c of e.changes ?? []) for (const s of c.value?.statuses ?? []) {
    if (!['sent', 'delivered', 'read', 'failed'].includes(s.status)) continue;
    out.push({
      messageId: s.id, status: s.status as StatusUpdate['status'],
      at: new Date(Number(s.timestamp) * 1000).toISOString(),
      error: s.errors?.map((x) => `${x.code}: ${x.title ?? x.message ?? ''}`).join('; '),
    });
  }
  return out;
}

/** Verify Meta's X-Hub-Signature-256 header (HMAC-SHA256 of the raw body with the app secret). */
export async function verifySignature(rawBody: string, header: string | null, appSecret: string): Promise<boolean> {
  if (!header?.startsWith('sha256=') || !appSecret) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)));
  const expected = Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
  const given = header.slice(7);
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
