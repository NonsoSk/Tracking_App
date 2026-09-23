import { api, type SubmitPayload, type SubmitResult } from '@/lib/api';
import { toAppError } from '@/lib/errors';
import { db, type OutboxItem } from './db';

/**
 * Outbox sync engine.
 *
 * DRAFT -> QUEUED -> SYNCING -> SYNCED
 *                        \-> QUEUED (transient failure, retried with back-off)
 *                        \-> FAILED (permanent: e.g. code expired; kept on device, user decides)
 *
 * Duplicate prevention: the item's localId is sent as client_submission_id on
 * every attempt, and the server returns the original grievance for a retry,
 * so a lost response can never create a second grievance. A Web Lock keeps two
 * open tabs from sending the same item at the same moment.
 */

type Submit = (p: SubmitPayload) => Promise<SubmitResult>;
type Listener = () => void;

const BACKOFF_MS = [5_000, 15_000, 60_000, 180_000, 300_000];
const listeners = new Set<Listener>();
let running = false;

export function onOutboxChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() { listeners.forEach((fn) => fn()); }

export function newLocalId(): string {
  return crypto.randomUUID();
}

export async function saveDraft(item: Omit<OutboxItem, 'state' | 'attempts' | 'nextAttemptAt' | 'updatedAt'>): Promise<void> {
  await db.outbox.put({ ...item, state: 'draft', attempts: 0, nextAttemptAt: 0, updatedAt: new Date().toISOString() });
  emit();
}

/** Mark a draft ready to send. It is safe on the device from this moment. */
export async function enqueue(localId: string): Promise<void> {
  await db.outbox.update(localId, { state: 'queued', nextAttemptAt: 0, lastError: null, updatedAt: new Date().toISOString() });
  emit();
}

async function sendOne(item: OutboxItem, submit: Submit): Promise<void> {
  await db.outbox.update(item.localId, { state: 'syncing', updatedAt: new Date().toISOString() });
  emit();
  try {
    const res = await submit({
      client_submission_id: item.localId,
      client_created_at: item.createdAt,
      submission_code: item.payload.submission_code,
      community_id: item.payload.community_id,
      description: item.payload.description,
      title: item.payload.title ?? null,
      category_id: item.payload.category_id ?? null,
      desired_resolution: item.payload.desired_resolution ?? null,
      suggestions: item.payload.suggestions ?? null,
    });
    await db.outbox.update(item.localId, {
      state: 'synced', serverId: res.id, trackingId: res.tracking_id, syncedAt: res.submitted_at,
      lastError: null, updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    const err = toAppError(e);
    const attempts = item.attempts + 1;
    if (err.permanent) {
      await db.outbox.update(item.localId, { state: 'failed', attempts, lastError: err.key, updatedAt: new Date().toISOString() });
    } else {
      const wait = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
      await db.outbox.update(item.localId, {
        state: 'queued', attempts, lastError: err.key, nextAttemptAt: Date.now() + wait, updatedAt: new Date().toISOString(),
      });
    }
  } finally {
    emit();
  }
}

/**
 * Send everything that is due. Safe to call often (app start, back online,
 * app brought to the foreground, timer). Returns the number of items sent.
 */
export async function syncOutbox(userId: string, opts: { submit?: Submit; force?: boolean } = {}): Promise<number> {
  const submit = opts.submit ?? api.submitGrievance;
  const run = async () => {
    if (running) return 0;
    running = true;
    let sent = 0;
    try {
      // Items stuck in 'syncing' from a closed tab are retried (the server de-duplicates).
      const due = (await db.outbox.where('userId').equals(userId).toArray())
        .filter((i) => i.state === 'queued' || i.state === 'syncing')
        .filter((i) => opts.force || i.nextAttemptAt <= Date.now())
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      for (const item of due) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) break;
        await sendOne(item, submit);
        const after = await db.outbox.get(item.localId);
        if (after?.state === 'synced') sent++;
        if (after?.lastError === 'network') break;   // stop early when the connection is gone
      }
    } finally {
      running = false;
    }
    return sent;
  };
  const locks = (typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined);
  if (locks?.request) return locks.request('ipl-outbox-sync', { ifAvailable: true }, (lock) => (lock ? run() : 0));
  return run();
}

/** A failed item can be edited (e.g. new code) and sent again with the same idempotency key. */
export async function retryItem(localId: string, patch?: Partial<OutboxItem['payload']>): Promise<void> {
  const item = await db.outbox.get(localId);
  if (!item) return;
  await db.outbox.update(localId, {
    state: 'queued', nextAttemptAt: 0, lastError: null,
    payload: { ...item.payload, ...patch }, updatedAt: new Date().toISOString(),
  });
  emit();
}

export async function discardItem(localId: string): Promise<void> {
  await db.outbox.delete(localId);
  emit();
}

export async function pendingItems(userId: string): Promise<OutboxItem[]> {
  return (await db.outbox.where('userId').equals(userId).toArray())
    .filter((i) => i.state !== 'synced' && i.state !== 'draft')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Keep the device tidy: synced items older than a week are removed (the server has them). */
export async function pruneSynced(userId: string, olderThanDays = 7): Promise<void> {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
  const old = (await db.outbox.where('userId').equals(userId).toArray()).filter((i) => i.state === 'synced' && (i.syncedAt ?? i.updatedAt) < cutoff);
  await db.outbox.bulkDelete(old.map((i) => i.localId));
}
