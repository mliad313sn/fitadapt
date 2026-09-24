import { consentState, type ConsentPolicySet } from '@fitadapt/privacy';
import { z } from 'zod';
import { evaluateAgeGate, type CalendarDate } from '@fitadapt/safety';
import type { ConsentDataType, ConsentRecord, Locale } from '@fitadapt/shared';
import {
  DEFAULT_REGISTRY,
  effectiveMinimumAge,
  minimumAcceptedVersion,
  renderDocument,
  upcomingVersion,
  versionInForce,
  type LegalDocument,
  type LegalDocumentId,
  type LegalRegistry,
} from './documents.js';
import { JURISDICTION_MATRIX, jurisdictionProfile } from './jurisdictions.js';

/**
 * Acceptance service (L2). Pure: the same rules run on the device (offline)
 * and on the server. See docs/adr/ADR-008-legal-acceptance-model.md.
 *
 * - Records are append-only; the latest acceptance of a document counts.
 * - An acceptance counts only for the jurisdiction variant it was given in:
 *   a user who moves to a market with different texts accepts again.
 * - A material change raises the minimum accepted version: older
 *   acceptances stop counting once the new version is in force.
 * - A non-material change keeps the acceptance and shows an update notice.
 */
/**
 * FIX-B (B pre-review §1.5 items 1-3): HOW assent was given, not only what. Stored with every acceptance made
 * on a device; an acceptance recorded by another client without it keeps counting (the API adds the server
 * receipt time).
 * - presentation: the screen and flow version that showed the text (e.g. "onboarding.terms@2"); the release
 *   archive keeps a template of each screen per release;
 * - assentMethod: a button shown only after the text was opened, a confirmation of having READ an information
 *   text (Privacy Policy), or statements ticked one by one (exercise risk);
 * - textOpened: the full text was opened before assent;
 * - appBuild: the app version and build that recorded it;
 * - jurisdictionSource: how the country of residence was known (the user confirmed it, or only the device locale);
 * - statementIds: the statements ticked (every statement of the document).
 */
export const JURISDICTION_SOURCES = ['user_confirmed', 'device_locale', 'store_country'] as const;
export type JurisdictionSource = (typeof JURISDICTION_SOURCES)[number];
export const ASSENT_METHODS = ['button_after_open', 'read_acknowledged', 'statements_ticked'] as const;
export const AcceptanceEvidenceSchema = z.strictObject({
  presentation: z.string().regex(/^[a-z][a-z0-9_.-]{0,60}@\d{1,4}$/),
  assentMethod: z.enum(ASSENT_METHODS),
  textOpened: z.boolean(),
  appBuild: z.string().regex(/^[0-9A-Za-z.+_-]{1,40}$/),
  jurisdictionSource: z.enum(JURISDICTION_SOURCES),
  statementIds: z.array(z.string().regex(/^[a-z_]{1,40}$/)).max(20).optional(),
});
export type AcceptanceEvidence = z.infer<typeof AcceptanceEvidenceSchema>;

export interface AcceptanceRecord {
  readonly id: string;
  readonly documentId: LegalDocumentId;
  readonly version: number;
  readonly locale: Locale;
  readonly jurisdiction: string;
  readonly source: 'mobile' | 'web' | 'api';
  /** SHA-256 of the rendered text the user accepted (renderDocument().contentHash). */
  readonly contentHash: string;
  /** Device (or client) time of the acceptance. */
  readonly acceptedAt: string;
  /** FIX-B: how assent was given (absent on records made before it). */
  readonly evidence?: AcceptanceEvidence;
  /** FIX-B: when the server received the record, beside the device time (set by the server only). */
  readonly serverReceivedAt?: string;
}

/** Server side (FIX-B): stamps the receipt time beside the device time; never trusts a client-sent one. */
export function receiveAcceptance(record: AcceptanceRecord, receivedAt: Date): AcceptanceRecord {
  return { ...record, serverReceivedAt: receivedAt.toISOString() };
}

export type AcceptanceStatus = 'accepted' | 'not_accepted' | 'needs_reacceptance';

export interface DocumentAcceptanceState {
  readonly documentId: LegalDocumentId;
  readonly status: AcceptanceStatus;
  readonly versionInForce: number;
  readonly acceptedVersion: number | null;
  /** Accepted, but a newer non-material version exists: tell the user (legal.status.changedMinor). */
  readonly updatedSinceAcceptance: boolean;
  /** A future version is published (advance notice); the user may accept it now. */
  readonly upcomingVersion: number | null;
}

export interface EvaluationContext {
  readonly jurisdiction: string;
  readonly now: Date;
  readonly registry?: LegalRegistry;
  readonly matrix?: typeof JURISDICTION_MATRIX;
}

function latest(records: readonly AcceptanceRecord[], documentId: LegalDocumentId, variant: string, matrix: typeof JURISDICTION_MATRIX) {
  let found: AcceptanceRecord | undefined;
  for (const r of records) {
    if (r.documentId !== documentId || jurisdictionProfile(r.jurisdiction, matrix).variant !== variant) continue;
    if (!found || Date.parse(r.acceptedAt) >= Date.parse(found.acceptedAt)) found = r;
  }
  return found;
}

export function acceptanceState(records: readonly AcceptanceRecord[], documentId: LegalDocumentId, ctx: EvaluationContext): DocumentAcceptanceState {
  const registry = ctx.registry ?? DEFAULT_REGISTRY;
  const matrix = ctx.matrix ?? JURISDICTION_MATRIX;
  const doc = registry.get(documentId);
  if (!doc) throw new Error(`unknown legal document ${documentId}`);
  const inForce = versionInForce(doc, ctx.now);
  const upcoming = upcomingVersion(doc, ctx.now);
  const variant = jurisdictionProfile(ctx.jurisdiction, matrix).variant;
  const record = latest(records, documentId, variant, matrix);
  const minimum = minimumAcceptedVersion(doc, inForce.version);
  const status: AcceptanceStatus = !record ? 'not_accepted' : record.version >= minimum ? 'accepted' : 'needs_reacceptance';
  return {
    documentId,
    status,
    versionInForce: inForce.version,
    acceptedVersion: record?.version ?? null,
    updatedSinceAcceptance: status === 'accepted' && record!.version < inForce.version,
    upcomingVersion: upcoming && (!record || record.version < upcoming.version) ? upcoming.version : null,
  };
}

export type AcceptanceCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: 'legal.unknown_document' | 'legal.not_acceptable' | 'legal.version_not_acceptable' | 'legal.content_mismatch' | 'legal.evidence_invalid' | 'legal.statements_incomplete';
    };

/**
 * Validates an acceptance before it is recorded: the document must be one
 * that is accepted (consents go through the M17 ledger), the version must be
 * in force or upcoming, and the content hash must be the hash of that exact
 * text in that locale and jurisdiction, so the record proves what was shown.
 */
export function checkAcceptance(
  input: Pick<AcceptanceRecord, 'documentId' | 'version' | 'locale' | 'jurisdiction' | 'contentHash'> & { readonly evidence?: unknown },
  ctx: EvaluationContext,
): AcceptanceCheck {
  const registry = ctx.registry ?? DEFAULT_REGISTRY;
  const doc = registry.has(input.documentId) ? registry.get(input.documentId) : undefined;
  if (!doc) return { ok: false, code: 'legal.unknown_document' };
  if (doc.kind !== 'acceptance') return { ok: false, code: 'legal.not_acceptable' };
  const acceptable = [versionInForce(doc, ctx.now), upcomingVersion(doc, ctx.now)].filter((v) => v !== undefined);
  const version = acceptable.find((v) => v.version === input.version);
  if (!version) return { ok: false, code: 'legal.version_not_acceptable' };
  const rendered = renderDocument(doc, version, input.locale, input.jurisdiction, ctx.matrix);
  if (rendered.contentHash !== input.contentHash) return { ok: false, code: 'legal.content_mismatch' };
  if (input.evidence === undefined) return { ok: true };
  // FIX-B: evidence, when sent, must be well formed and consistent with the document.
  const evidence = AcceptanceEvidenceSchema.safeParse(input.evidence);
  if (!evidence.success) return { ok: false, code: 'legal.evidence_invalid' };
  const expected = expectedAssentMethod(doc);
  if (evidence.data.assentMethod !== expected || !evidence.data.textOpened) return { ok: false, code: 'legal.evidence_invalid' };
  if (doc.statements) {
    const ticked = new Set(evidence.data.statementIds ?? []);
    if (!doc.statements.every((s) => ticked.has(s.id)) || ticked.size !== doc.statements.length) return { ok: false, code: 'legal.statements_incomplete' };
  }
  return { ok: true };
}

/** The assent a document asks for (FIX-B): statements ticked, "I have read", or "I accept" after opening the text. */
export function expectedAssentMethod(doc: Pick<LegalDocument, 'statements' | 'assent'>): (typeof ASSENT_METHODS)[number] {
  if (doc.statements && doc.statements.length > 0) return 'statements_ticked';
  return doc.assent === 'read' ? 'read_acknowledged' : 'button_after_open';
}

export interface FirstWorkoutGate {
  readonly allowed: boolean;
  /** Documents still to accept, in display order. */
  readonly missing: readonly LegalDocumentId[];
}

/**
 * L2: Terms, Privacy Policy, health-data consent and the exercise-risk
 * acknowledgment are accepted before the first workout. Consent documents
 * are read from the M17 consent ledger. Fails closed.
 */
export function firstWorkoutGate(
  acceptances: readonly AcceptanceRecord[],
  consents: readonly ConsentRecord[],
  ctx: EvaluationContext & { readonly consentPolicies?: ConsentPolicySet },
): FirstWorkoutGate {
  const registry = ctx.registry ?? DEFAULT_REGISTRY;
  const missing: LegalDocumentId[] = [];
  for (const doc of registry.documents) {
    if (!doc.requiredBeforeFirstWorkout) continue;
    if (doc.kind === 'consent') {
      const dataType = doc.id.slice('consent.'.length) as ConsentDataType;
      const state = consentState(consents, dataType, { jurisdiction: ctx.jurisdiction, policies: ctx.consentPolicies });
      if (!state.granted) missing.push(doc.id);
    } else if (acceptanceState(acceptances, doc.id, ctx).status !== 'accepted') {
      missing.push(doc.id);
    }
  }
  return { allowed: missing.length === 0, missing };
}

export type EligibilityOutcome =
  | { readonly status: 'allowed'; readonly age: number; readonly guardianNeededForPurchase: boolean }
  | { readonly status: 'blocked'; readonly reasonCode: 'safety.s7.under_minimum_age' | 'legal.age.below_jurisdiction_minimum'; readonly minimumAge: number }
  | { readonly status: 'invalid'; readonly reasonCode: 'age_gate.not_a_date' | 'age_gate.in_future' };

/**
 * Jurisdiction-specific age thresholds on top of the S7 gate (which stays
 * the floor and runs first). A local minimum or digital-consent age above 16
 * blocks; below the age of majority, purchases need a parent or guardian.
 */
export function evaluateEligibility(birth: CalendarDate, today: CalendarDate, jurisdiction: string, matrix = JURISDICTION_MATRIX): EligibilityOutcome {
  const minimumAge = effectiveMinimumAge(jurisdiction, matrix);
  const gate = evaluateAgeGate(birth, today, jurisdiction);
  if (gate.status === 'invalid') return gate;
  if (gate.status === 'blocked') return { status: 'blocked', reasonCode: gate.reasonCode, minimumAge };
  if (gate.age < minimumAge) return { status: 'blocked', reasonCode: 'legal.age.below_jurisdiction_minimum', minimumAge };
  const majority = jurisdictionProfile(jurisdiction, matrix).ages.ageOfMajority.value;
  return { status: 'allowed', age: gate.age, guardianNeededForPurchase: gate.age < majority };
}
