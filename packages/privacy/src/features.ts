import type { ConsentDataType, ConsentRecord } from '@fitadapt/shared';
import { hasConsent, type ConsentEvaluationOptions } from './consent.js';

/**
 * Features that process a consent-bound data type, and the consents each one
 * needs. A feature is on only while every listed consent is currently granted,
 * so it stays off without consent and switches off on withdrawal.
 *
 * Owning modules register here when they build the feature (M01, M04, M05,
 * M11, M12, M18). Withholding health consent never loosens a safety gate:
 * without screening data the engine treats screening as unresolved (S1 fails
 * closed); see ADR-004.
 */
export const FEATURE_CONSENTS = Object.freeze({
  /** Health screening answers and flags (M01). */
  'health.screening': Object.freeze(['health']),
  /** Pain check-ins and joint ratings (M05). */
  'health.pain_checkins': Object.freeze(['health']),
  /** Progress photos stored encrypted on the device (M04). */
  'photos.progress': Object.freeze(['photos']),
  /** End-to-end encrypted photo backup (M04). */
  'photos.backup': Object.freeze(['photos']),
  /** Import from HealthKit / Health Connect / wearables (M12): wearable and health data. */
  'wearables.import': Object.freeze(['wearables', 'health']),
  /** AI coach conversations (M11). */
  'ai_coach.chat': Object.freeze(['ai_coach']),
  /** Product analytics events (M18). */
  'analytics.product': Object.freeze(['analytics']),
} satisfies Record<string, readonly ConsentDataType[]>);

export type ConsentGatedFeature = keyof typeof FEATURE_CONSENTS;

export const CONSENT_GATED_FEATURES = Object.freeze(Object.keys(FEATURE_CONSENTS) as ConsentGatedFeature[]);

export function requiredConsents(feature: ConsentGatedFeature): readonly ConsentDataType[] {
  return FEATURE_CONSENTS[feature];
}

export function isFeatureEnabled(feature: ConsentGatedFeature, records: readonly ConsentRecord[], options: ConsentEvaluationOptions = {}): boolean {
  return requiredConsents(feature).every((dataType) => hasConsent(records, dataType, options));
}

/** Consents still missing before a feature can switch on. */
export function missingConsents(feature: ConsentGatedFeature, records: readonly ConsentRecord[], options: ConsentEvaluationOptions = {}): ConsentDataType[] {
  return requiredConsents(feature).filter((dataType) => !hasConsent(records, dataType, options));
}

export function enabledFeatures(records: readonly ConsentRecord[], options: ConsentEvaluationOptions = {}): ConsentGatedFeature[] {
  return CONSENT_GATED_FEATURES.filter((feature) => isFeatureEnabled(feature, records, options));
}
