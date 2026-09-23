import { randomUUID } from 'node:crypto';
import {
  DEFAULT_REGISTRY,
  NOTICES,
  acceptanceState,
  buildLegalHoldExport,
  checkAcceptance,
  firstWorkoutGate,
  renderDocument,
  renderNotice,
  sha256Hex,
  versionInForce,
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
import type { Database } from '../db/client.js';
import { consentRecords, legalAcceptances, noticeImpressions } from '../db/schema.js';
import { DefensibilityLog } from './defensibility-log.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export const legalErrors = {
  unknownDocument: () => new ApiError(404, 'legal.unknown_document'),
  notAcceptable: (code: string) => new ApiError(409, code),
  unknownNotice: () => new ApiError(404, 'legal.unknown_notice'),
};

export interface LegalServiceDeps {
  db: Database;
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
}

export interface NoticeInput {
  noticeId: string;
  version: number;
  kind: 'shown' | 'acknowledged';
  locale: Locale;
  jurisdiction: string;
  contentHash: string;
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

  private async acceptances(userId: string): Promise<AcceptanceRecord[]> {
    const rows = await this.deps.db.select().from(legalAcceptances).where(eq(legalAcceptances.userId, userId)).orderBy(asc(legalAcceptances.acceptedAt), asc(legalAcceptances.seq));
    return rows.map((r) => ({
      id: r.id,
      documentId: r.documentId as LegalDocumentId,
      version: r.version,
      locale: r.locale,
      jurisdiction: r.jurisdiction,
      source: r.source,
      contentHash: r.contentHash,
      acceptedAt: r.acceptedAt.toISOString(),
    }));
  }

  private async consents(userId: string): Promise<ConsentRecord[]> {
    const rows = await this.deps.db.select().from(consentRecords).where(eq(consentRecords.userId, userId)).orderBy(asc(consentRecords.recordedAt), asc(consentRecords.seq));
    return rows.map((r) => ({ id: r.id, dataType: r.dataType, decision: r.decision, version: r.version, locale: r.locale, jurisdiction: r.jurisdiction, source: r.source, recordedAt: r.recordedAt.toISOString() }));
  }

  async status(userId: string, jurisdiction: string): Promise<LegalStatus> {
    const ctx = { jurisdiction, now: this.deps.now(), registry: this.registry, consentPolicies: this.deps.consentPolicies };
    const acceptances = await this.acceptances(userId);
    const documents = this.registry.documents.filter((d) => d.kind === 'acceptance').map((d) => acceptanceState(acceptances, d.id, ctx));
    return { jurisdiction, documents, firstWorkout: firstWorkoutGate(acceptances, await this.consents(userId), ctx) };
  }

  /** L2 guard for workout endpoints (M02/M03): throws 403 legal.acceptance_required until the gate is open. */
  async requireFirstWorkoutAcceptance(userId: string, jurisdiction: string): Promise<void> {
    const { firstWorkout } = await this.status(userId, jurisdiction);
    if (!firstWorkout.allowed) throw new ApiError(403, 'legal.acceptance_required');
  }

  async recordAcceptance(userId: string, input: AcceptanceInput): Promise<DocumentAcceptanceState> {
    const now = this.deps.now();
    const check = checkAcceptance({ ...input, documentId: input.documentId as LegalDocumentId }, { jurisdiction: input.jurisdiction, now, registry: this.registry });
    if (!check.ok) throw check.code === 'legal.unknown_document' ? legalErrors.unknownDocument() : legalErrors.notAcceptable(check.code);
    await this.deps.db.transaction(async (tx) => {
      await tx.insert(legalAcceptances).values({ id: randomUUID(), userId, ...input, acceptedAt: now });
      await this.log.append(tx, {
        type: 'acceptance.recorded',
        chain: this.subjectRef(userId),
        occurredAt: now.toISOString(),
        payload: { documentId: input.documentId, version: input.version, locale: input.locale, jurisdiction: input.jurisdiction, contentHash: input.contentHash, source: input.source },
      });
    });
    return acceptanceState(await this.acceptances(userId), input.documentId as LegalDocumentId, { jurisdiction: input.jurisdiction, now, registry: this.registry });
  }

  async recordNotice(userId: string, input: NoticeInput): Promise<void> {
    const def = this.notices.find((n) => n.id === input.noticeId);
    if (!def) throw legalErrors.unknownNotice();
    if (def.version !== input.version) throw legalErrors.notAcceptable('legal.version_not_acceptable');
    if (renderNotice(def, input.locale, input.jurisdiction).contentHash !== input.contentHash) throw legalErrors.notAcceptable('legal.content_mismatch');
    const now = this.deps.now();
    await this.deps.db.transaction(async (tx) => {
      await tx.insert(noticeImpressions).values({ id: randomUUID(), userId, ...input, occurredAt: now });
      await this.log.append(tx, {
        type: input.kind === 'shown' ? 'notice.shown' : 'notice.acknowledged',
        chain: this.subjectRef(userId),
        occurredAt: now.toISOString(),
        payload: { noticeId: input.noticeId as NoticeId, version: input.version, locale: input.locale, jurisdiction: input.jurisdiction, contentHash: input.contentHash },
      });
    });
  }

  /** Called by PrivacyService in the consent transaction (health-data consent is an L2 acceptance). */
  async logConsent(tx: Tx, userId: string, payload: DefensibilityPayload<'consent.recorded'>, at: Date): Promise<void> {
    await this.log.append(tx, { type: 'consent.recorded', chain: this.subjectRef(userId), occurredAt: at.toISOString(), payload });
  }

  /** For the engine and safety modules (M02, M05): a safety gate fired. */
  async recordSafetyEvent(userId: string, payload: DefensibilityPayload<'safety.event'>): Promise<void> {
    await this.log.appendNow({ type: 'safety.event', chain: this.subjectRef(userId), occurredAt: this.deps.now().toISOString(), payload });
  }

  /** For the engine (M02): a prescription with its engine version and reason codes. */
  async recordPrescription(userId: string, payload: DefensibilityPayload<'prescription.issued'>): Promise<void> {
    await this.log.appendNow({ type: 'prescription.issued', chain: this.subjectRef(userId), occurredAt: this.deps.now().toISOString(), payload });
  }

  /**
   * Legal-hold export (L11): logs the access first, places a hold unless one
   * is already active, then returns the subject's whole chain with its
   * verification. Works after account deletion (the log is pseudonymous).
   */
  async legalHoldExport(userId: string, actorRole: string, reasonCode = 'legal_hold_export'): Promise<LegalHoldExport> {
    const chain = this.subjectRef(userId);
    const now = this.deps.now();
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
    return buildLegalHoldExport(chain, await this.log.chain(chain), now.toISOString());
  }
}
