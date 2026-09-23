import Dexie, { type Table } from 'dexie';

/**
 * On-device storage (IndexedDB). Grievances written offline live here until
 * the server confirms them; nothing here is ever presented as "submitted"
 * until the server has returned a tracking ID.
 */
export type OutboxState = 'draft' | 'queued' | 'syncing' | 'synced' | 'failed';

export interface OutboxItem {
  localId: string;               // also the idempotency key sent to the server
  userId: string;
  state: OutboxState;
  payload: {
    submission_code: string;
    community_id: string;
    community_name: string;
    description: string;
    title?: string | null;
    category_id?: number | null;
    category_label?: string | null;
    desired_resolution?: string | null;
    suggestions?: string | null;
  };
  createdAt: string;             // when the user wrote it (sent as client_created_at)
  updatedAt: string;
  attempts: number;
  nextAttemptAt: number;         // epoch ms
  lastError?: string | null;     // AppError key
  serverId?: string | null;
  trackingId?: string | null;
  syncedAt?: string | null;
}

export interface CacheEntry<T = unknown> { key: string; value: T; updatedAt: string }

class LocalDB extends Dexie {
  outbox!: Table<OutboxItem, string>;
  cache!: Table<CacheEntry, string>;
  constructor() {
    super('ipl-grievance');
    this.version(1).stores({
      outbox: 'localId, userId, state, nextAttemptAt',
      cache: 'key',
    });
  }
}

export const db = new LocalDB();

export async function cacheGet<T>(key: string): Promise<CacheEntry<T> | undefined> {
  try { return (await db.cache.get(key)) as CacheEntry<T> | undefined; } catch { return undefined; }
}

export async function cachePut<T>(key: string, value: T): Promise<void> {
  try { await db.cache.put({ key, value, updatedAt: new Date().toISOString() }); } catch { /* storage full or blocked: app still works online */ }
}

/** Remove everything personal from this device (sign-out on a shared phone). */
export async function clearUserData(userId: string): Promise<void> {
  await db.transaction('rw', db.outbox, db.cache, async () => {
    await db.outbox.where('userId').equals(userId).delete();
    await db.cache.clear();
  });
}
