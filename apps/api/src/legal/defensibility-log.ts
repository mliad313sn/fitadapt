import { randomUUID } from 'node:crypto';
import {
  GLOBAL_CHAIN,
  automaticLegalHold,
  chainEvent,
  legalValue,
  sha256Hex,
  verifyChain,
  type ChainVerification,
  type DefensibilityEvent,
  type DefensibilityEventInput,
  type DefensibilityEventType,
} from '@fitadapt/legal';
import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { defensibilityEvents } from '../db/schema.js';

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
    // FIX-B (B pre-review): an incident report places a legal hold on its chain in the same transaction.
    if (event.type === 'incident.recorded') {
      const hold = automaticLegalHold(await this.chain(input.chain, tx).then((c) => c.filter((e) => e.id !== event.id)), event, randomUUID());
      if (hold) await this.append(tx, hold);
    }
    return event;
  }

  async appendNow(input: DefensibilityEventInput): Promise<DefensibilityEvent> {
    return this.db.transaction((tx) => this.append(tx, input));
  }

  async chain(chain: string, executor: Executor = this.db): Promise<DefensibilityEvent[]> {
    const rows = await executor.select().from(defensibilityEvents).where(eq(defensibilityEvents.chain, chain)).orderBy(asc(defensibilityEvents.chainSeq));
    return rows.map(toEvent);
  }

  async verify(chain: string): Promise<ChainVerification> {
    return verifyChain(await this.chain(chain));
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
        await tx.execute(sql`SET LOCAL app.defensibility_purge = 'on'`);
        await tx.delete(defensibilityEvents).where(and(eq(defensibilityEvents.chain, chain), lt(defensibilityEvents.occurredAt, cutoff)));
        await tx.execute(sql`SET LOCAL app.defensibility_purge = 'off'`);
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
