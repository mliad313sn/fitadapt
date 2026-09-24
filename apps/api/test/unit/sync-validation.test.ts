import { randomUUID } from 'node:crypto';
import { SYNC_COLLECTIONS } from '@fitadapt/sync';
import { describe, expect, it } from 'vitest';
import { profileSyncValidator, VALIDATED_COLLECTIONS, type ProfileSyncDeps } from '../../src/profile/sync-hooks.js';
import type { PgServerTx } from '../../src/sync/pg-store.js';

/** API-12 / PKG-06: server-side sync validation fails closed. */
describe('sync validation covers every collection and fails closed', () => {
  it('every registered sync collection has a validator', () => {
    expect([...VALIDATED_COLLECTIONS].sort()).toEqual(Object.keys(SYNC_COLLECTIONS).sort());
  });

  it('a collection without a validator is refused, not stored unchecked', async () => {
    // No dependency is touched on this path: the refusal comes before any read.
    const validate = profileSyncValidator({ now: () => new Date() } as unknown as ProfileSyncDeps);
    const m = { mutationId: randomUUID(), collection: 'future_collection', recordId: randomUUID(), op: 'insert' as const, baseRevision: null, data: { anything: 'goes' }, clientCreatedAt: new Date().toISOString() };
    expect(await validate(randomUUID(), m, {} as PgServerTx)).toBe('sync.collection_not_validated');
    // Set logs and preferences are schema-checked (no free text, no unknown field).
    expect(await validate(randomUUID(), { ...m, collection: 'set_logs', data: { exercise: 'push_up', reps: 12, note: 'free text' } }, {} as PgServerTx)).toBe('set_log.invalid');
    expect(await validate(randomUUID(), { ...m, collection: 'preferences', data: { units: 'metric', note: 'free text' } }, {} as PgServerTx)).toBe('preferences.invalid');
    expect(await validate(randomUUID(), { ...m, collection: 'preferences', data: { units: 'imperial', gym: true, locale: 'fr', displayName: 'Awa' } }, {} as PgServerTx)).toBeNull();
  });
});
