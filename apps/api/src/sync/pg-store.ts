import { PushResultSchema, type Change, type PushResult } from '@fitadapt/shared';
import type { NewChange, ServerStore, ServerTx } from '@fitadapt/sync';
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { lockUser, type Database, type DbTx as Tx } from '../db/client.js';
import { syncChanges, syncHeads, syncMutations } from '../db/schema.js';

/** The sync transaction, with the underlying PostgreSQL transaction for records that must commit with the change (L11). */
export interface PgServerTx extends ServerTx {
  readonly db: Tx;
}

function toChange(row: typeof syncChanges.$inferSelect): Change {
  return {
    revision: row.revision,
    collection: row.collection,
    recordId: row.recordId,
    op: row.op,
    data: (row.data as Change['data']) ?? null,
    originDeviceId: row.originDeviceId,
  };
}

/**
 * What the ledger stores for a result (API-3): never a copy of a record. A
 * conflict keeps only which record it conflicted with; its `current` is read
 * again from sync_changes on a replay, so a record erased there (health
 * consent withdrawn) is not kept, nor exported, through the ledger.
 */
const LedgerEntrySchema = PushResultSchema.omit({ current: true }).extend({
  currentRef: z.object({ collection: z.string(), recordId: z.string() }).optional(),
});
type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

export function ledgerEntry(result: PushResult): LedgerEntry {
  const { current, ...rest } = result;
  return current ? { ...rest, currentRef: { collection: current.collection, recordId: current.recordId } } : rest;
}

async function latestChangeOf(tx: Tx, userId: string, collection: string, recordId: string): Promise<Change | undefined> {
  const [row] = await tx
    .select()
    .from(syncChanges)
    .where(and(eq(syncChanges.userId, userId), eq(syncChanges.collection, collection), eq(syncChanges.recordId, recordId)))
    .orderBy(desc(syncChanges.revision))
    .limit(1);
  return row ? toChange(row) : undefined;
}

function txFor(tx: Tx): PgServerTx {
  return {
    db: tx,
    async findMutationResult(userId, mutationId) {
      const [row] = await tx
        .select({ result: syncMutations.result })
        .from(syncMutations)
        .where(and(eq(syncMutations.userId, userId), eq(syncMutations.mutationId, mutationId)))
        .limit(1);
      if (!row) return undefined;
      const { currentRef, ...result } = LedgerEntrySchema.parse(row.result);
      if (!currentRef) return result;
      // A replayed conflict answers with the record's state now (erased data stays erased).
      const current = await latestChangeOf(tx, userId, currentRef.collection, currentRef.recordId);
      return current ? { ...result, current } : result;
    },
    async saveMutationResult(userId, result: PushResult) {
      await tx.insert(syncMutations).values({ userId, mutationId: result.mutationId, result: ledgerEntry(result) });
    },
    latestChange: (userId, collection, recordId) => latestChangeOf(tx, userId, collection, recordId),
    async appendChange(userId, change: NewChange) {
      const [head] = await tx
        .insert(syncHeads)
        .values({ userId, revision: 1 })
        .onConflictDoUpdate({ target: syncHeads.userId, set: { revision: sql`${syncHeads.revision} + 1` } })
        .returning({ revision: syncHeads.revision });
      const revision = head!.revision;
      const [row] = await tx
        .insert(syncChanges)
        .values({ userId, revision, ...change })
        .returning();
      return toChange(row!);
    },
  };
}

/**
 * PostgreSQL ServerStore. A per-user transaction-scoped advisory lock
 * serialises pushes, so revisions are gap-free and committed in order and a
 * pull can never skip a change that commits later with a lower revision.
 */
export class PgServerStore implements ServerStore<PgServerTx> {
  constructor(private readonly db: Database) {}

  transaction<T>(userId: string, fn: (tx: PgServerTx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await lockUser(tx, userId);
      return fn(txFor(tx));
    });
  }

  async listChanges(userId: string, since: number, limit: number): Promise<Change[]> {
    const rows = await this.db
      .select()
      .from(syncChanges)
      .where(and(eq(syncChanges.userId, userId), gt(syncChanges.revision, since)))
      .orderBy(asc(syncChanges.revision))
      .limit(limit);
    return rows.map(toChange);
  }
}
