import { randomUUID } from 'node:crypto';
import {
  DEFAULT_REGISTRY,
  GLOBAL_CHAIN,
  NOTICES,
  acceptanceState,
  buildLegalHoldExport,
  checkAcceptance,
  receiveAcceptance,
  firstWorkoutGate,
  renderDocument,
  renderNotice,
  sha256Hex,
  versionInForce,
  type AcceptanceEvidence,
  type AcceptanceRecord,
  type DefensibilityPayload,
  type DocumentAcceptanceState,
  type FirstWorkoutGate,
  type LegalDocumentId,
  type LegalHoldExport,
  type LegalRegistry,
  type NoticeDefinition,
  type NoticeId,
  type RenderedDocument,
} from '@fitadapt/legal';
import type { ConsentPolicySet } from '@fitadapt/privacy';
import type { ConsentRecord, Locale } from '@fitadapt/shared';
import { asc, eq } from 'drizzle-orm';
import { keyedHash } from '../auth/crypto.js';
import { ApiError } from '../auth/errors.js';
import type { Database, DbExecutor } from '../db/client.js';
import { consentRecords, legalAcceptances, noticeImpressions } from '../db/schema.js';
import type { RateLimiter } from '../auth/rate-limit.js';
import { privacyValue } from '../config/privacy.config.js';
import { clientTime } from '../lib/client-time.js';
import { DefensibilityLog } from './defensibility-log.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export const legalErrors = {
  unknownDocument: () => new ApiError(404, 'legal.unknown_document'),
  notAcceptable: (code: string) => new ApiError(409, code),
  unknownNotice: () => new ApiError(404, 'legal.unknown_notice'),
  rateLimited: () => new ApiError(429, 'legal.rate_limited'),
};

export interface LegalServiceDeps {
  db: Database;
  /** API-10: acceptances and notices append to never-purged tables and the defensibility log: limited per user. */
  rateLimiter?: RateLimiter;
  pepper: string;
  now: () => Date;
  registry?: LegalRegistry;
  notices?: readonly NoticeDefinition[];
  consentPolicies?: ConsentPolicySet;
}

export interface AcceptanceInput {
  documentId: string;
  version: number;
  locale: Locale;
  jurisdiction: string;
  source: 'mobile' | 'web' | 'api';
  contentHash: string;
  /** M01: device record id (a retried upload is recorded once). */
  id?: string;
  /** M01: when the user accepted on the device (acceptances given offline are uploaded later). */
  acceptedAt?: string;
  /** FIX-B: how assent was given (validated by checkAcceptance, stored with the acceptance). */
  evidence?: AcceptanceEvidence;
}

export interface NoticeInput {
  noticeId: string;
  version: number;
  kind: 'shown' | 'acknowledged';
  locale: Locale;
  jurisdiction: string;
  contentHash: string;
  /** M01: device record id (a retried upload is recorded once). */
  id?: string;
  /** M01: when the notice was shown or acknowledged on the device. */
  occurredAt?: string;
}

export interface LegalStatus {
  jurisdiction: string;
  documents: DocumentAcceptanceState[];
  firstWorkout: FirstWorkoutGate;
}

/**
 * L2 acceptances, L3 notices and the L11 defensibility file on the server
 * (ADR-008, ADR-009). Each record and its pseudonymous log event are written
 * in one transaction: an acceptance without its log entry cannot exist.
 */
export class LegalService {
  readonly log: DefensibilityLog;
  private readonly registry: LegalRegistry;
  private readonly notices: readonly NoticeDefinition[];

  constructor(private readonly deps: LegalServiceDeps) {
    this.log = new DefensibilityLog(deps.db);
    this.registry = deps.registry ?? DEFAULT_REGISTRY;
    this.notices = deps.notices ?? NOTICES;
  }

  /** Same pseudonymous reference as M17's audit entries (keyed hash of the user id). */
  subjectRef(userId: string): string {
    return keyedHash(this.deps.pepper, 'subject', userId);
  }

  document(documentId: string, locale: Locale, jurisdiction: string): RenderedDocument {
    const doc = this.registry.has(documentId) ? this.registry.get(documentId) : undefined;
    if (!doc) throw legalErrors.unknownDocument();
    return renderDocument(doc, versionInForce(doc, this.deps.now()), locale, jurisdiction);
  }

  private async acceptances(userId: string, db: DbExecutor = this.deps.db): Promise<AcceptanceRecord[]> {
    const rows = await db.select().from(legalAcceptances).where(eq(legalAcceptances.userId, userId)).orderBy(asc(legalAcceptances.acceptedAt), asc(legalAcceptances.seq));
    return rows.map((r) => ({
      id: r.id,
      documentId: r.documentId as LegalDocumentId,
      version: r.version,
      locale: r.locale,
      jurisdiction: r.jurisdiction,
      source: r.source,
      contentHash: r.contentHash,
      acceptedAt: r.acceptedAt.toISOString(),
      ...(r.evidence ? { evidence: r.evidence } : {}),
      serverReceivedAt: r.receivedAt.toISOString(),
    }));
  }

  private async consents(userId: string, db: DbExecutor = this.deps.db): Promise<ConsentRecord[]> {
    const rows = await db.select().from(consentRecords).where(eq(consentRecords.userId, userId)).orderBy(asc(consentRecords.recordedAt), asc(consentRecords.seq));
    return rows.map((r) => ({ id: r.id, dataType: r.dataType, decision: r.decision, version: r.version, locale: r.locale, jurisdiction: r.jurisdiction, source: r.source, recordedAt: r.recordedAt.toISOString() }));
  }

  /** `db`: the caller's transaction when the answer gates a write in it (API-1: never a second pooled connection). */
  async status(userId: string, jurisdiction: string, db: DbExecutor = this.deps.db): Promise<LegalStatus> {
    const ctx = { jurisdiction, now: this.deps.now(), registry: this.registry, consentPolicies: this.deps.consentPolicies };
    const acceptances = await this.acceptances(userId, db);
    const documents = this.registry.documents.filter((d) => d.kind === 'acceptance').map((d) => acceptanceState(acceptances, d.id, ctx));
    return { jurisdiction, documents, firstWorkout: firstWorkoutGate(acceptances, await this.consents(userId, db), ctx) };
  }

  /** L2 guard for workout endpoints (M02/M03): throws 403 legal.acceptance_required until the gate is open. */
  async requireFirstWorkoutAcceptance(userId: string, jurisdiction: string, db: DbExecutor = this.deps.db): Promise<void> {
    const { firstWorkout } = await this.status(userId, jurisdiction, db);
    if (!firstWorkout.allowed) throw new ApiError(403, 'legal.acceptance_required');
  }

  private async limit(bucket: string, userId: string, key: 'acceptancesPerWindow' | 'noticesPerWindow') {
    const ok = await this.deps.rateLimiter?.hit(bucket, this.subjectRef(userId), privacyValue(key), privacyValue('privacyRateLimitWindowSeconds'));
    if (ok === false) throw legalErrors.rateLimited();
  }

  async recordAcceptance(userId: string, input: AcceptanceInput): Promise<DocumentAcceptanceState> {
    await this.limit('legal-acceptance', userId, 'acceptancesPerWindow');
    const now = this.deps.now();
    // M01: an acceptance given offline keeps its device time and is checked against the texts in force then.
    const acceptedAt = clientTime(input.acceptedAt, now, 'legal.client_time_out_of_range');
    const { id, acceptedAt: _deviceTime, evidence, ...fields } = input;
    const check = checkAcceptance({ ...fields, documentId: input.documentId as LegalDocumentId, ...(evidence ? { evidence } : {}) }, { jurisdiction: input.jurisdiction, now: acceptedAt, registry: this.registry });
    if (!check.ok) throw check.code === 'legal.unknown_document' ? legalErrors.unknownDocument() : legalErrors.notAcceptable(check.code);
    // FIX-B: the server stamps its own receipt time beside the device time (never a client-sent one).
    const received = receiveAcceptance(
      { id: id ?? randomUUID(), ...fields, documentId: input.documentId as LegalDocumentId, acceptedAt: acceptedAt.toISOString(), ...(evidence ? { evidence } : {}) },
      now,
    );
    await this.deps.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(legalAcceptances)
        .values({ id: received.id, userId, ...fields, acceptedAt, receivedAt: new Date(received.serverReceivedAt!), evidence: received.evidence ?? null })
        .onConflictDoNothing({ target: legalAcceptances.id })
        .returning({ id: legalAcceptances.id });
      if (inserted.length === 0) return; // already recorded (retried upload)
      await this.log.append(tx, {
        type: 'acceptance.recorded',
        chain: this.subjectRef(userId),
        occurredAt: acceptedAt.toISOString(),
        payload: { documentId: input.documentId, version: input.version, locale: input.locale, jurisdiction: input.jurisdiction, contentHash: input.contentHash, source: input.source, ...(evidence ?? {}) },
      });
    });
    return acceptanceState(await this.acceptances(userId), input.documentId as LegalDocumentId, { jurisdiction: input.jurisdiction, now, registry: this.registry });
  }

  async recordNotice(userId: string, input: NoticeInput): Promise<void> {
    const def = this.notices.find((n) => n.id === input.noticeId);
    if (!def) throw legalErrors.unknownNotice();
    if (def.version !== input.version) throw legalErrors.notAcceptable('legal.version_not_acceptable');
    if (renderNotice(def, input.locale, input.jurisdiction).contentHash !== input.contentHash) throw legalErrors.notAcceptable('legal.content_mismatch');
    await this.limit('legal-notice', userId, 'noticesPerWindow');
    const now = this.deps.now();
    const occurredAt = clientTime(input.occurredAt, now, 'legal.client_time_out_of_range');
    const { id, occurredAt: _deviceTime, ...fields } = input;
    await this.deps.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(noticeImpressions)
        .values({ id: id ?? randomUUID(), userId, ...fields, occurredAt, receivedAt: now })
        .onConflictDoNothing({ target: noticeImpressions.id })
        .returning({ id: noticeImpressions.id });
      if (inserted.length === 0) return;
      await this.log.append(tx, {
        type: input.kind === 'shown' ? 'notice.shown' : 'notice.acknowledged',
        chain: this.subjectRef(userId),
        occurredAt: occurredAt.toISOString(),
        payload: { noticeId: input.noticeId as NoticeId, version: input.version, locale: input.locale, jurisdiction: input.jurisdiction, contentHash: input.contentHash },
      });
    });
  }

  /** Called by PrivacyService in the consent transaction (health-data consent is an L2 acceptance). */
  async logConsent(tx: Tx, userId: string, payload: DefensibilityPayload<'consent.recorded'>, at: Date): Promise<void> {
    await this.log.append(tx, { type: 'consent.recorded', chain: this.subjectRef(userId), occurredAt: at.toISOString(), payload });
  }

  /**
   * For the engine and safety modules (M02, M05, M07): a safety gate fired.
   * Pass the transaction of the change the event describes (L11: the change
   * and its event commit together); without one the event is its own
   * transaction, which is only right when no other data is written.
   */
  async recordSafetyEvent(userId: string, payload: DefensibilityPayload<'safety.event'>, tx?: Tx): Promise<void> {
    const input = { type: 'safety.event' as const, chain: this.subjectRef(userId), occurredAt: this.deps.now().toISOString(), payload };
    await (tx ? this.log.append(tx, input) : this.log.appendNow(input));
  }

  /** For the engine (M02, M07): a prescription with its engine and rules versions and reason codes; same transaction rule as recordSafetyEvent (M02's sync listener always passes the sync transaction). */
  async recordPrescription(userId: string, payload: DefensibilityPayload<'prescription.issued'>, tx?: Tx): Promise<void> {
    const input = { type: 'prescription.issued' as const, chain: this.subjectRef(userId), occurredAt: this.deps.now().toISOString(), payload };
    await (tx ? this.log.append(tx, input) : this.log.appendNow(input));
  }

  /** M02 (S3 hook): the user attested the review that lifts a safety lock; written with the record that carries the attestation. */
  async recordSafetyAttested(userId: string, payload: DefensibilityPayload<'safety.attested'>, tx: Tx): Promise<void> {
    await this.log.append(tx, { type: 'safety.attested', chain: this.subjectRef(userId), occurredAt: this.deps.now().toISOString(), payload });
  }

  /**
   * M08: a stored program (engine and rules versions, template) or a reflow the
   * engine decided. Always written with the transaction of the record it
   * describes (ADR-009: the change and its event commit together), so there is
   * no variant without one.
   */
  async recordProgramGenerated(userId: string, payload: DefensibilityPayload<'program.generated'>, tx: Tx): Promise<void> {
    await this.log.append(tx, { type: 'program.generated', chain: this.subjectRef(userId), occurredAt: this.deps.now().toISOString(), payload });
  }

  async recordProgramReflowed(userId: string, payload: DefensibilityPayload<'program.reflowed'>, tx: Tx): Promise<void> {
    await this.log.append(tx, { type: 'program.reflowed', chain: this.subjectRef(userId), occurredAt: this.deps.now().toISOString(), payload });
  }

  /** M10: a nutrition target the engine prescribed (versions, mode, codes; never a value), with the transaction of the stored plan (ADR-009). */
  async recordNutritionTarget(userId: string, payload: DefensibilityPayload<'nutrition.target_set'>, tx: Tx): Promise<void> {
    await this.log.append(tx, { type: 'nutrition.target_set', chain: this.subjectRef(userId), occurredAt: this.deps.now().toISOString(), payload });
  }

  /**
   * M09 Fair Pair: a participant's own pair event (joined, challenge started,
   * left, partner left), in their own chain, always with the transaction of
   * the pair data it describes (ADR-009). A partner's chain never receives
   * the other person's reason for leaving.
   */
  async recordPairEvent<T extends 'pair.joined' | 'pair.timeline_built' | 'pair.challenge_started' | 'pair.left' | 'pair.partner_left'>(userId: string, type: T, payload: DefensibilityPayload<T>, tx: Tx): Promise<void> {
    await this.log.append(tx, { type, chain: this.subjectRef(userId), occurredAt: this.deps.now().toISOString(), payload } as Parameters<DefensibilityLog['append']>[1]);
  }

  /**
   * Legal-hold export (L11): logs the access first, places a hold unless one
   * is already active, then returns the subject's whole chain with its
   * verification. Works after account deletion (the log is pseudonymous).
   */
  async legalHoldExport(userId: string, actorRole: string, reasonCode = 'legal_hold_export'): Promise<LegalHoldExport> {
    const chain = this.subjectRef(userId);
    const now = this.deps.now();
    try {
      await this.deps.db.transaction(async (tx) => {
        const existing = await this.log.chain(chain, tx);
        await this.log.append(tx, {
          type: 'log.accessed',
          chain,
          occurredAt: now.toISOString(),
          payload: { actorRole, purpose: 'legal_hold_export', subjectDigest: sha256Hex(chain), eventsReturned: existing.length + 1 },
        });
        if (!(await this.log.isHeld(chain, tx))) {
          await this.log.append(tx, { type: 'legal_hold.placed', chain, occurredAt: now.toISOString(), payload: { holdId: randomUUID(), reasonCode } });
        }
      });
    } catch (error) {
      // PKG-01: the database refuses to extend a chain whose rows no longer match its anchored head
      // (restrict_violation). The export is then the evidence of tampering: the access is logged in
      // the global chain instead, and the export reports the break.
      if (pgCode(error) !== '23001') throw error;
      const existing = await this.log.chain(chain);
      await this.log.appendNow({
        type: 'log.accessed',
        chain: GLOBAL_CHAIN,
        occurredAt: now.toISOString(),
        payload: { actorRole, purpose: 'legal_hold_export', subjectDigest: sha256Hex(chain), eventsReturned: existing.length },
      });
    }
    const { events, head } = await this.log.snapshot(chain);
    return buildLegalHoldExport(chain, events, now.toISOString(), head);
  }
}

/** SQLSTATE of a PostgreSQL error, also when drizzle wraps it in `cause`. */
function pgCode(error: unknown): string | undefined {
  for (let e: unknown = error, depth = 0; e && typeof e === 'object' && depth < 3; e = (e as { cause?: unknown }).cause, depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}
