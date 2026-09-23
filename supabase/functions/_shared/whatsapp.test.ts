import { describe, expect, it } from 'vitest';
import { buildTemplateMessage, cleanParam, interpretSendResponse, parseStatusWebhook, verifySignature } from './whatsapp';
import { createHmac } from 'node:crypto';

describe('WhatsApp (Meta Cloud API) helpers', () => {
  it('builds a template message with sanitised parameters', () => {
    const m = buildTemplateMessage({ id: 1, recipient: '+2348031234567', template_name: 'grievance_resolved',
      template_params: ['Emmanuel', 'IPL-GRV-2026-000123', 'Line one\nline two\t with     spaces'] });
    expect(m.to).toBe('2348031234567');
    expect(m.template.name).toBe('grievance_resolved');
    expect(m.template.components[0].parameters.map((p) => p.text)).toEqual(['Emmanuel', 'IPL-GRV-2026-000123', 'Line one line two with   spaces']);
  });
  it('truncates long parameters and never sends empty ones', () => {
    expect(cleanParam('x'.repeat(700)).length).toBe(600);
    expect(cleanParam('')).toBe('-');
  });
  it('accepted is "sent", with the provider message id', () => {
    expect(interpretSendResponse(200, { messages: [{ id: 'wamid.ABC' }] })).toEqual({ ok: true, messageId: 'wamid.ABC' });
  });
  it('classifies permanent vs retryable failures', () => {
    expect(interpretSendResponse(400, { error: { code: 132001, message: 'Template does not exist' } }).permanent).toBe(true);
    expect(interpretSendResponse(429, { error: { code: 130429, message: 'Rate limit hit' } }).permanent).toBe(false);
    expect(interpretSendResponse(503, {}).permanent).toBe(false);
  });
  it('parses delivery receipts', () => {
    const u = parseStatusWebhook({ entry: [{ changes: [{ value: { statuses: [
      { id: 'wamid.A', status: 'delivered', timestamp: '1790000000' },
      { id: 'wamid.B', status: 'failed', timestamp: '1790000001', errors: [{ code: 131026, title: 'Message undeliverable' }] },
    ] } }] }] });
    expect(u).toEqual([
      { messageId: 'wamid.A', status: 'delivered', at: new Date(1790000000000).toISOString(), error: undefined },
      { messageId: 'wamid.B', status: 'failed', at: new Date(1790000001000).toISOString(), error: '131026: Message undeliverable' },
    ]);
  });
  it('verifies the webhook signature', async () => {
    const body = '{"entry":[]}';
    const sig = 'sha256=' + createHmac('sha256', 'app-secret').update(body).digest('hex');
    expect(await verifySignature(body, sig, 'app-secret')).toBe(true);
    expect(await verifySignature(body, sig, 'wrong')).toBe(false);
    expect(await verifySignature(body, null, 'app-secret')).toBe(false);
  });
});
