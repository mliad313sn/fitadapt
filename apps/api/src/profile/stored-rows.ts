import { AsyncLocalStorage } from 'node:async_hooks';
import { and, asc, count, desc, eq, gt, max } from 'drizzle-orm';
import type { z } from 'zod';
import type { DbExecutor } from '../db/client.js';
import { syncChanges } from '../db/schema.js';

/**
 * API-11: the server-side re-checks read a user's stored history (sessions,
 * set logs, execution logs, readiness checks, …) for every synced mutation.
 * A push carries up to 500 mutations, so re-reading and re-parsing a two-year
 * history each time was quadratic. Within one push request (`withPushCache`)
 * the rows of a collection are loaded once and then only the rows appended
 * since are fetched; each row is parsed once per schema. The cache is checked
 * against the stored count and last revision before every use: rows erased
 * in between (a consent withdrawal between two mutations) force a full
 * reload, so a validator never sees a row that is gone. The cache lives only
 * for the request (health data is not kept in memory beyond it).
 */

export interface StoredRow {
  readonly recordId: string;
  readonly op: string;
  readonly data: unknown;
  readonly revision: number;
}

interface Entry {
  rows: StoredRow[];
  lastRevision: number;
}

interface PushCache {
  readonly collections: Map<string, Entry>;
  readonly parsed: WeakMap<StoredRow, Map<z.ZodType, { success: boolean; data?: unknown }>>;
  fullLoads: number;
  incrementalLoads: number;
}

const scope = new AsyncLocalStorage<PushCache>();

/** Runs one push request with a per-request cache of stored rows. */
export function withPushCache<T>(fn: () => Promise<T>): Promise<T> {
  return scope.run({ collections: new Map(), parsed: new WeakMap(), fullLoads: 0, incrementalLoads: 0 }, fn);
}

/** Loads of the current request's cache (tests and diagnostics); null outside a push. */
export function pushCacheStats(): { fullLoads: number; incrementalLoads: number } | null {
  const cache = scope.getStore();
  return cache ? { fullLoads: cache.fullLoads, incrementalLoads: cache.incrementalLoads } : null;
}

const columns = { recordId: syncChanges.recordId, op: syncChanges.op, data: syncChanges.data, revision: syncChanges.revision };

/** Every stored change of a collection for the user, in revision order (cached within a push). */
export async function collectionRows(db: DbExecutor, userId: string, collection: string): Promise<readonly StoredRow[]> {
  const where = and(eq(syncChanges.userId, userId), eq(syncChanges.collection, collection));
  const cache = scope.getStore();
  if (!cache) return db.select(columns).from(syncChanges).where(where).orderBy(asc(syncChanges.revision));
  const key = `${userId}\u0000${collection}`;
  const [head] = await db.select({ n: count(), last: max(syncChanges.revision) }).from(syncChanges).where(where);
  const n = head?.n ?? 0;
  const last = head?.last ?? 0;
  const entry = cache.collections.get(key);
  if (entry && entry.lastRevision === last && entry.rows.length === n) return entry.rows;
  if (entry && last > entry.lastRevision) {
    const added = await db.select(columns).from(syncChanges).where(and(where, gt(syncChanges.revision, entry.lastRevision))).orderBy(asc(syncChanges.revision));
    if (entry.rows.length + added.length === n) {
      cache.incrementalLoads += 1;
      const next = { rows: [...entry.rows, ...added], lastRevision: last };
      cache.collections.set(key, next);
      return next.rows;
    }
  }
  // First use, or rows were removed since (erasure): load everything again.
  cache.fullLoads += 1;
  const rows = await db.select(columns).from(syncChanges).where(where).orderBy(asc(syncChanges.revision));
  cache.collections.set(key, { rows, lastRevision: last });
  return rows;
}

/** The latest stored change of one record (a single indexed row, never the whole collection). */
export async function latestRecordRow(db: DbExecutor, userId: string, collection: string, recordId: string): Promise<StoredRow | undefined> {
  const [row] = await db
    .select(columns)
    .from(syncChanges)
    .where(and(eq(syncChanges.userId, userId), eq(syncChanges.collection, collection), eq(syncChanges.recordId, recordId)))
    .orderBy(desc(syncChanges.revision))
    .limit(1);
  return row;
}

/** The non-deleted rows that parse with `schema`, each parsed once per request. */
export function parsedRows<S extends z.ZodType>(list: readonly StoredRow[], schema: S): { id: string; data: z.infer<S> }[] {
  const cache = scope.getStore();
  const out: { id: string; data: z.infer<S> }[] = [];
  for (const r of list) {
    if (r.op === 'delete') continue;
    let result: { success: boolean; data?: unknown } | undefined;
    if (cache) {
      let bySchema = cache.parsed.get(r);
      if (!bySchema) {
        bySchema = new Map();
        cache.parsed.set(r, bySchema);
      }
      result = bySchema.get(schema);
      if (!result) {
        const p = schema.safeParse(r.data);
        result = p.success ? { success: true, data: p.data } : { success: false };
        bySchema.set(schema, result);
      }
    } else {
      const p = schema.safeParse(r.data);
      result = p.success ? { success: true, data: p.data } : { success: false };
    }
    if (result.success) out.push({ id: r.recordId, data: result.data as z.infer<S> });
  }
  return out;
}
