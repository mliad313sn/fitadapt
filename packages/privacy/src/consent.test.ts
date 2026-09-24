import { CONSENT_DATA_TYPES, type ConsentDataType, type ConsentRecord } from '@fitadapt/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CONSENT_GATED_FEATURES,
  CONSENT_POLICIES,
  checkDecision,
  consentState,
  consentStates,
  enabledFeatures,
  FEATURE_CONSENTS,
  hasConsent,
  isFeatureEnabled,
  latestRecord,
  missingConsents,
  policyFor,
  resolveJurisdiction,
  type ConsentPolicySet,
} from './index.js';

let seq = 0;
function record(dataType: ConsentDataType, decision: 'granted' | 'withdrawn', at: string, version = 1, jurisdiction = 'FR'): ConsentRecord {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    dataType,
    decision,
    version,
    locale: 'fr',
    jurisdiction,
    source: 'mobile',
    recordedAt: at,
  };
}

const T1 = '2026-09-01T10:00:00.000Z';
const T2 = '2026-09-02T10:00:00.000Z';
const T3 = '2026-09-03T10:00:00.000Z';

describe('consent records are versioned per data type', () => {
  it('nothing is granted by default (opt-in)', () => {
    const states = consentStates([]);
    expect(states.map((s) => s.dataType)).toEqual([...CONSENT_DATA_TYPES]);
    expect(states.every((s) => !s.granted && s.version === null && s.decidedAt === null && !s.needsRenewal)).toBe(true);
  });

  it('each data type is decided independently', () => {
    const records = [record('health', 'granted', T1), record('analytics', 'granted', T1), record('analytics', 'withdrawn', T2)];
    expect(hasConsent(records, 'health')).toBe(true);
    expect(hasConsent(records, 'analytics')).toBe(false);
    expect(hasConsent(records, 'photos')).toBe(false);
    expect(consentState(records, 'health')).toEqual({ dataType: 'health', granted: true, version: 1, currentVersion: 1, needsRenewal: false, decidedAt: T1 });
  });

  it('the latest decision wins, by time and then by order', () => {
    const grant = record('photos', 'granted', T2);
    const withdraw = record('photos', 'withdrawn', T1);
    expect(latestRecord([grant, withdraw], 'photos')).toBe(grant);
    const sameTime = [record('photos', 'granted', T3), record('photos', 'withdrawn', T3)];
    expect(hasConsent(sameTime, 'photos')).toBe(false);
  });

  it('a material change (raised minimum version) requires renewal', () => {
    const policies: ConsentPolicySet = {
      default: { ...CONSENT_POLICIES.default, health: { currentVersion: 2, minimumVersion: 2, documentKey: 'consent.health.v2' } },
      byJurisdiction: {},
    };
    const records = [record('health', 'granted', T1, 1)];
    const state = consentState(records, 'health', { policies });
    expect(state).toMatchObject({ granted: false, needsRenewal: true, version: 1, currentVersion: 2 });
    expect(isFeatureEnabled('health.pain_checkins', records, { policies })).toBe(false);
    const renewed = [...records, record('health', 'granted', T2, 2)];
    expect(consentState(renewed, 'health', { policies })).toMatchObject({ granted: true, needsRenewal: false });
  });

  it('consent texts can differ per jurisdiction', () => {
    const policies: ConsentPolicySet = {
      default: CONSENT_POLICIES.default,
      byJurisdiction: { SN: { health: { currentVersion: 3, minimumVersion: 3, documentKey: 'consent.health.sn.v3' } } },
    };
    expect(policyFor('health', 'SN', policies).documentKey).toBe('consent.health.sn.v3');
    expect(policyFor('health', 'FR', policies).documentKey).toBe('consent.health.v1');
    expect(policyFor('photos', 'SN', policies).currentVersion).toBe(1);
    // A Senegal grant of v1 no longer counts; the same grant in France does.
    expect(hasConsent([record('health', 'granted', T1, 1, 'SN')], 'health', { policies })).toBe(false);
    expect(hasConsent([record('health', 'granted', T1, 1, 'FR')], 'health', { policies })).toBe(true);
    expect(hasConsent([record('health', 'granted', T1, 1, 'FR')], 'health', { policies, jurisdiction: 'SN' })).toBe(false);
  });

  it('new grants must be for the current version; withdrawals are always accepted', () => {
    expect(checkDecision('granted', 'health', 1)).toEqual({ ok: true });
    expect(checkDecision('granted', 'health', 2)).toEqual({ ok: false, code: 'privacy.consent_version_outdated' });
    expect(checkDecision('withdrawn', 'health', 99)).toEqual({ ok: true });
  });

  it('the shipped policy starts at version 1 for every data type and is frozen', () => {
    for (const dataType of CONSENT_DATA_TYPES) {
      expect(CONSENT_POLICIES.default[dataType]).toEqual({ currentVersion: 1, minimumVersion: 1, documentKey: `consent.${dataType}.v1` });
    }
    expect(Object.isFrozen(CONSENT_POLICIES.default)).toBe(true);
  });
});

describe('features stay off without consent and switch off on withdrawal', () => {
  it('every consent-gated feature is off with no consent at all', () => {
    for (const feature of CONSENT_GATED_FEATURES) expect(isFeatureEnabled(feature, [])).toBe(false);
    expect(enabledFeatures([])).toEqual([]);
  });

  it('a feature switches on with its consent and off again on withdrawal', () => {
    const history: ConsentRecord[] = [];
    expect(isFeatureEnabled('ai_coach.chat', history)).toBe(false);
    history.push(record('ai_coach', 'granted', T1));
    expect(isFeatureEnabled('ai_coach.chat', history)).toBe(true);
    history.push(record('ai_coach', 'withdrawn', T2));
    expect(isFeatureEnabled('ai_coach.chat', history)).toBe(false);
  });

  it('a feature needing two consents stays off until both are granted, and off when either is withdrawn', () => {
    const wearables = [record('wearables', 'granted', T1)];
    expect(missingConsents('wearables.import', wearables)).toEqual(['health']);
    expect(isFeatureEnabled('wearables.import', wearables)).toBe(false);
    const both = [...wearables, record('health', 'granted', T2)];
    expect(isFeatureEnabled('wearables.import', both)).toBe(true);
    // M10 adds nutrition.tracking, gated by the health consent.
    expect(enabledFeatures(both)).toEqual(['health.screening', 'health.pain_checkins', 'wearables.import', 'nutrition.tracking']);
    expect(isFeatureEnabled('wearables.import', [...both, record('health', 'withdrawn', T3)])).toBe(false);
  });

  it('consent for one data type never enables another type’s feature', () => {
    for (const dataType of CONSENT_DATA_TYPES) {
      const records = [record(dataType, 'granted', T1)];
      for (const feature of CONSENT_GATED_FEATURES) {
        const needs = FEATURE_CONSENTS[feature] as readonly string[];
        expect({ feature, dataType, on: isFeatureEnabled(feature, records) }).toEqual({
          feature,
          dataType,
          on: needs.length === 1 && needs[0] === dataType,
        });
      }
    }
  });

  it('property: a feature is on iff the latest decision of each required type is a grant', () => {
    const decision = fc.record({
      dataType: fc.constantFrom(...CONSENT_DATA_TYPES),
      decision: fc.constantFrom('granted' as const, 'withdrawn' as const),
    });
    fc.assert(
      fc.property(fc.array(decision, { maxLength: 30 }), fc.constantFrom(...CONSENT_GATED_FEATURES), (decisions, feature) => {
        const records = decisions.map((d, i) => record(d.dataType, d.decision, new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString()));
        const expected = FEATURE_CONSENTS[feature].every((type) => {
          const last = [...decisions].reverse().find((d) => d.dataType === type);
          return last?.decision === 'granted';
        });
        return isFeatureEnabled(feature, records) === expected;
      }),
    );
  });
});

describe('jurisdiction', () => {
  it('normalises region codes and falls back to ZZ', () => {
    expect(resolveJurisdiction('sn')).toBe('SN');
    expect(resolveJurisdiction(' FR ')).toBe('FR');
    expect(resolveJurisdiction('419')).toBe('ZZ');
    expect(resolveJurisdiction(null)).toBe('ZZ');
    expect(resolveJurisdiction(undefined)).toBe('ZZ');
  });
});
