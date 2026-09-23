import {
  CONSENT_DATA_TYPES,
  type ConsentDataType,
  type ConsentRecord,
  type ConsentState,
  type Jurisdiction,
} from '@fitadapt/shared';

/**
 * Consent model (docs/adr/ADR-004-consent-model.md).
 *
 * - Every data type in CONSENT_DATA_TYPES needs its own, explicit, opt-in
 *   consent. Nothing is granted by default.
 * - Records are append-only; the most recent decision for a data type wins.
 * - Each consent text has an integer version. A material change raises
 *   `minimumVersion`: older grants then stop counting (needsRenewal) until
 *   the user accepts the current text again.
 * - Consent wording is owned by M20 (packages/legal); `documentKey` names the
 *   text a version refers to. Texts can differ per jurisdiction.
 */
export interface ConsentTextPolicy {
  /** Version the app shows and the API accepts for new grants. */
  readonly currentVersion: number;
  /** Oldest granted version that still counts (raise it on a material change). */
  readonly minimumVersion: number;
  /** Identifier of the consent text (wording lives in M20's packages/legal). */
  readonly documentKey: string;
}

export type ConsentPolicy = Readonly<Record<ConsentDataType, ConsentTextPolicy>>;

export interface ConsentPolicySet {
  readonly default: ConsentPolicy;
  /** Per-country overrides (ISO 3166-1 alpha-2), e.g. a France-specific text. */
  readonly byJurisdiction: Readonly<Partial<Record<Jurisdiction, Partial<ConsentPolicy>>>>;
}

const v1 = (dataType: ConsentDataType): ConsentTextPolicy =>
  Object.freeze({ currentVersion: 1, minimumVersion: 1, documentKey: `consent.${dataType}.v1` });

/** Version 1 of every consent text. The wording is a draft owned by M20 and requires counsel review. */
export const CONSENT_POLICIES: ConsentPolicySet = Object.freeze({
  default: Object.freeze({
    health: v1('health'),
    photos: v1('photos'),
    wearables: v1('wearables'),
    ai_coach: v1('ai_coach'),
    analytics: v1('analytics'),
  }),
  byJurisdiction: Object.freeze({}),
});

export function policyFor(dataType: ConsentDataType, jurisdiction?: Jurisdiction, policies: ConsentPolicySet = CONSENT_POLICIES): ConsentTextPolicy {
  const override = jurisdiction ? policies.byJurisdiction[jurisdiction]?.[dataType] : undefined;
  return override ?? policies.default[dataType];
}

/** The latest decision for a data type: newest `recordedAt`; on a tie, the later record in the list. */
export function latestRecord(records: readonly ConsentRecord[], dataType: ConsentDataType): ConsentRecord | undefined {
  let latest: ConsentRecord | undefined;
  for (const record of records) {
    if (record.dataType !== dataType) continue;
    if (!latest || Date.parse(record.recordedAt) >= Date.parse(latest.recordedAt)) latest = record;
  }
  return latest;
}

export interface ConsentEvaluationOptions {
  readonly jurisdiction?: Jurisdiction;
  readonly policies?: ConsentPolicySet;
}

export function consentState(records: readonly ConsentRecord[], dataType: ConsentDataType, options: ConsentEvaluationOptions = {}): ConsentState {
  const latest = latestRecord(records, dataType);
  const policy = policyFor(dataType, options.jurisdiction ?? latest?.jurisdiction, options.policies);
  const grantedDecision = latest?.decision === 'granted';
  const current = grantedDecision && latest.version >= policy.minimumVersion;
  return {
    dataType,
    granted: current,
    version: latest?.version ?? null,
    currentVersion: policy.currentVersion,
    needsRenewal: grantedDecision && !current,
    decidedAt: latest?.recordedAt ?? null,
  };
}

export function consentStates(records: readonly ConsentRecord[], options: ConsentEvaluationOptions = {}): ConsentState[] {
  return CONSENT_DATA_TYPES.map((dataType) => consentState(records, dataType, options));
}

export function hasConsent(records: readonly ConsentRecord[], dataType: ConsentDataType, options: ConsentEvaluationOptions = {}): boolean {
  return consentState(records, dataType, options).granted;
}

export type GrantCheck = { ok: true } | { ok: false; code: 'privacy.consent_version_outdated' };

/** A new grant must be for the current text; a withdrawal is always accepted, whatever the version. */
export function checkDecision(
  decision: ConsentRecord['decision'],
  dataType: ConsentDataType,
  version: number,
  jurisdiction?: Jurisdiction,
  policies: ConsentPolicySet = CONSENT_POLICIES,
): GrantCheck {
  if (decision === 'withdrawn') return { ok: true };
  return version === policyFor(dataType, jurisdiction, policies).currentVersion
    ? { ok: true }
    : { ok: false, code: 'privacy.consent_version_outdated' };
}
