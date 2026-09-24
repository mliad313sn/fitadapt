import type { DataExport } from '@fitadapt/shared';
import { and, asc, eq, inArray, lt } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { coachConversations, coachMessages, coachToolCalls } from '../db/schema.js';
import type { ConsentWithdrawalHandler } from '../privacy/service.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
const iso = (d: Date) => d.toISOString();

/**
 * Coach conversations in primary storage (M11; health data under the ai_coach
 * consent). Exported with the account (M17), erased on withdrawal of the
 * ai_coach consent, with the account (cascade) and after the retention period.
 */
export async function exportCoach(tx: Tx | Database, userId: string): Promise<DataExport['coach']> {
  const conversations = await tx.select().from(coachConversations).where(eq(coachConversations.userId, userId)).orderBy(asc(coachConversations.startedAt));
  if (conversations.length === 0) return { conversations: [] };
  const ids = conversations.map((c) => c.id);
  const messages = await tx.select().from(coachMessages).where(inArray(coachMessages.conversationId, ids)).orderBy(asc(coachMessages.conversationId), asc(coachMessages.seq));
  const calls = await tx.select().from(coachToolCalls).where(inArray(coachToolCalls.conversationId, ids)).orderBy(asc(coachToolCalls.createdAt));
  return {
    conversations: conversations.map((c) => ({
      conversationId: c.id,
      locale: c.locale,
      jurisdiction: c.jurisdiction,
      startedAt: iso(c.startedAt),
      messages: messages.filter((m) => m.conversationId === c.id).map((m) => ({ id: m.id, role: m.role, content: m.content, at: iso(m.createdAt) })),
      toolCalls: calls
        .filter((t) => t.conversationId === c.id)
        .map((t) => ({ id: t.id, tool: t.tool, input: t.input, status: t.status, reasonCode: t.reasonCode, reasonCodes: t.reasonCodes as string[], engineVersion: t.engineVersion, at: iso(t.createdAt) })),
    })),
  };
}

/** Deleting a conversation removes its messages and tool calls (cascade). */
export async function eraseCoach(tx: Tx | Database, userId: string, conversationId?: string): Promise<number> {
  const where = conversationId ? and(eq(coachConversations.userId, userId), eq(coachConversations.id, conversationId)) : eq(coachConversations.userId, userId);
  const deleted = await tx.delete(coachConversations).where(where).returning({ id: coachConversations.id });
  return deleted.length;
}

/** Withdrawing the ai_coach consent erases every conversation in the withdrawal transaction. */
export function coachWithdrawalHandler(): ConsentWithdrawalHandler {
  return async (tx, userId) => {
    await eraseCoach(tx, userId);
  };
}

/** Retention: conversations whose last message is older than the cut-off are deleted. */
export async function purgeExpiredConversations(db: Database, cutoff: Date): Promise<number> {
  const deleted = await db.delete(coachConversations).where(lt(coachConversations.lastMessageAt, cutoff)).returning({ id: coachConversations.id });
  return deleted.length;
}
