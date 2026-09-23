import { PushResultSchema, type Change, type PushResult } from '@fitadapt/shared';
import type { NewChange, ServerStore, ServerTx } from '@fitadapt/sync';
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { syncChanges, syncHeads, syncMutations } from '../db/schema.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

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

function txFor(tx: Tx): ServerTx {
  return {
    async findMutationResult(userId, mutationId) {
      const [row] = await tx
        .select({ result: syncMutations.result })
        .from(syncMutations)
        .where(and(eq(syncMutations.userId, userId), eq(syncMutations.mutationId, mutationId)))
        .limit(1);
      return row ? PushResultSchema.parse(row.result) : undefined;
    },
    async saveMutationResult(userId, result: PushResult) {
      await tx.insert(syncMutations).values({ userId, mutationId: result.mutationId, result });
    },
    async latestChange(userId, collection, recordId) {
      const [row] = await tx
        .select()
        .from(syncChanges)
        .where(and(eq(syncChanges.userId, userId), eq(syncChanges.collection, collection), eq(syncChanges.recordId, recordId)))
        .orderBy(desc(syncChanges.revision))
        .limit(1);
      return row ? toChange(row) : undefined;
    },
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
export class PgServerStore implements ServerStore {
  constructor(private readonly db: Database) {}

  transaction<T>(userId: string, fn: (tx: ServerTx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
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
