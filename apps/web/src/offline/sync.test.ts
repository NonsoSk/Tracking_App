import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';
import type { SubmitPayload, SubmitResult } from '@/lib/api';
import { db } from './db';
import { enqueue, pendingItems, retryItem, saveDraft, syncOutbox } from './sync';

const USER = 'user-1';

/** A fake server that behaves like submit_grievance: idempotent on client_submission_id. */
function fakeServer() {
  const store = new Map<string, SubmitResult>();
  let seq = 0;
  const calls: SubmitPayload[] = [];
  return {
    store, calls,
    submit: async (p: SubmitPayload): Promise<SubmitResult> => {
      calls.push(p);
      const existing = store.get(p.client_submission_id);
      if (existing) return { ...existing, result: 'already_submitted' };
      const r: SubmitResult = { id: `g${++seq}`, tracking_id: `IPL-GRV-2026-${String(seq).padStart(6, '0')}`, submitted_at: new Date().toISOString(), result: 'created' };
      store.set(p.client_submission_id, r);
      return r;
    },
  };
}

async function queueOne(localId: string) {
  await saveDraft({
    localId, userId: USER, createdAt: new Date().toISOString(),
    payload: { submission_code: 'AGB-2026-0923-X7P4', community_id: 'c1', community_name: 'Agbonchia', description: 'The road is flooded again' },
  });
  await enqueue(localId);
}

beforeEach(async () => { await db.outbox.clear(); });

describe('outbox sync', () => {
  it('sends a queued grievance and records the tracking ID', async () => {
    const server = fakeServer();
    await queueOne('a');
    expect(await syncOutbox(USER, { submit: server.submit })).toBe(1);
    const item = await db.outbox.get('a');
    expect(item?.state).toBe('synced');
    expect(item?.trackingId).toBe('IPL-GRV-2026-000001');
    expect(server.calls[0].client_submission_id).toBe('a');
  });

  it('keeps the grievance on the device when offline, then sends it later', async () => {
    const server = fakeServer();
    await queueOne('b');
    const offline = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await syncOutbox(USER, { submit: offline });
    let item = await db.outbox.get('b');
    expect(item?.state).toBe('queued');
    expect(item?.lastError).toBe('network');
    expect(item?.trackingId).toBeUndefined();                // never pretends it was submitted
    expect(item!.nextAttemptAt).toBeGreaterThan(Date.now());  // back-off scheduled

    await syncOutbox(USER, { submit: server.submit, force: true });
    item = await db.outbox.get('b');
    expect(item?.state).toBe('synced');
  });

  it('a lost response cannot create a duplicate grievance', async () => {
    const server = fakeServer();
    await queueOne('c');
    // The server stores the grievance, but the reply never reaches the phone.
    const lostReply = async (p: SubmitPayload) => { await server.submit(p); throw new TypeError('Failed to fetch'); };
    await syncOutbox(USER, { submit: lostReply });
    await syncOutbox(USER, { submit: server.submit, force: true });
    expect(server.store.size).toBe(1);
    expect((await db.outbox.get('c'))?.trackingId).toBe('IPL-GRV-2026-000001');
  });

  it('a permanent error (expired code) stops retrying and keeps the text; a new code can be used', async () => {
    const server = fakeServer();
    await queueOne('d');
    await syncOutbox(USER, { submit: vi.fn().mockRejectedValue(new AppError('code_expired')) });
    expect((await db.outbox.get('d'))?.state).toBe('failed');
    expect((await pendingItems(USER)).map((i) => i.localId)).toEqual(['d']);

    await retryItem('d', { submission_code: 'AGB-2026-1001-K3M9' });
    await syncOutbox(USER, { submit: server.submit });
    const item = await db.outbox.get('d');
    expect(item?.state).toBe('synced');
    expect(server.calls.at(-1)?.submission_code).toBe('AGB-2026-1001-K3M9');
    expect(server.calls.at(-1)?.client_submission_id).toBe('d');   // same idempotency key
  });

  it('concurrent sync calls send each item once', async () => {
    const server = fakeServer();
    await queueOne('e');
    await queueOne('f');
    await Promise.all([syncOutbox(USER, { submit: server.submit }), syncOutbox(USER, { submit: server.submit })]);
    expect(server.calls).toHaveLength(2);
    expect(server.store.size).toBe(2);
  });

  it('drafts are not sent until the user submits them', async () => {
    const server = fakeServer();
    await saveDraft({ localId: 'g', userId: USER, createdAt: new Date().toISOString(),
      payload: { submission_code: '', community_id: 'c1', community_name: 'Agbonchia', description: 'half written' } });
    expect(await syncOutbox(USER, { submit: server.submit })).toBe(0);
    expect(server.calls).toHaveLength(0);
  });
});
