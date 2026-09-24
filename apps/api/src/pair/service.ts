import { randomInt, randomUUID } from 'node:crypto';
import { challengeOn, projectPairEvent, type PartnerScopes } from '@fitadapt/privacy';
import { PairEventSchema, PairSharingScopeSchema, type PairEvent, type PairSharingScope, type ParticipantSlot } from '@fitadapt/shared';
import { PAIR_RULES_VERSION } from '@fitadapt/engine';
import { CONSENT_POLICIES, policyFor } from '@fitadapt/privacy';
import { and, asc, eq, gt, max, or } from 'drizzle-orm';
import { z } from 'zod';
import { keyedHash } from '../auth/crypto.js';
import { ApiError } from '../auth/errors.js';
import { pairValue } from '../config/pair.config.js';
import { lockUser, type Database, type DbExecutor } from '../db/client.js';
import { pairEvents, pairParticipants, pairSessions } from '../db/schema.js';
import type { LegalService } from '../legal/service.js';
import type { ConsentWithdrawalHandler, PrivacyService } from '../privacy/service.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * M09 Fair Pair, multi-device relay (ADR-021). Two accounts, two devices,
 * one pair session.
 *
 * - Each participant must have accepted their OWN L2 texts (Terms, Privacy,
 *   exercise risk) and given their own health-data consent (the first-workout
 *   gate) and their own `partner_sharing` consent (M17), checked at create,
 *   join and every connection.
 * - What a participant shares is their own choice of scopes (performance,
 *   body weight, the challenge: all off by default); the server projects
 *   every event it relays by the SENDER's scopes (@fitadapt/privacy), so a
 *   modified client cannot widen them. Body-weight and score events are
 *   refused without their scope, and scores unless both chose the challenge.
 * - The relay stores events append-only, ordered (`seq`) and idempotent on
 *   the device's event id, so a device that reconnects gets what it missed
 *   and a resend is not duplicated. No timer is kept: devices time rests.
 * - Each person's training logs stay in their own sync collections.
 * - Defensibility (ADR-009): pair.joined, pair.challenge_started, pair.left
 *   (own chain) and pair.partner_left (the partner's chain, never with a
 *   reason) in the same transaction as the pair data.
 */
export const pairErrors = {
  notFound: () => new ApiError(404, 'pair.not_found'),
  full: () => new ApiError(409, 'pair.full'),
  ownSession: () => new ApiError(409, 'pair.own_session'),
  expired: () => new ApiError(410, 'pair.join_expired'),
  notParticipant: () => new ApiError(403, 'pair.not_participant'),
  scope: () => new ApiError(403, 'pair.scope_required'),
  challengeOff: () => new ApiError(403, 'pair.challenge_off'),
  tooMany: () => new ApiError(429, 'pair.too_many_events'),
  consent: () => new ApiError(403, 'pair.consent_required'),
};

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface PairServiceDeps {
  readonly db: Database;
  readonly privacy: PrivacyService;
  readonly legal: LegalService;
  readonly pepper: string;
  readonly now: () => Date;
}

export interface Participation {
  readonly pairSessionId: string;
  readonly slot: ParticipantSlot;
  readonly userId: string;
  readonly displayName: string;
  readonly scopes: PairSharingScope[];
}

export interface RelayedEvent {
  readonly seq: number;
  readonly from: ParticipantSlot;
  readonly clientEventId: string;
  readonly event: PairEvent;
}

const ScopesSchema = z.array(PairSharingScopeSchema);

export class PairService {
  constructor(private readonly deps: PairServiceDeps) {}

  private codeHash(code: string) {
    return keyedHash(this.deps.pepper, 'pair-join-code', code);
  }

  /** L2 + M17 for THIS person: their own texts, health consent and partner_sharing consent. */
  async requireEligible(userId: string, jurisdiction: string, db: DbExecutor = this.deps.db): Promise<void> {
    await this.deps.legal.requireFirstWorkoutAcceptance(userId, jurisdiction, db);
    if (!(await this.deps.privacy.hasConsent(userId, 'partner_sharing', db))) throw pairErrors.consent();
  }

  private consentVersion(jurisdiction: string) {
    return policyFor('partner_sharing', jurisdiction, CONSENT_POLICIES).currentVersion;
  }

  async create(userId: string, input: { displayName: string; scopes: PairSharingScope[]; jurisdiction: string }): Promise<{ pairSessionId: string; joinCode: string }> {
    const now = this.deps.now();
    const joinCode = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
    const pairSessionId = randomUUID();
    const scopes = [...new Set(input.scopes)];
    await this.deps.db.transaction(async (tx) => {
      // API-2: eligibility (partner_sharing consent) read under the user's lock, in the writing transaction.
      await lockUser(tx, userId);
      await this.requireEligible(userId, input.jurisdiction, tx);
      await tx.insert(pairSessions).values({ id: pairSessionId, hostUserId: userId, joinCodeHash: this.codeHash(joinCode), createdAt: now });
      await tx.insert(pairParticipants).values({ pairSessionId, slot: 'a', userId, displayName: input.displayName, scopes, consentVersion: this.consentVersion(input.jurisdiction), joinedAt: now });
      await this.deps.legal.recordPairEvent(userId, 'pair.joined', { pairSessionId, role: 'host', mode: 'multi_device', scopes, consentVersion: this.consentVersion(input.jurisdiction) }, tx);
    });
    return { pairSessionId, joinCode };
  }

  async join(userId: string, input: { joinCode: string; displayName: string; scopes: PairSharingScope[]; jurisdiction: string }): Promise<{ pairSessionId: string; slot: ParticipantSlot; challenge: boolean }> {
    const now = this.deps.now();
    const scopes = [...new Set(input.scopes)];
    return this.deps.db.transaction(async (tx) => {
      // API-2: eligibility read under the user's lock, in the writing transaction.
      await lockUser(tx, userId);
      await this.requireEligible(userId, input.jurisdiction, tx);
      const [session] = await tx.select().from(pairSessions).where(eq(pairSessions.joinCodeHash, this.codeHash(input.joinCode))).for('update');
      if (!session) throw pairErrors.notFound();
      if (session.hostUserId === userId) throw pairErrors.ownSession();
      if (now.getTime() - session.createdAt.getTime() > pairValue('joinWindowSeconds') * 1000) throw pairErrors.expired();
      const present = await tx.select().from(pairParticipants).where(eq(pairParticipants.pairSessionId, session.id));
      const host = present.find((p) => p.slot === 'a');
      if (present.some((p) => p.slot === 'b') || !host) throw pairErrors.full();
      await tx.insert(pairParticipants).values({ pairSessionId: session.id, slot: 'b', userId, displayName: input.displayName, scopes, consentVersion: this.consentVersion(input.jurisdiction), joinedAt: now });
      await this.deps.legal.recordPairEvent(userId, 'pair.joined', { pairSessionId: session.id, role: 'partner', mode: 'multi_device', scopes, consentVersion: this.consentVersion(input.jurisdiction) }, tx);
      const challenge = challengeOn(ScopesSchema.parse(host.scopes), scopes);
      if (challenge) {
        // Both chose the challenge: it starts for both, logged in both chains with the participation.
        for (const who of [host.userId, userId]) await this.deps.legal.recordPairEvent(who, 'pair.challenge_started', { pairSessionId: session.id, rulesVersion: PAIR_RULES_VERSION }, tx);
      }
      return { pairSessionId: session.id, slot: 'b' as const, challenge };
    });
  }

  async participants(pairSessionId: string, db: DbExecutor = this.deps.db): Promise<Participation[]> {
    const rows = await db.select().from(pairParticipants).where(eq(pairParticipants.pairSessionId, pairSessionId)).orderBy(asc(pairParticipants.slot));
    return rows.map((r) => ({ pairSessionId: r.pairSessionId, slot: r.slot, userId: r.userId, displayName: r.displayName, scopes: ScopesSchema.parse(r.scopes) }));
  }

  /** The participation of a user in a pair session, with the connection-time checks (their consent may have been withdrawn). */
  async connect(userId: string, pairSessionId: string, db: DbExecutor = this.deps.db): Promise<{ me: Participation; all: Participation[]; challenge: boolean }> {
    const all = await this.participants(pairSessionId, db);
    const me = all.find((p) => p.userId === userId);
    if (!me) throw pairErrors.notParticipant();
    if (!(await this.deps.privacy.hasConsent(userId, 'partner_sharing', db))) throw pairErrors.consent();
    return { me, all, challenge: all.length === 2 && challengeOn(all[0]!.scopes, all[1]!.scopes) };
  }

  /** What `recipient` may see of an event: their own as sent; the partner's projected by the partner's scopes (null: nothing). */
  project(event: RelayedEvent, recipient: ParticipantSlot, all: readonly Participation[]): RelayedEvent | null {
    if (event.from === recipient) return event;
    const sender = all.find((p) => p.slot === event.from);
    const scopes: PartnerScopes = sender ? sender.scopes : null;
    const projected = projectPairEvent(event.event, scopes);
    return projected ? { ...event, event: projected } : null;
  }

  /** Stores one event from a participant (idempotent on its device id); returns it with its seq, and whether it was new. */
  async append(userId: string, pairSessionId: string, clientEventId: string, raw: unknown): Promise<{ relayed: RelayedEvent; fresh: boolean }> {
    const event = PairEventSchema.parse(raw);
    return this.deps.db.transaction(async (tx) => {
      // API-2: participation and partner_sharing consent read under the sender's lock, in the writing
      // transaction: a withdrawal (which erases the relay data) either came first or waits for this event.
      await lockUser(tx, userId);
      const { me, all, challenge } = await this.connect(userId, pairSessionId, tx);
      if (event.type === 'bodyweight' && !me.scopes.includes('bodyweight')) throw pairErrors.scope();
      if (event.type === 'score' && !challenge) throw pairErrors.challengeOff();
      const [dup] = await tx.select().from(pairEvents).where(and(eq(pairEvents.pairSessionId, pairSessionId), eq(pairEvents.fromUserId, userId), eq(pairEvents.clientEventId, clientEventId)));
      if (dup) return { relayed: { seq: dup.seq, from: dup.fromSlot, clientEventId, event: PairEventSchema.parse(dup.event) }, fresh: false };
      // One writer at a time per pair session: the session row is locked, so seq has no gap and no fork.
      await tx.select({ id: pairSessions.id }).from(pairSessions).where(eq(pairSessions.id, pairSessionId)).for('update');
      const [head] = await tx.select({ seq: max(pairEvents.seq) }).from(pairEvents).where(eq(pairEvents.pairSessionId, pairSessionId));
      const seq = (head?.seq ?? 0) + 1;
      if (seq > pairValue('maxEventsPerSession')) throw pairErrors.tooMany();
      await tx.insert(pairEvents).values({ pairSessionId, seq, fromUserId: userId, fromSlot: me.slot, clientEventId, event, createdAt: this.deps.now() });
      if (event.type === 'left') await this.recordLeft(tx, pairSessionId, me, all);
      return { relayed: { seq, from: me.slot, clientEventId, event }, fresh: true };
    });
  }

  /** A participant left: their own chain says so; the partner's chain only says the partner left (never why). */
  private async recordLeft(tx: Tx, pairSessionId: string, me: Participation, all: readonly Participation[]) {
    await this.deps.legal.recordPairEvent(me.userId, 'pair.left', { pairSessionId, reason: 'stopped' }, tx);
    const other = all.find((p) => p.slot !== me.slot);
    if (other) await this.deps.legal.recordPairEvent(other.userId, 'pair.partner_left', { pairSessionId }, tx);
  }

  /** Events after `afterSeq`, in order, as the recipient may see them (a reconnect replays what was missed). */
  async since(pairSessionId: string, recipient: Participation, afterSeq: number, all: readonly Participation[]): Promise<{ events: RelayedEvent[]; head: number }> {
    const rows = await this.deps.db.select().from(pairEvents).where(and(eq(pairEvents.pairSessionId, pairSessionId), gt(pairEvents.seq, afterSeq))).orderBy(asc(pairEvents.seq));
    const events = rows.flatMap((r) => {
      const projected = this.project({ seq: r.seq, from: r.fromSlot, clientEventId: r.clientEventId, event: PairEventSchema.parse(r.event) }, recipient.slot, all);
      return projected ? [projected] : [];
    });
    const [head] = await this.deps.db.select({ seq: max(pairEvents.seq) }).from(pairEvents).where(eq(pairEvents.pairSessionId, pairSessionId));
    return { events, head: head?.seq ?? 0 };
  }

  /** M17 export: this person's participations and the events they sent (their own data). */
  async exportFor(userId: string, tx: Tx) {
    const participations = await tx.select().from(pairParticipants).where(eq(pairParticipants.userId, userId)).orderBy(asc(pairParticipants.joinedAt));
    const events = await tx.select().from(pairEvents).where(eq(pairEvents.fromUserId, userId)).orderBy(asc(pairEvents.createdAt), asc(pairEvents.seq));
    return {
      participations: participations.map((p) => ({ pairSessionId: p.pairSessionId, slot: p.slot, displayName: p.displayName, scopes: ScopesSchema.parse(p.scopes), consentVersion: p.consentVersion, joinedAt: p.joinedAt.toISOString() })),
      events: events.map((e) => ({ pairSessionId: e.pairSessionId, seq: e.seq, clientEventId: e.clientEventId, event: PairEventSchema.parse(e.event), createdAt: e.createdAt.toISOString() })),
    };
  }
}

/**
 * partner_sharing withdrawn: the relay stops sharing at once and erases what
 * it holds from that person — their participations and events, and the pair
 * sessions they host (whose relay then goes with them) — in the withdrawal
 * transaction (ADR-004). Their training logs are unaffected.
 */
export function pairWithdrawalHandler(): ConsentWithdrawalHandler {
  return async (tx, userId) => {
    const hosted = await tx.select({ id: pairSessions.id }).from(pairSessions).where(eq(pairSessions.hostUserId, userId));
    await tx.delete(pairEvents).where(or(eq(pairEvents.fromUserId, userId), ...hosted.map((s) => eq(pairEvents.pairSessionId, s.id))));
    await tx.delete(pairParticipants).where(eq(pairParticipants.userId, userId));
    await tx.delete(pairSessions).where(eq(pairSessions.hostUserId, userId));
  };
}
