import { createHash } from 'node:crypto';
import { en, fr } from '@fitadapt/i18n';
import { CONSENT_POLICIES } from '@fitadapt/privacy';
import { CONSENT_DATA_TYPES, type ConsentRecord } from '@fitadapt/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  AI_PERSISTENT_LABEL,
  CONSENT_DOCUMENT_IDS,
  DEFAULT_REGISTRY,
  DOCUMENT_VARIANTS,
  JURISDICTION_MATRIX,
  LEGAL_DOCUMENTS,
  LEGAL_UNVALIDATED,
  LegalRegistry,
  NOTICES,
  acceptanceState,
  canonicalJson,
  checkAcceptance,
  effectiveMinimumAge,
  evaluateEligibility,
  firstWorkoutGate,
  jurisdictionProfile,
  legalConfig,
  legalValue,
  matrixConfigValues,
  minimumAcceptedVersion,
  notice,
  noticesToShow,
  renderDocument,
  renderNotice,
  sha256Hex,
  upcomingVersion,
  validateRegistry,
  variantFor,
  versionInForce,
  versionKeys,
  type AcceptanceRecord,
  type DocumentVersion,
  type JurisdictionProfile,
  type LegalDocument,
  type NoticeImpression,
} from './index.js';

const NOW = new Date('2026-10-01T12:00:00.000Z');
let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

function accept(documentId: AcceptanceRecord['documentId'], version: number, jurisdiction = 'FR', locale: 'fr' | 'en' = 'fr', at = '2026-09-24T10:00:00.000Z', registry = DEFAULT_REGISTRY): AcceptanceRecord {
  const doc = registry.get(documentId)!;
  const v = doc.versions.find((x) => x.version === version)!;
  return { id: id(), documentId, version, locale, jurisdiction, source: 'mobile', contentHash: renderDocument(doc, v, locale, jurisdiction).contentHash, acceptedAt: at };
}

const consent = (dataType: ConsentRecord['dataType'], decision: 'granted' | 'withdrawn' = 'granted', at = '2026-09-24T10:00:00.000Z'): ConsentRecord => ({
  id: id(), dataType, decision, version: 1, locale: 'fr', jurisdiction: 'FR', source: 'mobile', recordedAt: at,
});

describe('sha256 and canonical JSON', () => {
  it('matches node:crypto on known vectors and random strings', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 300 }), (s) => sha256Hex(s) === createHash('sha256').update(s, 'utf8').digest('hex')),
      { numRuns: 500 },
    );
  });

  it('serialises objects with sorted keys and rejects values JSON cannot round-trip', () => {
    expect(canonicalJson({ b: 1, a: [true, null, 'x'], c: undefined, d: { z: 1, y: 2 } })).toBe('{"a":[true,null,"x"],"b":1,"d":{"y":2,"z":1}}');
    expect(() => canonicalJson(Number.NaN)).toThrow();
    expect(() => canonicalJson(undefined)).toThrow();
  });
});

describe('jurisdiction matrix', () => {
  it('covers every market of the legal framework and unknown markets get the strictest defaults', () => {
    expect(Object.keys(JURISDICTION_MATRIX).sort()).toEqual(['CI', 'FR', 'GB', 'SN', 'US', 'ZZ']);
    expect(jurisdictionProfile('de').code).toBe('ZZ');
    expect(jurisdictionProfile(null).variant).toBe('DEFAULT');
    expect(variantFor('fr')).toBe('EU_FR');
  });

  it('every number has a source and is not validated; every authority filing is open', () => {
    const values = matrixConfigValues();
    expect(values.length).toBeGreaterThan(10);
    for (const { value } of values) expect({ source: value.source.length > 0, validated: value.validated }).toEqual({ source: true, validated: false });
    for (const p of Object.values(JURISDICTION_MATRIX)) for (const f of p.authorityFilings) expect(f.status).toBe('open');
    expect(LEGAL_UNVALIDATED).toEqual(Object.keys(legalConfig).sort());
    expect(legalValue('materialChangeNoticeDays')).toBe(30);
  });

  it('emergency numbers are shown only where configured; otherwise generic guidance', () => {
    // FIX-B (CS-2): the line is unconditional ("call now" triggers are in the notice body), not "if this is an emergency".
    const seek = notice('seek_care');
    expect(renderNotice(seek, 'en', 'GB').emergency).toBe('Emergency number: call 999.');
    // FIX-B (CS-6): France shows 15 (SAMU) beside 112.
    expect(renderNotice(seek, 'fr', 'FR').emergency).toBe('Numéro d’urgence : appelez le 15 (urgences médicales) ou le 112.');
    // Senegal: the unconfirmed SAMU numbers (validated:false) always come with the generic guidance.
    expect(renderNotice(seek, 'fr', 'SN').emergency).toBe('Numéro d’urgence : appelez le 1515 ou le 15 (urgences médicales). Si vous n’arrivez pas à joindre ce numéro, appelez le numéro d’urgence local.');
    expect(renderNotice(seek, 'fr', 'DE').emergency).toBe('Numéro d’urgence : appelez le numéro d’urgence local.');
    expect(renderNotice(notice('first_workout'), 'en', 'US').emergency).toBeNull();
  });
});

describe('document registry', () => {
  it('is structurally valid and every version is a pending draft in every variant', () => {
    expect(validateRegistry(DEFAULT_REGISTRY, legalValue('materialChangeNoticeDays'))).toEqual([]);
    for (const doc of LEGAL_DOCUMENTS) for (const v of doc.versions) {
      expect(v.approvals.map((a) => a.variant).sort()).toEqual([...DOCUMENT_VARIANTS].sort());
      expect(v.approvals.every((a) => a.status === 'pending')).toBe(true);
    }
    for (const n2 of NOTICES) expect(n2.approvals.every((a) => a.status === 'pending')).toBe(true);
  });

  it('every text exists in FR and EN', () => {
    const keys = [...LEGAL_DOCUMENTS.flatMap((d) => d.versions.flatMap(versionKeys)), ...NOTICES.flatMap((x) => [x.title, x.body]), AI_PERSISTENT_LABEL, 'legal.draft.banner'];
    for (const key of keys) expect({ key, en: key in en, fr: key in fr }).toEqual({ key, en: true, fr: true });
  });

  it('has one consent document per M17 data type, matching the consent policy version and documentKey', () => {
    expect(CONSENT_DOCUMENT_IDS).toEqual(CONSENT_DATA_TYPES.map((t) => `consent.${t}`));
    for (const t of CONSENT_DATA_TYPES) {
      const doc = DEFAULT_REGISTRY.get(`consent.${t}`)!;
      const policy = CONSENT_POLICIES.default[t];
      expect(versionInForce(doc, NOW).version).toBe(policy.currentVersion);
      expect(`${doc.id}.v${policy.currentVersion}`).toBe(policy.documentKey);
    }
  });

  it('renders per locale and jurisdiction, with the draft banner, and hashes exactly what is shown', () => {
    const terms = DEFAULT_REGISTRY.get('terms')!;
    const v = terms.versions[0]!;
    const frFR = renderDocument(terms, v, 'fr', 'FR');
    const enGB = renderDocument(terms, v, 'en', 'GB');
    expect(frFR.draftBanner).toMatch(/requires counsel review/);
    expect(enGB.draftBanner).toMatch(/requires counsel review/);
    expect(frFR.sections.map((s) => s.key)).toContain('legal.terms.v1.law.EU_FR');
    expect(enGB.sections.map((s) => s.key)).toContain('legal.terms.v1.law.GB');
    expect(renderDocument(terms, v, 'en', 'DE').sections.map((s) => s.key)).toContain('legal.terms.v1.law.DEFAULT');
    expect(frFR.sections[1]!.text).toContain('16 ans');
    expect(new Set([frFR.contentHash, enGB.contentHash, renderDocument(terms, v, 'en', 'FR').contentHash]).size).toBe(3);
    expect(renderDocument(terms, v, 'fr', 'FR').contentHash).toBe(frFR.contentHash);
  });

  it('flags gaps, missing approvals and material changes without advance notice', () => {
    const base = DEFAULT_REGISTRY.get('terms')!;
    const v2: DocumentVersion = { ...base.versions[0]!, version: 3, publishedOn: '2026-10-01', effectiveFrom: '2026-10-10', approvals: [] };
    const bad = new LegalRegistry([{ ...base, versions: [base.versions[0]!, v2] }, { ...base, id: 'privacy', versions: [{ ...base.versions[0]!, effectiveFrom: '2026-01-01' }] }]);
    expect(validateRegistry(bad, 30)).toEqual([
      'terms: versions must be 1..n without gaps',
      'terms v3: material change needs 30 days of advance notice',
      ...DOCUMENT_VARIANTS.map((x) => `terms v3: no approval entry for ${x}`),
      'privacy v1: effective before it is published',
    ]);
  });
});

/** A registry with a material v2 and a non-material v3 of the Terms, for re-acceptance tests. */
function registryWithChanges(): LegalRegistry {
  const base = DEFAULT_REGISTRY.get('terms')!;
  const v1 = base.versions[0]!;
  const terms: LegalDocument = {
    ...base,
    versions: [
      v1,
      { ...v1, version: 2, material: true, publishedOn: '2026-10-01', effectiveFrom: '2026-11-01', changeSummary: 'fixture' },
      { ...v1, version: 3, material: false, publishedOn: '2026-12-01', effectiveFrom: '2026-12-01', changeSummary: 'fixture' },
    ],
  };
  return new LegalRegistry(DEFAULT_REGISTRY.documents.map((d) => (d.id === 'terms' ? terms : d)));
}

describe('acceptance service (L2)', () => {
  it('records acceptance per document; nothing is accepted by default', () => {
    expect(acceptanceState([], 'terms', { jurisdiction: 'FR', now: NOW }).status).toBe('not_accepted');
    const s = acceptanceState([accept('terms', 1)], 'terms', { jurisdiction: 'FR', now: NOW });
    expect(s).toEqual({ documentId: 'terms', status: 'accepted', versionInForce: 1, acceptedVersion: 1, updatedSinceAcceptance: false, upcomingVersion: null });
    expect(() => acceptanceState([], 'nope' as never, { jurisdiction: 'FR', now: NOW })).toThrow();
  });

  it('requires re-acceptance on a material change once it is in force, with advance notice before', () => {
    const registry = registryWithChanges();
    const records = [accept('terms', 1, 'FR', 'fr', '2026-09-24T10:00:00.000Z', registry)];
    const before = acceptanceState(records, 'terms', { jurisdiction: 'FR', now: new Date('2026-10-15T00:00:00Z'), registry });
    expect(before).toMatchObject({ status: 'accepted', versionInForce: 1, upcomingVersion: 2 });
    const after = acceptanceState(records, 'terms', { jurisdiction: 'FR', now: new Date('2026-11-02T00:00:00Z'), registry });
    expect(after).toMatchObject({ status: 'needs_reacceptance', versionInForce: 2, acceptedVersion: 1 });
    const reaccepted = [...records, accept('terms', 2, 'FR', 'fr', '2026-11-03T00:00:00.000Z', registry)];
    expect(acceptanceState(reaccepted, 'terms', { jurisdiction: 'FR', now: new Date('2026-11-04T00:00:00Z'), registry }).status).toBe('accepted');
    // v3 is not material: the v2 acceptance still counts, the user is told about the update.
    expect(acceptanceState(reaccepted, 'terms', { jurisdiction: 'FR', now: new Date('2026-12-02T00:00:00Z'), registry })).toMatchObject({
      status: 'accepted', versionInForce: 3, updatedSinceAcceptance: true,
    });
    expect(minimumAcceptedVersion(registry.get('terms')!, 3)).toBe(2);
    expect(upcomingVersion(registry.get('terms')!, new Date('2026-12-02T00:00:00Z'))).toBeUndefined();
  });

  it('an acceptance counts only in the jurisdiction variant it was given in', () => {
    const records = [accept('terms', 1, 'FR')];
    expect(acceptanceState(records, 'terms', { jurisdiction: 'GB', now: NOW }).status).toBe('not_accepted');
    expect(acceptanceState(records, 'terms', { jurisdiction: 'FR', now: NOW }).status).toBe('accepted');
  });

  it('accepts only the version in force or upcoming, with the hash of the exact text shown', () => {
    const registry = registryWithChanges();
    const ctx = { jurisdiction: 'FR', now: new Date('2026-10-15T00:00:00Z'), registry };
    const r1 = accept('terms', 1, 'FR', 'fr', undefined, registry);
    const r2 = accept('terms', 2, 'FR', 'fr', undefined, registry);
    expect(checkAcceptance(r1, ctx)).toEqual({ ok: true });
    expect(checkAcceptance(r2, ctx)).toEqual({ ok: true });
    expect(checkAcceptance({ ...r1, version: 3 }, ctx)).toEqual({ ok: false, code: 'legal.version_not_acceptable' });
    expect(checkAcceptance({ ...r1, locale: 'en' }, ctx)).toEqual({ ok: false, code: 'legal.content_mismatch' });
    expect(checkAcceptance({ ...r1, jurisdiction: 'GB' }, ctx)).toEqual({ ok: false, code: 'legal.content_mismatch' });
    expect(checkAcceptance({ ...r1, documentId: 'nope' as never }, ctx)).toEqual({ ok: false, code: 'legal.unknown_document' });
    expect(checkAcceptance({ ...r1, documentId: 'consent.health' }, ctx)).toEqual({ ok: false, code: 'legal.not_acceptable' });
  });

  it('first workout needs Terms, Privacy, health consent and the exercise-risk acknowledgment (fails closed)', () => {
    const ctx = { jurisdiction: 'FR', now: NOW };
    expect(firstWorkoutGate([], [], ctx)).toEqual({ allowed: false, missing: ['terms', 'privacy', 'consent.health', 'exercise_risk'] });
    const acc = [accept('terms', 1), accept('privacy', 1), accept('exercise_risk', 1)];
    expect(firstWorkoutGate(acc, [], ctx)).toEqual({ allowed: false, missing: ['consent.health'] });
    expect(firstWorkoutGate(acc, [consent('health')], ctx)).toEqual({ allowed: true, missing: [] });
    expect(firstWorkoutGate(acc, [consent('health'), consent('health', 'withdrawn', '2026-09-25T00:00:00.000Z')], ctx).allowed).toBe(false);
    expect(firstWorkoutGate(acc, [consent('analytics')], ctx).allowed).toBe(false);
  });
});

describe('jurisdiction-specific age thresholds', () => {
  const today = { year: 2026, month: 10, day: 1 };
  const born = (years: number) => ({ year: 2026 - years, month: 6, day: 1 });
  const withProfile = (overrides: Partial<JurisdictionProfile['ages']>) => {
    const zz = JURISDICTION_MATRIX.ZZ!;
    return { ...JURISDICTION_MATRIX, XA: { ...zz, code: 'XA', ages: { ...zz.ages, ...overrides } } } as typeof JURISDICTION_MATRIX;
  };

  it('keeps S7 (16) as the floor everywhere', () => {
    for (const code of Object.keys(JURISDICTION_MATRIX)) {
      expect(effectiveMinimumAge(code)).toBeGreaterThanOrEqual(16);
      expect(evaluateEligibility(born(15), today, code)).toEqual({ status: 'blocked', reasonCode: 'safety.s7.under_minimum_age', minimumAge: effectiveMinimumAge(code) });
    }
    expect(evaluateEligibility(born(16), today, 'FR')).toEqual({ status: 'allowed', age: 16, guardianNeededForPurchase: true });
    const lower = withProfile({ minimumAge: { value: 16, source: 't', validated: false }, digitalConsentAge: { value: 13, source: 't', validated: false } });
    expect(effectiveMinimumAge('XA', lower)).toBe(16);
  });

  it('a higher local minimum or digital-consent age blocks users the S7 gate would allow', () => {
    const m = withProfile({ minimumAge: { value: 18, source: 'test fixture', validated: false } });
    expect(evaluateEligibility(born(17), today, 'XA', m)).toEqual({ status: 'blocked', reasonCode: 'legal.age.below_jurisdiction_minimum', minimumAge: 18 });
    expect(evaluateEligibility(born(18), today, 'XA', m).status).toBe('allowed');
    const dc = withProfile({ digitalConsentAge: { value: 17, source: 'test fixture', validated: false } });
    expect(evaluateEligibility(born(16), today, 'XA', dc)).toMatchObject({ status: 'blocked', minimumAge: 17 });
    expect(renderDocument(DEFAULT_REGISTRY.get('terms')!, DEFAULT_REGISTRY.get('terms')!.versions[0]!, 'en', 'XA', m).sections[1]!.text).toContain('at least 18 years old');
  });

  it('needs a guardian for purchases below the local age of majority', () => {
    expect(evaluateEligibility(born(18), today, 'FR')).toMatchObject({ guardianNeededForPurchase: false });
    expect(evaluateEligibility(born(19), today, 'US')).toMatchObject({ guardianNeededForPurchase: true });
    expect(evaluateEligibility(born(21), today, 'US')).toMatchObject({ guardianNeededForPurchase: false });
  });

  it('passes invalid dates through as invalid', () => {
    expect(evaluateEligibility({ year: 2030, month: 1, day: 1 }, today, 'FR')).toEqual({ status: 'invalid', reasonCode: 'age_gate.in_future' });
  });

  it('refuses a matrix row that would lower the S7 floor', async () => {
    const mod = await import('./jurisdictions.js');
    expect(mod.JURISDICTION_MATRIX.FR!.ages.minimumAge.value).toBe(16);
  });
});

describe('point-of-risk notices (L3, L5)', () => {
  const impression = (noticeId: NoticeImpression['noticeId'], kind: NoticeImpression['kind'], version = 1): NoticeImpression => ({ noticeId, version, kind, locale: 'en', jurisdiction: 'GB', occurredAt: NOW.toISOString() });

  it('covers first workout, HIIT, assessment, nutrition deficit, AI coach and camera mode', () => {
    expect(NOTICES.map((x) => x.trigger).sort()).toEqual(
      // M09 adds the Fair Challenge between partners (legal risk register: injury during a partner challenge).
      // FIX-B adds the pregnancy warning signs (CS-4) and the urgent joint or back signs (CS-5).
      ['ai_coach.conversation_start', 'assessment.start', 'camera.start', 'hiit.start', 'nutrition.deficit_setup', 'pair.challenge.start', 'safety.red_flag', 'safety.pregnancy_warning', 'safety.urgent_msk', 'workout.start'].sort(),
    );
  });

  it('shows once-per-version notices until acknowledged, and again for a new version', () => {
    expect(noticesToShow('workout.start', []).map((x) => x.id)).toEqual(['first_workout']);
    expect(noticesToShow('workout.start', [impression('first_workout', 'shown')]).map((x) => x.id)).toEqual(['first_workout']);
    expect(noticesToShow('workout.start', [impression('first_workout', 'acknowledged')])).toEqual([]);
    const v2 = NOTICES.map((x) => (x.id === 'first_workout' ? { ...x, version: 2 } : x));
    expect(noticesToShow('workout.start', [impression('first_workout', 'acknowledged')], v2).map((x) => x.id)).toEqual(['first_workout']);
  });

  it('discloses the AI at the start of every conversation and every assessment shows its notice', () => {
    expect(noticesToShow('ai_coach.conversation_start', [impression('ai_coach', 'shown'), impression('ai_coach', 'acknowledged')]).map((x) => x.id)).toEqual(['ai_coach']);
    expect(noticesToShow('assessment.start', [impression('assessment', 'acknowledged')]).map((x) => x.id)).toEqual(['assessment']);
    expect(en[AI_PERSISTENT_LABEL]).toBe('AI assistant');
    expect(renderNotice(notice('ai_coach'), 'fr', 'FR').title).toBe('Vous échangez avec une IA');
  });

  it('a notice that needs no acknowledgement counts as done once shown', () => {
    const custom = [{ ...notice('camera_mode'), requiresAcknowledgement: false }];
    expect(noticesToShow('camera.start', [impression('camera_mode', 'shown')], custom)).toEqual([]);
  });
});
