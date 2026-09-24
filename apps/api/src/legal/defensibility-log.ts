import { randomUUID } from 'node:crypto';
import {
  GENESIS_HASH,
  GLOBAL_CHAIN,
  chainEvent,
  legalValue,
  sha256Hex,
  verifyChain,
  type ChainHead,
  type ChainVerification,
  type DefensibilityEvent,
  type DefensibilityEventInput,
  type DefensibilityEventType,
} from '@fitadapt/legal';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { defensibilityEvents, defensibilityHeads } from '../db/schema.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Tx | Database;
const DAY_MS = 86_400_000;

function toEvent(row: typeof defensibilityEvents.$inferSelect): DefensibilityEvent {
  return {
    id: row.id,
    chain: row.chain,
    chainSeq: row.chainSeq,
    type: row.type as DefensibilityEventType,
    occurredAt: row.occurredAt,
    payload: row.payload as DefensibilityEvent['payload'],
    prevHash: row.prevHash,
    hash: row.hash,
  };
}

/**
 * Durable defensibility log in PostgreSQL (ADR-009). Appends are serialised
 * per chain with a transaction-scoped advisory lock, so two writers never
 * fork a chain. Hashing and verification are the pure functions of
 * @fitadapt/legal, identical on the device.
 */
export class DefensibilityLog {
  constructor(private readonly db: Database) {}

  async append(tx: Tx, input: DefensibilityEventInput): Promise<DefensibilityEvent> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`defensibility:${input.chain}`}, 0))`);
    const [head] = await tx.select().from(defensibilityEvents).where(eq(defensibilityEvents.chain, input.chain)).orderBy(desc(defensibilityEvents.chainSeq)).limit(1);
    const event = chainEvent(head ? toEvent(head) : undefined, input, randomUUID());
    await tx.insert(defensibilityEvents).values({ ...event, payload: event.payload });
    return event;
  }

  async appendNow(input: DefensibilityEventInput): Promise<DefensibilityEvent> {
    return this.db.transaction((tx) => this.append(tx, input));
  }

  async chain(chain: string, executor: Executor = this.db): Promise<DefensibilityEvent[]> {
    const rows = await executor.select().from(defensibilityEvents).where(eq(defensibilityEvents.chain, chain)).orderBy(asc(defensibilityEvents.chainSeq));
    return rows.map(toEvent);
  }

  /**
   * The anchored head of a chain (PKG-01): the `defensibility_heads` row the
   * insert trigger advances in the append transaction. A chain never written
   * has the empty head; a purged chain has length 0 (its tombstone keeps the
   * purged length and hash).
   */
  async head(chain: string, executor: Executor = this.db): Promise<ChainHead> {
    const [row] = await executor.select().from(defensibilityHeads).where(eq(defensibilityHeads.chain, chain));
    return row ? { length: row.length, head: row.headHash } : { length: 0, head: GENESIS_HASH };
  }

  /** Events and anchored head read from one snapshot, so a concurrent append is never mistaken for a truncation. */
  async snapshot(chain: string): Promise<{ events: DefensibilityEvent[]; head: ChainHead }> {
    return this.db.transaction(async (tx) => ({ events: await this.chain(chain, tx), head: await this.head(chain, tx) }), { isolationLevel: 'repeatable read', accessMode: 'read only' });
  }

  /** Verifies the chain against its anchored head: an edit, a removed middle event, a removed tail or a removed chain all fail. */
  async verify(chain: string): Promise<ChainVerification> {
    const { events, head } = await this.snapshot(chain);
    return verifyChain(events, head);
  }

  /** True while the chain has a legal hold placed and not released. */
  async isHeld(chain: string, executor: Executor = this.db): Promise<boolean> {
    const holds = await executor
      .select()
      .from(defensibilityEvents)
      .where(and(eq(defensibilityEvents.chain, chain), inArray(defensibilityEvents.type, ['legal_hold.placed', 'legal_hold.released'])))
      .orderBy(asc(defensibilityEvents.chainSeq));
    const open = new Set<string>();
    for (const h of holds) {
      const holdId = (h.payload as { holdId: string }).holdId;
      if (h.type === 'legal_hold.placed') open.add(holdId);
      else open.delete(holdId);
    }
    return open.size > 0;
  }

  /**
   * Retention (defensibilityRetentionDays after a subject's last event):
   * removes whole subject chains that expired and are not under legal hold,
   * and records each purge in the global chain. Never touches the global chain.
   */
  async purgeExpired(now: Date): Promise<{ purged: number }> {
    const cutoff = new Date(now.getTime() - legalValue('defensibilityRetentionDays') * DAY_MS).toISOString();
    const heads = await this.db
      .select({ chain: defensibilityEvents.chain, last: sql<string>`max(${defensibilityEvents.occurredAt})` })
      .from(defensibilityEvents)
      .where(sql`${defensibilityEvents.chain} <> ${GLOBAL_CHAIN}`)
      .groupBy(defensibilityEvents.chain);
    let purged = 0;
    for (const { chain, last } of heads) {
      if (!(last < cutoff)) continue;
      await this.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`defensibility:${chain}`}, 0))`);
        if (await this.isHeld(chain, tx)) return;
        const events = await this.chain(chain, tx);
        const head = events[events.length - 1];
        if (!head || head.occurredAt >= cutoff) return;
        // The only deletion path (ADR-024): the database function removes the whole chain, refuses a held or
        // unexpired one, and the commit fails unless the retention.purged event below matches the tombstone.
        await tx.execute(sql`SELECT defensibility_purge_chain(${chain}, ${cutoff})`);
        await this.append(tx, {
          type: 'retention.purged',
          chain: GLOBAL_CHAIN,
          occurredAt: now.toISOString(),
          payload: { chainDigest: sha256Hex(chain), eventCount: events.length, headHash: head.hash },
        });
        purged += 1;
      });
    }
    return { purged };
  }
}
