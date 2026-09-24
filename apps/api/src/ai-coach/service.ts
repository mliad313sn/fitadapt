import { randomInt, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { createEngineContext, fixedClock, painReportsFrom, type GenerateSessionInput } from '@fitadapt/engine';
import { runCoachTurn, type CoachModel, type HistoryMessage, type ReplyCache } from '@fitadapt/coach';
import { generateSession } from '@fitadapt/exercise-library';
import { AI_PERSISTENT_LABEL, notice, renderNotice } from '@fitadapt/legal';
import { valueCategories } from '@fitadapt/privacy';
import { intensityLockStatus, jointFlagsFromPain, strictestSafetyProfile } from '@fitadapt/safety';
import {
  COACH_TOOL_NAMES,
  CoachReplySchema,
  JOINTS,
  PROGRAM_COLLECTIONS,
  ReflowRecordSchema,
  orderChain,
  type CoachAction,
  type CoachContext,
  type CoachConversation,
  type CoachMessageRequest,
  type CoachMessageResponse,
  type CoachReply,
  type CoachReplyPart,
  type CoachToday,
  type JointFlags,
  type StartConversationRequest,
  type StartConversationResponse,
  type SyncMutation,
  type ToolCallAudit,
} from '@fitadapt/shared';
import type { SyncServer } from '@fitadapt/sync';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { keyedHash } from '../auth/crypto.js';
import { ApiError } from '../auth/errors.js';
import type { RateLimiter } from '../auth/rate-limit.js';
import { coachConfigValue } from '../config/coach.config.js';
import type { Database } from '../db/client.js';
import { coachConversations, coachMessages, coachToolCalls } from '../db/schema.js';
import type { LegalService } from '../legal/service.js';
import type { PrivacyService } from '../privacy/service.js';
import { latestRows, storedProgram, storedReflows } from '../profile/program-hooks.js';
import { storedExecution } from '../profile/session-hooks.js';
import { latestSafetyProfile } from '../profile/sync-hooks.js';
import type { PgServerTx } from '../sync/pg-store.js';
import { eraseCoach, exportCoach, purgeExpiredConversations } from './store.js';

export const coachErrors = {
  notFound: () => new ApiError(404, 'coach.conversation_not_found'),
  rateLimited: () => new ApiError(429, 'coach.rate_limited'),
};

export type CoachTier = 'free' | 'premium';

export interface CoachServiceDeps {
  db: Database;
  redis: Redis;
  redisPrefix: string;
  rateLimiter: RateLimiter;
  privacy: PrivacyService;
  legal: LegalService;
  sync: SyncServer<PgServerTx>;
  pepper: string;
  now: () => Date;
  /** null: no provider key configured; the coach answers without a model. */
  model: CoachModel | null;
  /** The stable system prompt: the M20 legal preamble, then the coach rules. */
  systemStable: string;
  /** Subscription tier (M16 decides; until then everyone is on the free tier). */
  tierOf?: (userId: string) => Promise<CoachTier>;
}

const DAY_MS = 86_400_000;
const LEVEL = { green: 0, amber: 1, red: 2 } as const;

/** The strictest of two joint-flag sets (S2: the server's pain reports can only make it stricter). */
function strictest(a: JointFlags | undefined, b: JointFlags): JointFlags {
  const out: JointFlags = {};
  for (const joint of JOINTS) {
    const x = a?.[joint];
    const y = b[joint];
    const pick = x === undefined ? y : y === undefined ? x : LEVEL[x] >= LEVEL[y] ? x : y;
    if (pick !== undefined) out[joint] = pick;
  }
  return out;
}

/**
 * The AI coach behind the API (M11; ADR-024). Server-side model proxy with
 * per-tier rate limits (Redis), a cache for general answers, consent gating
 * (ai_coach), the L5 disclosure at every conversation start, the S6 tool
 * boundary (records written only through the sync validators, which
 * re-derive them with the engine), and the L11 defensibility log. No message
 * text or tool input is ever logged.
 */
export class CoachService {
  constructor(private readonly deps: CoachServiceDeps) {}

  private subjectRef(userId: string): string {
    return keyedHash(this.deps.pepper, 'coach', userId);
  }

  private async limit(userId: string): Promise<void> {
    const tier = (await this.deps.tierOf?.(userId)) ?? 'free';
    const ref = this.subjectRef(userId);
    const burst = await this.deps.rateLimiter.hit('coach-burst', ref, coachConfigValue('burstPerMinute'), 60);
    const perTier = await this.deps.rateLimiter.hit(`coach-${tier}`, ref, coachConfigValue(tier === 'premium' ? 'premiumMessagesPerWindow' : 'freeMessagesPerWindow'), coachConfigValue('messageWindowSeconds'));
    if (!burst || !perTier) throw coachErrors.rateLimited();
  }

  /** L5: every conversation starts with the AI disclosure (the M20 `ai_coach` notice), recorded as shown. */
  async start(userId: string, input: StartConversationRequest): Promise<StartConversationResponse> {
    await this.deps.privacy.requireConsent(userId, 'ai_coach');
    const ref = this.subjectRef(userId);
    if (!(await this.deps.rateLimiter.hit('coach-burst', ref, coachConfigValue('burstPerMinute'), 60))) throw coachErrors.rateLimited();
    const def = notice('ai_coach');
    const rendered = renderNotice(def, input.locale, input.jurisdiction);
    const now = this.deps.now();
    const conversationId = randomUUID();
    await this.deps.db.transaction(async (tx) => {
      await tx.insert(coachConversations).values({ id: conversationId, userId, locale: input.locale, jurisdiction: input.jurisdiction, startedAt: now, lastMessageAt: now });
      await tx.insert(coachMessages).values({ id: randomUUID(), conversationId, userId, seq: 0, role: 'disclosure', content: { noticeId: def.id, version: def.version, contentHash: rendered.contentHash }, createdAt: now });
    });
    await this.deps.legal.recordNotice(userId, { noticeId: def.id, version: def.version, kind: 'shown', locale: input.locale, jurisdiction: input.jurisdiction, contentHash: rendered.contentHash });
    return { conversationId, startedAt: now.toISOString(), disclosure: { noticeId: 'ai_coach', version: def.version, titleKey: def.title, bodyKey: def.body, labelKey: AI_PERSISTENT_LABEL, contentHash: rendered.contentHash } };
  }

  private async conversation(userId: string, conversationId: string) {
    const [row] = await this.deps.db.select().from(coachConversations).where(and(eq(coachConversations.id, conversationId), eq(coachConversations.userId, userId))).limit(1);
    if (!row) throw coachErrors.notFound();
    return row;
  }

  /**
   * The server's truth replaces the safety-relevant parts of the device's
   * context before any tool runs: the SafetyProfile of the latest stored
   * screening (S1/S4/S7), the S3 lock and the S2 joint flags of the stored
   * execution logs (never less strict than the device's), the stored program
   * and reflows. Today's plan is re-derived by the engine from that input at
   * its recorded clock and seed.
   */
  async hardenContext(userId: string, context: CoachContext): Promise<CoachContext> {
    let today = context.today;
    if (today) {
      const stored = await latestSafetyProfile(this.deps.db, userId);
      // Never looser than either side: the device may hold a newer, stricter screening or a red flag not synced yet.
      const safetyProfile = isDeepStrictEqual(stored, today.input.safetyProfile) ? stored : strictestSafetyProfile([stored, today.input.safetyProfile]);
      const { events } = await storedExecution(this.deps.db, userId);
      const storedLock = intensityLockStatus(events);
      const input = {
        ...today.input,
        safetyProfile,
        intensityLock: today.input.intensityLock?.locked ? today.input.intensityLock : storedLock,
        jointFlags: strictest(today.input.jointFlags, jointFlagsFromPain(painReportsFrom(events))),
      } as GenerateSessionInput;
      const plan: CoachToday['plan'] = (() => {
        try {
          const r = generateSession(input, createEngineContext({ clock: fixedClock(Date.parse(today!.generatedAt)), seed: today!.seed }));
          return r.status === 'ok' ? r.plan : null;
        } catch {
          return null;
        }
      })();
      today = { ...today, input: input as CoachToday['input'], plan };
    }
    let program = context.program;
    if (program) {
      const stored = await storedProgram(this.deps.db, userId, program.record.program.programId);
      program = stored ? { record: stored, reflows: await storedReflows(this.deps.db, userId, stored.program.programId), today: program.today } : null;
    }
    return { ...context, today, program };
  }

  private async history(conversationId: string): Promise<HistoryMessage[]> {
    const rows = await this.deps.db
      .select()
      .from(coachMessages)
      .where(eq(coachMessages.conversationId, conversationId))
      .orderBy(desc(coachMessages.seq))
      .limit(8);
    return rows
      .reverse()
      .flatMap((m): HistoryMessage[] => {
        if (m.role === 'user') return [{ role: 'user', text: String((m.content as { text?: unknown }).text ?? '') }];
        if (m.role !== 'coach') return [];
        const parsed = CoachReplySchema.safeParse((m.content as { reply?: unknown }).reply);
        if (!parsed.success) return [];
        return [{ role: 'coach', text: parsed.data.parts.map((p) => (p.kind === 'model' ? p.text : p.key)).join(' ') }];
      });
  }

  private cache(text: string): ReplyCache | undefined {
    // Only a question with no personal data in it (email, phone, weight, pain…) is cached; the key is a keyed hash.
    if (valueCategories(text, { allowSentences: true }).length > 0) return undefined;
    const redisKey = (key: string) => `${this.deps.redisPrefix}coach:cache:${keyedHash(this.deps.pepper, 'coach-cache', key)}`;
    return {
      get: async (key) => {
        const raw = await this.deps.redis.get(redisKey(key));
        if (!raw) return null;
        const parsed = CoachReplySchema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : null;
      },
      set: async (key, reply) => {
        await this.deps.redis.set(redisKey(key), JSON.stringify(reply), 'EX', coachConfigValue('cacheTtlSeconds'));
      },
    };
  }

  /** Heads of the stored reflows of a program (ADR-023: a new reflow names what it follows). */
  private async reflowHeads(userId: string, programId: string): Promise<string[]> {
    const rows = await latestRows(this.deps.db, userId, PROGRAM_COLLECTIONS.reflows);
    const list = rows.flatMap((r) => {
      const parsed = ReflowRecordSchema.safeParse(r.data);
      return r.op !== 'delete' && parsed.success && parsed.data.programId === programId ? [{ id: r.recordId, data: parsed.data }] : [];
    });
    return orderChain(list, (r) => ({ id: r.id, supersedes: r.data.supersedes, at: r.data.decidedAt })).heads.map((h) => h.id);
  }

  /** Records a tool decided (pain report, reflow, red flag) go through the sync validators like any device write. */
  private async persist(userId: string, deviceId: string, actions: CoachAction[], audits: ToolCallAudit[], parts: CoachReplyPart[]): Promise<CoachAction[]> {
    const kept: CoachAction[] = [];
    for (const action of actions) {
      if (action.type !== 'record' && action.type !== 'red_flag_stop') {
        kept.push(action);
        continue;
      }
      let data: Record<string, unknown> = action.type === 'record' ? action.data : (action.log as unknown as Record<string, unknown>);
      if (action.type === 'record' && action.collection === 'program_reflows') data = { ...data, supersedes: await this.reflowHeads(userId, String(data.programId)) };
      const collection = action.type === 'record' ? action.collection : 'execution_logs';
      const recordId = action.type === 'record' ? action.recordId : randomUUID();
      const mutation: SyncMutation = { mutationId: randomUUID(), collection, recordId, op: 'insert', baseRevision: null, data, clientCreatedAt: this.deps.now().toISOString() };
      const [result] = (await this.deps.sync.push(userId, { deviceId, mutations: [mutation] })).results;
      if (result?.status === 'applied' || result?.status === 'duplicate') {
        kept.push(action.type === 'record' ? { ...action, data } : action);
        continue;
      }
      // Refused by the server's validators: the change did not happen. A red-flag stop still runs on the device (S3 is never undone).
      const tool = action.type === 'red_flag_stop' ? 'reportRedFlag' : action.collection === 'program_reflows' ? 'reschedule' : 'logPain';
      const audit = audits.find((a) => a.status === 'applied' && a.tool === tool);
      if (audit) Object.assign(audit, { status: 'refused', reasonCode: 'coach.record.rejected', reasonCodes: ['coach.record.rejected', ...(result?.status === 'rejected' && result.reason ? [result.reason.slice(0, 100)] : [])].filter((c) => /^[a-z][a-z0-9_.]{2,119}$/.test(c)) });
      parts.push({ kind: 'template', key: 'coach.reply.tool.refused', values: {} }, { kind: 'template', key: 'engine.reason.coach.record.rejected', values: {} });
      if (action.type === 'red_flag_stop') kept.push(action);
    }
    return kept;
  }

  async message(userId: string, deviceId: string, conversationId: string, input: CoachMessageRequest): Promise<CoachMessageResponse> {
    await this.deps.privacy.requireConsent(userId, 'ai_coach');
    const convo = await this.conversation(userId, conversationId);
    await this.limit(userId);
    const now = this.deps.now();
    const context = await this.hardenContext(userId, { ...input.context, locale: convo.locale, jurisdiction: convo.jurisdiction });
    const out = await runCoachTurn({
      text: input.text,
      context,
      history: await this.history(conversationId),
      model: this.deps.model,
      systemStable: this.deps.systemStable,
      env: { nowMs: now.getTime(), seed: randomInt(0, 2 ** 31 - 1), newId: randomUUID },
      cache: this.cache(input.text),
      noModelSource: 'deterministic',
    });
    const audits = out.result.toolCalls.map((a) => ({ ...a }));
    const parts = [...out.result.reply.parts];
    const actions = await this.persist(userId, deviceId, [...out.result.actions], audits, parts);
    const reply: CoachReply = { ...out.result.reply, parts: parts.slice(0, 40) };
    const messageId = randomUUID();

    await this.deps.db.transaction(async (tx) => {
      const [last] = await tx.select({ seq: coachMessages.seq }).from(coachMessages).where(eq(coachMessages.conversationId, conversationId)).orderBy(desc(coachMessages.seq)).limit(1);
      const seq = (last?.seq ?? 0) + 1;
      await tx.insert(coachMessages).values({ id: randomUUID(), conversationId, userId, seq, role: 'user', content: { text: input.text }, createdAt: now });
      await tx.insert(coachMessages).values({
        id: messageId,
        conversationId,
        userId,
        seq: seq + 1,
        role: 'coach',
        content: { reply, actions: actions.map((a) => ({ type: a.type, ...(a.type === 'record' ? { collection: a.collection, recordId: a.recordId } : {}), ...(a.type === 'session_proposal' ? { change: a.change, planId: a.plan.planId } : {}) })), model: { tier: out.modelTier, id: out.modelId, rounds: out.modelRounds, degraded: out.degraded } },
        createdAt: now,
      });
      for (const a of audits) {
        await tx.insert(coachToolCalls).values({ id: a.id, conversationId, messageId, userId, tool: a.tool, input: (a.input ?? null) as never, status: a.status, reasonCode: a.reasonCode, reasonCodes: a.reasonCodes, engineVersion: a.engineVersion, createdAt: now });
        const tool = (COACH_TOOL_NAMES as readonly string[]).includes(a.tool) ? (a.tool as (typeof COACH_TOOL_NAMES)[number]) : 'unknown';
        await this.deps.legal.recordCoachToolCall(userId, { tool, status: a.status, reasonCode: a.reasonCode, engineVersion: a.engineVersion }, tx);
      }
      // S6: a model reply the guard blocked (the S3 events of a red flag are written by the sync listener with the stored log).
      for (const e of out.safetyEvents) if (e.invariant === 'S6') await this.deps.legal.recordSafetyEvent(userId, e, tx);
      await tx.update(coachConversations).set({ lastMessageAt: now }).where(eq(coachConversations.id, conversationId));
    });
    return { conversationId, messageId, reply, actions, toolCalls: audits };
  }

  async get(userId: string, conversationId: string): Promise<CoachConversation> {
    const convo = await this.conversation(userId, conversationId);
    const all = await exportCoach(this.deps.db, userId);
    const found = all.conversations.find((c) => c.conversationId === convo.id)!;
    return { ...found, jurisdiction: convo.jurisdiction, toolCalls: found.toolCalls as CoachConversation['toolCalls'] };
  }

  async remove(userId: string, conversationId: string): Promise<void> {
    if ((await eraseCoach(this.deps.db, userId, conversationId)) === 0) throw coachErrors.notFound();
  }

  /** Retention job: conversations older than the retention period (after their last message) are deleted. */
  async purgeExpired(): Promise<number> {
    return purgeExpiredConversations(this.deps.db, new Date(this.deps.now().getTime() - coachConfigValue('conversationRetentionDays') * DAY_MS));
  }

  /** For tests and the export: the stored messages of a conversation, oldest first. */
  async storedMessages(conversationId: string) {
    return this.deps.db.select().from(coachMessages).where(eq(coachMessages.conversationId, conversationId)).orderBy(asc(coachMessages.seq));
  }
}
