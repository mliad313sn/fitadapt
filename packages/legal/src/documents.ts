import { createTranslator, type MessageKey, type MessageValues } from '@fitadapt/i18n';
import { CONSENT_DATA_TYPES, type ConsentDataType, type Locale } from '@fitadapt/shared';
import { DOCUMENT_VARIANTS, jurisdictionProfile, type DocumentVariant, JURISDICTION_MATRIX } from './jurisdictions.js';
import { sha256Hex } from './sha256.js';

/**
 * Versioned legal documents (L2). The wording lives in packages/i18n
 * (`legal.*` keys, FR and EN); this registry holds structure, versions,
 * per-jurisdiction variants and counsel approval status.
 *
 * EVERY VERSION IS A DRAFT THAT REQUIRES COUNSEL REVIEW. Approval status is
 * `pending` for every variant; nothing here may be marked approved except by
 * a change that adds the counsel sign-off record (docs/legal/counsel-signoff-tracker.md).
 */
export type ConsentDocumentId = `consent.${ConsentDataType}`;
export type LegalDocumentId =
  | 'terms'
  | 'privacy'
  | 'exercise_risk'
  | 'ai_notice'
  | 'subscription_terms'
  | 'community_guidelines'
  | ConsentDocumentId;

/** A section is one message, or a message per jurisdiction variant (with a default). */
export type SectionRef = MessageKey | { readonly byVariant: Partial<Record<DocumentVariant, MessageKey>>; readonly default: MessageKey };

export type CounselApproval =
  | { readonly variant: DocumentVariant; readonly status: 'pending' }
  | {
      readonly variant: DocumentVariant;
      readonly status: 'approved';
      /** Counsel seat or firm reference (never added by an engineer or an AI assistant). */
      readonly approvedBy: string;
      /** Path of the signed approval record. */
      readonly approvalRecord: string;
      readonly approvedOn: string;
    };

export interface DocumentVersion {
  readonly version: number;
  /** A material change requires re-acceptance of documents that are accepted. */
  readonly material: boolean;
  /** ISO date (YYYY-MM-DD). */
  readonly publishedOn: string;
  /** ISO date from which this version applies. */
  readonly effectiveFrom: string;
  /** Internal note for counsel (not user-facing). */
  readonly changeSummary: string;
  readonly title: MessageKey;
  readonly sections: readonly SectionRef[];
  readonly approvals: readonly CounselApproval[];
}

export type AcceptanceKind =
  /** Accepted with a recorded acceptance (AcceptanceRecord). */
  | 'acceptance'
  /** Granted through the M17 consent ledger (ConsentRecord), which already stores version, locale, jurisdiction and time. */
  | 'consent'
  /** Shown for information only (no acceptance recorded). */
  | 'information';

export interface LegalDocument {
  readonly id: LegalDocumentId;
  /** Internal name for counsel (not user-facing). */
  readonly name: string;
  readonly kind: AcceptanceKind;
  /** L2: must be accepted (or consented) before the first workout. */
  readonly requiredBeforeFirstWorkout: boolean;
  /** Material changes must be published `materialChangeNoticeDays` before they apply. */
  readonly requiresAdvanceNotice: boolean;
  readonly versions: readonly DocumentVersion[];
}

const pendingEverywhere = (): readonly CounselApproval[] => DOCUMENT_VARIANTS.map((variant) => ({ variant, status: 'pending' as const }));

const perVariant = (prefix: string): SectionRef => ({
  byVariant: {
    EU_FR: `${prefix}.EU_FR` as MessageKey,
    GB: `${prefix}.GB` as MessageKey,
    US: `${prefix}.US` as MessageKey,
    SN: `${prefix}.SN` as MessageKey,
    CI: `${prefix}.CI` as MessageKey,
  },
  default: `${prefix}.DEFAULT` as MessageKey,
});

const V1_DATE = '2026-09-23';
const v1 = (title: MessageKey, sections: SectionRef[]): DocumentVersion => ({
  version: 1,
  material: true,
  publishedOn: V1_DATE,
  effectiveFrom: V1_DATE,
  changeSummary: 'First draft (M20). Requires counsel review in every jurisdiction.',
  title,
  sections,
  approvals: pendingEverywhere(),
});

const consentDocument = (dataType: ConsentDataType, name: string, requiredBeforeFirstWorkout: boolean): LegalDocument => ({
  id: `consent.${dataType}`,
  name,
  kind: 'consent',
  requiredBeforeFirstWorkout,
  requiresAdvanceNotice: false,
  versions: [
    v1(`legal.consent.${dataType}.v1.title` as MessageKey, [`legal.consent.${dataType}.v1.body` as MessageKey, `legal.consent.${dataType}.v1.withdraw` as MessageKey]),
  ],
});

export const LEGAL_DOCUMENTS: readonly LegalDocument[] = Object.freeze([
  {
    id: 'terms',
    name: 'Terms of Use',
    kind: 'acceptance',
    requiredBeforeFirstWorkout: true,
    requiresAdvanceNotice: true,
    versions: [
      v1('legal.terms.v1.title', [
        'legal.terms.v1.about',
        'legal.terms.v1.eligibility',
        'legal.terms.v1.risk',
        'legal.terms.v1.control',
        'legal.terms.v1.aiCoach',
        'legal.terms.v1.subscriptions',
        'legal.terms.v1.conduct',
        'legal.terms.v1.liability',
        'legal.terms.v1.changes',
        perVariant('legal.terms.v1.law'),
        'legal.terms.v1.contact',
      ]),
    ],
  },
  {
    id: 'privacy',
    name: 'Privacy Policy',
    kind: 'acceptance',
    requiredBeforeFirstWorkout: true,
    requiresAdvanceNotice: true,
    versions: [
      v1('legal.privacy.v1.title', [
        'legal.privacy.v1.controller',
        'legal.privacy.v1.data',
        'legal.privacy.v1.purposes',
        'legal.privacy.v1.health',
        'legal.privacy.v1.retention',
        'legal.privacy.v1.transfers',
        'legal.privacy.v1.rights',
        perVariant('legal.privacy.v1.authority'),
        'legal.privacy.v1.changes',
      ]),
    ],
  },
  consentDocument('health', 'Health-data consent', true),
  consentDocument('photos', 'Progress photos consent', false),
  consentDocument('wearables', 'Wearables and health apps consent', false),
  consentDocument('ai_coach', 'AI coach consent', false),
  consentDocument('analytics', 'Usage statistics consent', false),
  {
    id: 'exercise_risk',
    name: 'Exercise-risk acknowledgment',
    kind: 'acceptance',
    requiredBeforeFirstWorkout: true,
    requiresAdvanceNotice: false,
    versions: [
      v1('legal.exerciseRisk.v1.title', ['legal.exerciseRisk.v1.risk', 'legal.exerciseRisk.v1.stop', 'legal.exerciseRisk.v1.clearance', 'legal.exerciseRisk.v1.control']),
    ],
  },
  {
    id: 'ai_notice',
    name: 'AI coach notice',
    kind: 'information',
    requiredBeforeFirstWorkout: false,
    requiresAdvanceNotice: false,
    versions: [v1('legal.aiNotice.v1.title', ['legal.aiNotice.v1.disclosure', 'legal.aiNotice.v1.limits', 'legal.aiNotice.v1.boundary', 'legal.aiNotice.v1.human'])],
  },
  {
    id: 'subscription_terms',
    name: 'Subscription and refund terms',
    kind: 'acceptance',
    requiredBeforeFirstWorkout: false,
    requiresAdvanceNotice: true,
    versions: [
      v1('legal.subscription.v1.title', [
        'legal.subscription.v1.prices',
        'legal.subscription.v1.renewal',
        'legal.subscription.v1.cancel',
        perVariant('legal.subscription.v1.withdrawal'),
        'legal.subscription.v1.refunds',
      ]),
    ],
  },
  {
    id: 'community_guidelines',
    name: 'Community guidelines',
    kind: 'acceptance',
    requiredBeforeFirstWorkout: false,
    requiresAdvanceNotice: false,
    versions: [v1('legal.community.v1.title', ['legal.community.v1.respect', 'legal.community.v1.health', 'legal.community.v1.content', 'legal.community.v1.report'])],
  },
] satisfies LegalDocument[]);

export class LegalRegistry {
  private readonly byId: ReadonlyMap<LegalDocumentId, LegalDocument>;
  constructor(readonly documents: readonly LegalDocument[] = LEGAL_DOCUMENTS) {
    this.byId = new Map(documents.map((d) => [d.id, d]));
  }
  get(id: LegalDocumentId): LegalDocument | undefined {
    return this.byId.get(id);
  }
  has(id: string): id is LegalDocumentId {
    return this.byId.has(id as LegalDocumentId);
  }
}

export const DEFAULT_REGISTRY = new LegalRegistry();

export const CONSENT_DOCUMENT_IDS: readonly ConsentDocumentId[] = CONSENT_DATA_TYPES.map((t) => `consent.${t}` as const);

const toDate = (isoDate: string) => Date.parse(`${isoDate}T00:00:00.000Z`);

/** The version in force at `now`: the latest whose effectiveFrom has passed (the first version if none has). */
export function versionInForce(doc: LegalDocument, now: Date): DocumentVersion {
  const sorted = [...doc.versions].sort((a, b) => a.version - b.version);
  let current = sorted[0]!;
  for (const v of sorted) if (toDate(v.effectiveFrom) <= now.getTime()) current = v;
  return current;
}

/** The latest published version that is not yet in force (advance notice period), if any. */
export function upcomingVersion(doc: LegalDocument, now: Date): DocumentVersion | undefined {
  const inForce = versionInForce(doc, now);
  return [...doc.versions]
    .filter((v) => v.version > inForce.version && toDate(v.publishedOn) <= now.getTime())
    .sort((a, b) => b.version - a.version)[0];
}

/** Oldest version whose acceptance still counts at `version`: the latest material version up to it. */
export function minimumAcceptedVersion(doc: LegalDocument, version: number): number {
  let minimum = 1;
  for (const v of doc.versions) if (v.version <= version && v.material) minimum = Math.max(minimum, v.version);
  return minimum;
}

export const resolveSection = (section: SectionRef, variant: DocumentVariant): MessageKey =>
  typeof section === 'string' ? section : (section.byVariant[variant] ?? section.default);

export interface RenderedDocument {
  readonly documentId: LegalDocumentId;
  readonly version: number;
  readonly locale: Locale;
  readonly variant: DocumentVariant;
  readonly draftBanner: string;
  readonly title: string;
  readonly sections: readonly { readonly key: MessageKey; readonly text: string }[];
  /** SHA-256 of exactly what the user sees; stored with every acceptance (proof of what was shown). */
  readonly contentHash: string;
}

export function documentValues(jurisdiction: string, matrix = JURISDICTION_MATRIX): MessageValues {
  return { minimumAge: effectiveMinimumAge(jurisdiction, matrix) };
}

/** Minimum age where the user lives: S7's 16, raised by a local minimum or digital-consent age. */
export function effectiveMinimumAge(jurisdiction: string, matrix = JURISDICTION_MATRIX): number {
  const p = jurisdictionProfile(jurisdiction, matrix);
  return Math.max(16, p.ages.minimumAge.value, p.ages.digitalConsentAge?.value ?? 0);
}

export function renderDocument(
  doc: LegalDocument,
  version: DocumentVersion,
  locale: Locale,
  jurisdiction: string,
  matrix = JURISDICTION_MATRIX,
): RenderedDocument {
  const t = createTranslator(locale);
  const variant = jurisdictionProfile(jurisdiction, matrix).variant;
  const values = documentValues(jurisdiction, matrix);
  const title = t.t(version.title, values);
  const sections = version.sections.map((s) => {
    const key = resolveSection(s, variant);
    return { key, text: t.t(key, values) };
  });
  const draftBanner = t.t('legal.draft.banner');
  const contentHash = sha256Hex([draftBanner, title, ...sections.map((s) => s.text)].join('\n\n'));
  return { documentId: doc.id, version: version.version, locale, variant, draftBanner, title, sections, contentHash };
}

/** Every message key a document version can show, across all variants. */
export function versionKeys(version: DocumentVersion): MessageKey[] {
  const keys: MessageKey[] = [version.title];
  for (const s of version.sections) {
    if (typeof s === 'string') keys.push(s);
    else keys.push(s.default, ...Object.values(s.byVariant));
  }
  return keys;
}

/** Structural checks on a registry; empty means valid. `noticeDays` is legalConfig.materialChangeNoticeDays. */
export function validateRegistry(registry: LegalRegistry, noticeDays: number): string[] {
  const problems: string[] = [];
  for (const doc of registry.documents) {
    const versions = [...doc.versions].sort((a, b) => a.version - b.version);
    versions.forEach((v, i) => {
      if (v.version !== i + 1) problems.push(`${doc.id}: versions must be 1..n without gaps`);
      if (toDate(v.effectiveFrom) < toDate(v.publishedOn)) problems.push(`${doc.id} v${v.version}: effective before it is published`);
      if (i > 0 && v.material && doc.requiresAdvanceNotice && toDate(v.effectiveFrom) - toDate(v.publishedOn) < noticeDays * 86_400_000) {
        problems.push(`${doc.id} v${v.version}: material change needs ${noticeDays} days of advance notice`);
      }
      for (const variant of DOCUMENT_VARIANTS) {
        if (!v.approvals.some((a) => a.variant === variant)) problems.push(`${doc.id} v${v.version}: no approval entry for ${variant}`);
      }
    });
  }
  return problems;
}
