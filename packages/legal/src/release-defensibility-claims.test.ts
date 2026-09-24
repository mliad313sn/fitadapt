import { en, fr } from '@fitadapt/i18n';
import { describe, expect, it } from 'vitest';
import {
  CLAIM_DENYLIST,
  DEFAULT_REGISTRY,
  DEFAULT_RELEASE,
  GLOBAL_CHAIN,
  LegalRegistry,
  LegalReleaseError,
  AUTO_LEGAL_HOLD_REASON,
  MemoryDefensibilityLog,
  automaticLegalHold,
  openLegalHolds,
  NOTICES,
  NOTICES_BLOCKED_UNTIL_BUILT,
  assertLegalReleaseReady,
  blockedNotices,
  buildLegalHoldExport,
  buildProfileFrom,
  catalogueTargets,
  chainEvent,
  eventHash,
  findCodename,
  isApproved,
  lintClaims,
  parsePayload,
  unapprovedTexts,
  validateSubstantiation,
  verifyChain,
  type CounselApproval,
  type DefensibilityEvent,
  type SubstantiationEntry,
} from './index.js';

/** FICTIONAL approvals for a test fixture only — never used by the product. */
const fixtureApproved = (approvals: readonly CounselApproval[]): CounselApproval[] =>
  approvals.map((a) => ({ variant: a.variant, status: 'approved', approvedBy: 'TEST-FIXTURE-SEAT', approvalRecord: 'test/fixture-record.md', approvedOn: '2000-01-01' }));

describe('production build refuses unapproved legal texts', () => {
  it('fails today: every enabled text is a draft pending counsel review', () => {
    const unapproved = unapprovedTexts();
    // FIX-B: notices of features not built (camera_mode) are not even enabled in the default release.
    const texts = DEFAULT_REGISTRY.documents.reduce((sum, d) => sum + d.versions.length, 0) + NOTICES.length - Object.keys(NOTICES_BLOCKED_UNTIL_BUILT).length;
    expect(unapproved).toHaveLength(texts * DEFAULT_RELEASE.variants.length);
    expect(() => assertLegalReleaseReady('production')).toThrow(LegalReleaseError);
    expect(() => assertLegalReleaseReady('production')).toThrow(/lack counsel approval/);
  });

  it('dev and preview builds show drafts; production passes only when every enabled text is approved', () => {
    expect(() => assertLegalReleaseReady('dev')).not.toThrow();
    expect(() => assertLegalReleaseReady('preview')).not.toThrow();
    const approvedRegistry = new LegalRegistry(DEFAULT_REGISTRY.documents.map((d) => ({ ...d, versions: d.versions.map((v) => ({ ...v, approvals: fixtureApproved(v.approvals) })) })));
    const approvedNotices = NOTICES.map((x) => ({ ...x, approvals: fixtureApproved(x.approvals) }));
    expect(() => assertLegalReleaseReady('production', DEFAULT_RELEASE, approvedRegistry, approvedNotices)).not.toThrow();
    // One missing approval (Senegal variant of the Terms) is enough to refuse.
    const oneMissing = new LegalRegistry(approvedRegistry.documents.map((d) => (d.id !== 'terms' ? d : { ...d, versions: d.versions.map((v) => ({ ...v, approvals: v.approvals.map((a) => (a.variant === 'SN' ? { variant: 'SN', status: 'pending' } as const : a)) })) })));
    expect(unapprovedTexts(DEFAULT_RELEASE, oneMissing, approvedNotices)).toEqual([{ text: 'terms v1', variant: 'SN' }]);
    const release = { ...DEFAULT_RELEASE, variants: ['GB'] as const };
    expect(() => assertLegalReleaseReady('production', release, oneMissing, approvedNotices)).not.toThrow();
  });

  it('FIX-B (B pre-review §3.1): the camera_mode notice ("No video leaves your device", SUB-C7) is refused in production even when approved, until M14 exists', () => {
    expect(DEFAULT_RELEASE.notices).not.toContain('camera_mode');
    expect(NOTICES_BLOCKED_UNTIL_BUILT.camera_mode).toMatch(/SUB-C7/);
    const approvedRegistry = new LegalRegistry(DEFAULT_REGISTRY.documents.map((d) => ({ ...d, versions: d.versions.map((v) => ({ ...v, approvals: fixtureApproved(v.approvals) })) })));
    const approvedNotices = NOTICES.map((x) => ({ ...x, approvals: fixtureApproved(x.approvals) }));
    const withCamera = { ...DEFAULT_RELEASE, notices: [...DEFAULT_RELEASE.notices, 'camera_mode' as const] };
    expect(blockedNotices(withCamera)).toHaveLength(DEFAULT_RELEASE.variants.length);
    expect(() => assertLegalReleaseReady('production', withCamera, approvedRegistry, approvedNotices)).toThrow(/camera_mode/);
    expect(() => assertLegalReleaseReady('preview', withCamera, approvedRegistry, approvedNotices)).not.toThrow();
  });

  it('an approval needs a reviewer, a record and a date', () => {
    expect(isApproved([{ variant: 'GB', status: 'approved', approvedBy: ' ', approvalRecord: 'r', approvedOn: 'd' }], 'GB')).toBe(false);
    expect(isApproved([{ variant: 'GB', status: 'pending' }], 'GB')).toBe(false);
    expect(isApproved([], 'GB')).toBe(false);
    expect(() => unapprovedTexts({ ...DEFAULT_RELEASE, documents: ['nope' as never] })).toThrow(/unknown document/);
    expect(() => unapprovedTexts({ ...DEFAULT_RELEASE, notices: ['nope' as never] })).toThrow(/unknown notice/);
  });

  it('maps build variables to a profile and fails closed on unknown values', () => {
    expect(buildProfileFrom({})).toBe('dev');
    expect(buildProfileFrom({ APP_VARIANT: 'dev' })).toBe('dev');
    expect(buildProfileFrom({ APP_VARIANT: 'preview' })).toBe('preview');
    expect(buildProfileFrom({ APP_VARIANT: 'production' })).toBe('production');
    expect(buildProfileFrom({ EAS_BUILD_PROFILE: 'store' })).toBe('production');
  });
});

const SUBJECT = 'a'.repeat(64);
let seq = 0;
const newId = () => `10000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

function sampleLog() {
  const log = new MemoryDefensibilityLog(newId);
  log.append({ type: 'acceptance.recorded', chain: SUBJECT, occurredAt: '2026-09-24T10:00:00.000Z', payload: { documentId: 'terms', version: 1, locale: 'fr', jurisdiction: 'FR', contentHash: 'b'.repeat(64), source: 'mobile' } });
  log.append({ type: 'notice.shown', chain: SUBJECT, occurredAt: '2026-09-24T10:01:00.000Z', payload: { noticeId: 'first_workout', version: 1, locale: 'fr', jurisdiction: 'FR', contentHash: 'c'.repeat(64) } });
  log.append({ type: 'safety.event', chain: SUBJECT, occurredAt: '2026-09-24T10:20:00.000Z', payload: { invariant: 'S3', reasonCode: 'safety.s3.chest_pain', action: 'session_ended', engineVersion: '0.1.0' } });
  log.append({ type: 'prescription.issued', chain: SUBJECT, occurredAt: '2026-09-25T09:00:00.000Z', payload: { prescriptionId: newId(), engineVersion: '0.2.0', reasonCodes: ['load.hold'] } });
  log.append({ type: 'prescription.issued', chain: SUBJECT, occurredAt: '2026-09-24T09:00:00.000Z', payload: { prescriptionId: newId(), engineVersion: '0.1.0', reasonCodes: [] } });
  return log;
}

describe('defensibility log (L11): append-only, hash-chained, tamper-evident', () => {
  it('chains events and verifies', () => {
    const log = sampleLog();
    const events = log.events(SUBJECT);
    expect(events.map((e) => e.chainSeq)).toEqual([1, 2, 3, 4, 5]);
    expect(events[1]!.prevHash).toBe(events[0]!.hash);
    expect(log.verify(SUBJECT)).toEqual({ ok: true, length: 5, head: events[4]!.hash });
    expect(log.verify('empty')).toEqual({ ok: true, length: 0, head: '0'.repeat(64) });
  });

  it('detects an edited payload, a recomputed hash, a removed, reordered or foreign event', () => {
    const events = sampleLog().events(SUBJECT) as DefensibilityEvent[];
    const edited = events.map((e, i) => (i === 2 ? { ...e, payload: { ...e.payload, invariant: 'S2' } } : e)) as DefensibilityEvent[];
    expect(verifyChain(edited)).toEqual({ ok: false, brokenAt: 2, reason: 'hash_mismatch' });
    // Re-hashing the edited event does not help: the next link breaks.
    const rehashed = edited.map((e, i) => (i === 2 ? { ...e, hash: eventHash(e) } : e));
    expect(verifyChain(rehashed)).toEqual({ ok: false, brokenAt: 3, reason: 'link_mismatch' });
    expect(verifyChain([events[0]!, ...events.slice(2)])).toEqual({ ok: false, brokenAt: 1, reason: 'sequence_gap' });
    const swapped = [events[0]!, { ...events[2]!, chainSeq: 2 }, { ...events[1]!, chainSeq: 3 }];
    expect(verifyChain(swapped)).toMatchObject({ ok: false, brokenAt: 1 });
    expect(verifyChain([events[0]!, { ...events[1]!, chain: 'other' }])).toEqual({ ok: false, brokenAt: 1, reason: 'chain_mismatch' });
    const badPayload = [{ ...events[0]!, payload: { ...events[0]!.payload, email: 'x@example.test' } }] as unknown as DefensibilityEvent[];
    expect(verifyChain(badPayload)).toEqual({ ok: false, brokenAt: 0, reason: 'invalid_payload' });
    const badType = [{ ...events[0]!, type: 'nope' }] as unknown as DefensibilityEvent[];
    expect(verifyChain(badType)).toEqual({ ok: false, brokenAt: 0, reason: 'invalid_payload' });
  });

  it('refuses personal data, unknown types, bad timestamps and cross-chain appends', () => {
    expect(() => parsePayload('safety.event', { invariant: 'S3', reasonCode: 'x', action: 'session_ended', engineVersion: '0.1.0', note: 'chest pain after running' })).toThrow();
    expect(() => parsePayload('nope' as never, {})).toThrow(/unknown/);
    const log = new MemoryDefensibilityLog(newId);
    const first = log.append({ type: 'legal_hold.placed', chain: GLOBAL_CHAIN, occurredAt: '2026-09-24T10:00:00.000Z', payload: { holdId: newId(), reasonCode: 'claim_notice' } });
    expect(() => chainEvent(first, { type: 'legal_hold.released', chain: SUBJECT, occurredAt: '2026-09-24T10:00:00.000Z', payload: { holdId: newId(), reasonCode: 'x' } }, newId())).toThrow(/another chain/);
    expect(() => log.append({ type: 'legal_hold.released', chain: GLOBAL_CHAIN, occurredAt: 'yesterday', payload: { holdId: newId(), reasonCode: 'x' } })).toThrow(/timestamp/);
  });

  it('builds a legal-hold export with acceptances, notices, safety events and engine versions', () => {
    const chain = sampleLog().events(SUBJECT);
    const out = buildLegalHoldExport(SUBJECT, chain, '2026-10-01T00:00:00.000Z');
    expect(out.integrity).toMatchObject({ ok: true, length: 5 });
    expect([out.acceptances.length, out.notices.length, out.safetyEvents.length, out.prescriptions.length]).toEqual([1, 1, 1, 2]);
    expect(out.engineVersions).toEqual([
      { engineVersion: '0.1.0', firstSeen: '2026-09-24T09:00:00.000Z', lastSeen: '2026-09-24T10:20:00.000Z', events: 2 },
      { engineVersion: '0.2.0', firstSeen: '2026-09-25T09:00:00.000Z', lastSeen: '2026-09-25T09:00:00.000Z', events: 1 },
    ]);
    expect(verifyChain(out.chain).ok).toBe(true);
    expect(out.programs).toEqual([]);
  });

  it('M08: records generated programs and reflows with engine versions, and nothing personal', () => {
    const log = sampleLog();
    const programId = newId();
    log.append({ type: 'program.generated', chain: SUBJECT, occurredAt: '2026-09-26T09:00:00.000Z', payload: { programId, engineVersion: '0.1.0', rulesVersion: '0.1.0', templateId: 'muscle_gain.3d', reasonCodes: ['program.split.full_body'] } });
    log.append({ type: 'program.reflowed', chain: SUBJECT, occurredAt: '2026-10-02T18:00:00.000Z', payload: { programId, sessionId: 'w01.s3', outcome: 'shifted', engineVersion: '0.1.0' } });
    const out = buildLegalHoldExport(SUBJECT, log.events(SUBJECT), '2026-10-03T00:00:00.000Z');
    expect(out.integrity.ok).toBe(true);
    expect(out.programs.map((e) => e.type)).toEqual(['program.generated', 'program.reflowed']);
    expect(out.engineVersions.find((v) => v.engineVersion === '0.1.0')).toMatchObject({ events: 4, lastSeen: '2026-10-02T18:00:00.000Z' });
    expect(() => parsePayload('program.reflowed', { programId, sessionId: 'w01.s3', outcome: 'shifted', engineVersion: '0.1.0', note: 'missed Friday again' })).toThrow();
    expect(() => parsePayload('program.reflowed', { programId, sessionId: 'w01.s3', outcome: 'moved', engineVersion: '0.1.0' })).toThrow();
    expect(() => parsePayload('program.generated', { programId: 'P3', engineVersion: '0.1.0', rulesVersion: '0.1.0', templateId: 'muscle_gain.3d', reasonCodes: [] })).toThrow();
  });

  it('M02: an executed prescription carries its engine and session-rules versions; an attested review is a safety record', () => {
    const log = sampleLog();
    const prescriptionId = newId();
    log.append({ type: 'prescription.issued', chain: SUBJECT, occurredAt: '2026-09-28T08:00:00.000Z', payload: { prescriptionId, engineVersion: '0.2.0', rulesVersion: '0.1.0', reasonCodes: ['session.program.from_program', 'session.progression.load_increased'] } });
    log.append({ type: 'safety.event', chain: SUBJECT, occurredAt: '2026-09-28T08:40:00.000Z', payload: { invariant: 'S3', reasonCode: 'safety.s3.chest_pain_pressure', action: 'session_ended', engineVersion: '0.2.0' } });
    log.append({ type: 'safety.attested', chain: SUBJECT, occurredAt: '2026-09-30T08:00:00.000Z', payload: { invariant: 'S3', reasonCode: 'safety.s3.medical_review_attested', engineVersion: '0.2.0' } });
    const out = buildLegalHoldExport(SUBJECT, log.events(SUBJECT), '2026-10-03T00:00:00.000Z');
    expect(out.integrity.ok).toBe(true);
    expect(out.prescriptions.at(-1)!.payload).toEqual({ prescriptionId, engineVersion: '0.2.0', rulesVersion: '0.1.0', reasonCodes: ['session.program.from_program', 'session.progression.load_increased'] });
    expect(out.safetyEvents.map((e) => e.type).slice(-2)).toEqual(['safety.event', 'safety.attested']);
    expect(out.engineVersions.find((v) => v.engineVersion === '0.2.0')).toMatchObject({ lastSeen: '2026-09-30T08:00:00.000Z' });
    expect(() => parsePayload('prescription.issued', { prescriptionId, engineVersion: '0.2.0', rulesVersion: 'latest', reasonCodes: [] })).toThrow();
    expect(() => parsePayload('safety.attested', { invariant: 'S3', reasonCode: 'x', engineVersion: '0.2.0', note: 'my doctor said fine' })).toThrow();
    expect(() => parsePayload('safety.attested', { invariant: 'S5', reasonCode: 'x', engineVersion: '0.2.0' })).toThrow();
  });
});

const entry = (phrase: string, locale: SubstantiationEntry['locale'], evidence = 'docs/specs/00-legal-framework.md L1'): SubstantiationEntry => ({
  id: `T-${phrase.slice(0, 8)}`, phrase, locale, kind: 'disclaimer', evidence, scope: 'test', review: 'pending',
});

describe('claims linter (L1)', () => {
  const hits = (text: string, locale: 'en' | 'fr' | 'any', subst: SubstantiationEntry[] = []) =>
    lintClaims([{ source: 't', locale, text }], subst).map((f) => f.ruleId);

  it.each([
    ['This plan will diagnose your weakness', 'en.diagnose'],
    ['Treats back pain', 'en.treat'],
    ['A cure for stiffness', 'en.cure'],
    ['Guaranteed results in 4 weeks', 'en.guarantee'],
    ['Burn fat fast with our HIIT', 'en.burn_fat'],
    ['Stay in the fat-burning zone', 'en.burn_fat'],
    ['Lose 10 kg in 30 days', 'en.lose_x_in_y'],
    ['Helps prevent heart disease', 'en.prevent_disease'],
    ['Clinically proven method', 'en.clinically_proven'],
    ['Melt away fat', 'en.melt_fat'],
    ['Heals your knees', 'en.heal'],
  ])('EN: flags "%s"', (text, rule) => {
    expect(hits(text, 'en')).toContain(rule);
  });

  it.each([
    ['Un diagnostic précis de vos douleurs', 'fr.diagnostic'],
    ['Ce programme traite le mal de dos', 'fr.traiter'],
    ['Guérir vos tendinites', 'fr.guerir'],
    ['Résultats garantis', 'fr.garanti'],
    ['Brûlez les graisses rapidement', 'fr.bruler_graisses'],
    ['La zone de combustion des graisses', 'fr.bruler_graisses'],
    ['Perdez 10 kg en 30 jours', 'fr.perdre_x_en_y'],
    ['Pour prévenir les maladies cardiaques', 'fr.prevenir_maladie'],
    ['Soignez votre dos', 'fr.soigner'],
    ['Maigrir vite', 'fr.maigrir_vite'],
    ['Faites fondre les graisses', 'fr.fondre'],
    ['Méthode cliniquement prouvée', 'fr.cliniquement_prouve'],
  ])('FR: flags "%s"', (text, rule) => {
    expect(hits(text, 'fr')).toContain(rule);
  });

  it.each([
    ['Stay in the fat-burning zone', 'en', 'en.burn_fat'],
    ['Reach maximum lipolysis', 'en', 'en.lipolysis'],
    ['A lipolytic workout', 'en', 'en.lipolysis'],
    ['Your fat loss zone', 'en', 'en.fat_zone'],
    ['Pour une lipolyse maximale', 'fr', 'fr.lipolyse'],
    ['La zone de combustion des graisses', 'fr', 'fr.bruler_graisses'],
    ['La zone brûle-graisse', 'fr', 'fr.bruler_graisses'],
    ['Restez dans la zone de perte de graisse', 'fr', 'fr.zone_graisses'],
    ['La zone d’oxydation des graisses', 'fr', 'fr.zone_graisses'],
  ] as const)('M03 (C9): flags "%s" (%s)', (text, locale, rule) => {
    expect(hits(text, locale)).toContain(rule);
  });

  it('M03 (C9): honest effort wording is not flagged', () => {
    expect(hits('Moderate effort: you can still talk in short sentences. Vigorous minutes count double.', 'en')).toEqual([]);
    expect(hits('Effort modéré : vous pouvez encore parler en phrases courtes.', 'fr')).toEqual([]);
  });

  it('does not flag honest copy, data-processing wording or other languages by locale', () => {
    expect(hits('Every recommendation explains itself. Sessions work offline.', 'en')).toEqual([]);
    expect(hits('Nous traitons vos données de compte pour fournir le service.', 'fr')).toEqual([]);
    expect(hits('Burn fat fast', 'fr')).toEqual([]);
    expect(hits('Burn fat fast — brûlez les graisses', 'any').sort()).toEqual(['en.burn_fat', 'fr.bruler_graisses']);
  });

  it('allows a phrase from the substantiation file, only with evidence and in its locale', () => {
    const text = 'It does not diagnose, treat, cure or prevent any disease.';
    expect(hits(text, 'en').length).toBeGreaterThan(0);
    const d = entry('does not diagnose, treat, cure or prevent any disease', 'en');
    expect(hits(text, 'en', [d])).toEqual([]);
    expect(hits(`${text} It also treats back pain.`, 'en', [d])).toEqual(['en.treat']);
    expect(hits(text, 'en', [{ ...d, evidence: ' ' }]).length).toBeGreaterThan(0);
    expect(hits(text, 'en', [{ ...d, locale: 'fr' }]).length).toBeGreaterThan(0);
    expect(hits(text, 'any', [{ ...d, locale: 'fr' }])).toEqual([]);
    expect(hits(text, 'en', [{ ...d, phrase: '' }]).length).toBeGreaterThan(0);
  });

  it('validates the substantiation entries themselves', () => {
    const ok = entry('x', 'en');
    expect(validateSubstantiation([ok])).toEqual([]);
    expect(validateSubstantiation([ok, { ...ok }, { ...ok, id: '', phrase: ' ', evidence: '', kind: 'x' as never, locale: 'de' as never, review: 'counsel approved' }])).toEqual([
      'T-x: duplicate id',
      '(no id): missing id',
      '(no id): missing phrase',
      '(no id): missing evidence (an entry without evidence does not allow anything)',
      '(no id): kind must be claim or disclaimer',
      '(no id): locale must be en, fr or any',
      '(no id): review status "counsel approved" — only counsel can approve (L5); use "pending"',
    ]);
  });

  it('every rule has an id, a locale and a category; the shipped catalogues only hit the known disclaimers', () => {
    expect(new Set(CLAIM_DENYLIST.map((r) => r.id)).size).toBe(CLAIM_DENYLIST.length);
    const found = lintClaims([...catalogueTargets('en', 'en', en), ...catalogueTargets('fr', 'fr', fr)]);
    const keys = [...new Set(found.map((f) => f.key))].sort();
    // M04: the forecast label "Estimate, not a guarantee" / "Estimation, pas une garantie" (goal condition 7) and its
    // reason-code wording are negative statements the linter sees; substantiation SUB-D5 / SUB-D6 allow them.
    expect(keys).toEqual(['engine.reason.progress.forecast.estimate_only', 'legal.aiNotice.v1.limits', 'legal.terms.v1.about', 'legal.terms.v1.liability', 'progress.forecast.label']);
  });

  it('finds the codename in any spelling', () => {
    expect(findCodename('Welcome to FitAdapt, fit-adapt and Fit Adapt')).toEqual(['FitAdapt', 'fit-adapt', 'Fit Adapt']);
    expect(findCodename('Companion (working title)')).toEqual([]);
  });
});

describe('FIX-B (B pre-review §2 item 3): an incident report places a legal hold automatically', () => {
  const ids = () => {
    let n = 0;
    return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  };
  const SUBJ = 'subject-with-incident';
  const incident = (step: 'received' | 'triaged' | 'closed', incidentId = '00000000-0000-4000-8000-0000000000aa') =>
    ({ type: 'incident.recorded', chain: SUBJ, occurredAt: '2026-10-01T08:00:00.000Z', payload: { incidentId, category: 'injury_report', step } }) as const;

  it('the first report of an incident places one hold; later steps, a closed step or another open hold add none; the chain verifies', () => {
    const log = new MemoryDefensibilityLog(ids());
    log.append({ type: 'notice.shown', chain: SUBJ, occurredAt: '2026-09-30T08:00:00.000Z', payload: { noticeId: 'seek_care', version: 1, locale: 'en', jurisdiction: 'GB', contentHash: 'a'.repeat(64) } });
    log.append(incident('received'));
    log.append(incident('triaged'));
    log.append(incident('closed'));
    const chain = log.events(SUBJ);
    expect(chain.map((e) => e.type)).toEqual(['notice.shown', 'incident.recorded', 'legal_hold.placed', 'incident.recorded', 'incident.recorded']);
    expect(chain[2]!.payload).toMatchObject({ reasonCode: AUTO_LEGAL_HOLD_REASON });
    expect(openLegalHolds(chain).size).toBe(1);
    expect(log.verify(SUBJ)).toMatchObject({ ok: true });
    expect(buildLegalHoldExport(SUBJ, chain, '2026-10-02T00:00:00.000Z').legalHolds).toHaveLength(1);
  });

  it('after counsel released the hold, a new report holds the chain again; a closed step alone never does', () => {
    const log = new MemoryDefensibilityLog(ids());
    log.append(incident('received'));
    const holdId = (log.events(SUBJ)[1]!.payload as { holdId: string }).holdId;
    log.append({ type: 'legal_hold.released', chain: SUBJ, occurredAt: '2026-10-05T08:00:00.000Z', payload: { holdId, reasonCode: 'legal_hold.released.counsel' } });
    expect(openLegalHolds(log.events(SUBJ)).size).toBe(0);
    log.append(incident('closed'));
    expect(openLegalHolds(log.events(SUBJ)).size).toBe(0);
    log.append(incident('received', '00000000-0000-4000-8000-0000000000bb'));
    expect(openLegalHolds(log.events(SUBJ)).size).toBe(1);
    expect(automaticLegalHold([], { type: 'notice.shown', chain: SUBJ, occurredAt: '2026-10-01T08:00:00.000Z', payload: {} as never }, 'x')).toBeNull();
  });
});
