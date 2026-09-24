import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { SCREENING_QUESTION_IDS, type SafetyProfile, type ScreeningQuestionId, type ScreeningRecord, type ScreeningResponses } from '@fitadapt/shared';
import {
  AMBIGUOUS_SCREENING_REASON,
  evaluateScreening,
  intensityLockStatus,
  isAtLeastAsStrict,
  jointFlagsFromPain,
  lastScreenedAt,
  notScreenedSafetyProfile,
  orderScreenings,
  safetyProfileFromScreenings,
  screeningHeads,
  strictestSafetyProfile,
  type PainReport,
  type SafetyStopEvent,
  type ScreeningEntry,
} from './index.js';

// Property runs are CPU-bound; the whole workspace runs in parallel (fresh-clone gate): no 5 s default.
vi.setConfig({ testTimeout: 120_000 });

/**
 * FIX-latest-record-ordering (ADR-023): adversarial properties over
 * histories with duplicate timestamps, shuffled arrival order and device
 * clocks that go backwards. The selected SafetyProfile, joint flag and S3
 * lock are never looser than the correct ones. Fictional data only.
 */

const BASE = Date.parse('2026-09-24T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

const arbAnswers = fc.record(Object.fromEntries(SCREENING_QUESTION_IDS.map((q) => [q, fc.constantFrom('yes' as const, 'no' as const)])) as Record<ScreeningQuestionId, fc.Arbitrary<'yes' | 'no'>>);
const arbResponses: fc.Arbitrary<ScreeningResponses> = fc.record({
  answers: arbAnswers,
  clearanceAttested: fc.boolean(),
  birthDate: fc.record({ year: fc.integer({ min: 1950, max: 2012 }), month: fc.integer({ min: 1, max: 12 }), day: fc.integer({ min: 1, max: 28 }) }),
  answeredOn: fc.constant({ year: 2026, month: 9, day: 24 }),
  limitations: fc.subarray([{ region: 'knee' as const }, { region: 'lumbar' as const }]),
  excludedExerciseIds: fc.subarray(['sample_move', 'other_move']),
});
/** Device clock readings: duplicates (a frozen clock) and jumps back and forth (a clock moved back). */
const arbClock = fc.integer({ min: -3, max: 3 }).map((s) => s * 1000);

const record = (responses: ScreeningResponses, at: number, supersedes: string[] | undefined): ScreeningRecord => ({
  reason: 'annual',
  responses,
  safetyProfile: evaluateScreening(responses),
  completedAt: iso(BASE + at),
  ...(supersedes === undefined ? {} : { supersedes }),
});

/**
 * One device writing a history: each screening names the heads it knew
 * (what the device store does). Returns the entries in writing order.
 */
function writeLinked(steps: readonly { responses: ScreeningResponses; at: number }[]): ScreeningEntry[] {
  const out: ScreeningEntry[] = [];
  for (const [i, s] of steps.entries()) out.push({ id: uuid(i + 1), data: record(s.responses, s.at, screeningHeads(out)) });
  return out;
}

const arbSteps = fc.array(fc.record({ responses: arbResponses, at: arbClock }), { minLength: 1, maxLength: 7 });

describe('screenings: the latest counts, whatever the clock and the arrival order', () => {
  it('linked history, any timestamps (equal or going backwards), any arrival order → exactly the profile of the screening written last', () => {
    fc.assert(
      fc.property(arbSteps, fc.infiniteStream(fc.nat()), (steps, seeds) => {
        const history = writeLinked(steps);
        const truth = evaluateScreening(steps.at(-1)!.responses);
        const shuffled = [...history].map((e) => ({ e, k: seeds.next().value })).sort((a, b) => a.k - b.k).map((x) => x.e);
        expect(safetyProfileFromScreenings(shuffled)).toEqual(truth);
        expect(orderScreenings(shuffled).ordered.map((e) => e.id)).toEqual(history.map((e) => e.id));
      }),
      { numRuns: 1000 },
    );
  });

  it('the PO case: two screenings in the same millisecond, the second advised against calorie restriction → deficit features off', () => {
    const answers = (yes: ScreeningQuestionId[]) => Object.fromEntries(SCREENING_QUESTION_IDS.map((q) => [q, yes.includes(q) ? 'yes' : 'no'])) as ScreeningResponses['answers'];
    const r = (yes: ScreeningQuestionId[]): ScreeningResponses => ({ answers: answers(yes), clearanceAttested: false, birthDate: { year: 1988, month: 3, day: 14 }, answeredOn: { year: 2026, month: 9, day: 24 }, limitations: [], excludedExerciseIds: [] });
    const history = writeLinked([
      { responses: r([]), at: 0 },
      { responses: r(['advised_against_calorie_restriction']), at: 0 },
    ]);
    for (const list of [history, [...history].reverse()]) expect(safetyProfileFromScreenings(list).deficitNutritionAllowed).toBe(false);
    // Legacy records (no links) in the same millisecond are ambiguous: fail closed, never the looser one.
    const legacy = history.map((e) => ({ id: e.id, data: { ...e.data, supersedes: undefined } }));
    for (const list of [legacy, [...legacy].reverse()]) {
      const p = safetyProfileFromScreenings(list);
      expect(p.deficitNutritionAllowed).toBe(false);
      expect(p.reasonCodes).toContain(AMBIGUOUS_SCREENING_REASON);
    }
  });

  it('two devices offline (concurrent re-screens): never looser than either; the next screening resolves the fork', () => {
    fc.assert(
      fc.property(arbSteps, arbResponses, arbResponses, arbResponses, arbClock, arbClock, (steps, a, b, c, ta, tb) => {
        const shared = writeLinked(steps);
        const heads = screeningHeads(shared);
        const onA = { id: uuid(100), data: record(a, ta, heads) };
        const onB = { id: uuid(200), data: record(b, tb, heads) };
        const merged = [...shared, onB, onA];
        const p = safetyProfileFromScreenings(merged);
        expect(isAtLeastAsStrict(p, evaluateScreening(a))).toBe(true);
        expect(isAtLeastAsStrict(p, evaluateScreening(b))).toBe(true);
        expect(safetyProfileFromScreenings([onA, ...shared, onB])).toEqual(p);
        const next = { id: uuid(300), data: record(c, -9000, screeningHeads(merged)) };
        expect(safetyProfileFromScreenings([next, ...merged])).toEqual(evaluateScreening(c));
      }),
      { numRuns: 2000 },
    );
  });

  it('legacy histories (no links) with duplicate timestamps are never looser than the screening written last', () => {
    fc.assert(
      fc.property(fc.array(fc.record({ responses: arbResponses, gap: fc.constantFrom(0, 0, 1000) }), { minLength: 1, maxLength: 6 }), fc.infiniteStream(fc.nat()), (steps, seeds) => {
        let t = 0;
        const history: ScreeningEntry[] = steps.map((s, i) => ({ id: uuid(i + 1), data: record(s.responses, (t += s.gap), undefined) }));
        const shuffled = history.map((e) => ({ e, k: seeds.next().value })).sort((x, y) => x.k - y.k).map((x) => x.e);
        expect(isAtLeastAsStrict(safetyProfileFromScreenings(shuffled), evaluateScreening(steps.at(-1)!.responses))).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });

  it('upgrade: a linked screening after legacy ones (clock moved back) is the latest', () => {
    fc.assert(
      fc.property(arbSteps, arbResponses, (steps, fresh) => {
        const legacy: ScreeningEntry[] = steps.map((s, i) => ({ id: uuid(i + 1), data: record(s.responses, i * 1000, undefined) }));
        const heads = screeningHeads(legacy);
        const next = { id: uuid(99), data: record(fresh, -5000, heads) };
        expect(safetyProfileFromScreenings([next, ...legacy])).toEqual(evaluateScreening(fresh));
        expect(lastScreenedAt([next, ...legacy])).toBe(next.data.completedAt);
      }),
      { numRuns: 1000 },
    );
  });

  it('strictestSafetyProfile is never looser than any input and is the input when there is one', () => {
    fc.assert(
      fc.property(fc.array(arbResponses, { minLength: 1, maxLength: 4 }), (list) => {
        const profiles = list.map(evaluateScreening);
        const merged = strictestSafetyProfile(profiles);
        for (const p of profiles) expect(isAtLeastAsStrict(merged, p)).toBe(true);
        expect(isAtLeastAsStrict(strictestSafetyProfile([...profiles].reverse()), merged)).toBe(true);
        if (profiles.length === 1) expect(merged).toBe(profiles[0]);
      }),
      { numRuns: 2000 },
    );
  });

  it('no screening → not screened; several heads → the earliest completion (re-screen due soonest)', () => {
    expect(safetyProfileFromScreenings([])).toEqual(notScreenedSafetyProfile('safety_profile.not_screened.incomplete'));
    expect(strictestSafetyProfile([])).toEqual(notScreenedSafetyProfile());
    expect(lastScreenedAt([])).toBeNull();
    const r = fc.sample(arbResponses, { numRuns: 1, seed: 7 })[0]!;
    const two = [
      { id: uuid(1), data: record(r, 5000, []) },
      { id: uuid(2), data: record(r, 1000, []) },
    ];
    expect(lastScreenedAt(two)).toBe(iso(BASE + 1000));
    expect(lastScreenedAt([...two].reverse())).toBe(iso(BASE + 1000));
  });

  it('isAtLeastAsStrict notices every looser field', () => {
    const strict: SafetyProfile = { ...notScreenedSafetyProfile(), avoidTags: ['inversion'], excludedExerciseIds: ['sample_move'], unresolvedFlags: ['chest_discomfort'], limitedJoints: ['knee'], lowIntensityLibraryOnly: true, professionalGuidance: true, specialPopulation: 'pregnancy_postpartum' };
    const looser: Partial<SafetyProfile>[] = [
      { maxRPE: 10 },
      { allowHIIT: true },
      { allowMaxTests: true },
      { impactCeiling: 'high' },
      { avoidTags: [] },
      { excludedExerciseIds: [] },
      { screeningOutcome: 'cleared' },
      { unresolvedFlags: [] },
      { deficitNutritionAllowed: true },
      { specialPopulation: 'none' },
      { automaticProgrammingAllowed: true },
      { lowIntensityLibraryOnly: false },
      { professionalGuidance: false },
      { limitedJoints: [] },
    ];
    expect(isAtLeastAsStrict(strict, strict)).toBe(true);
    for (const patch of looser) {
      expect(isAtLeastAsStrict({ ...strict, ...patch }, strict)).toBe(false);
      expect(isAtLeastAsStrict(strict, { ...strict, ...patch })).toBe(true);
    }
  });
});

// ------------------------------------------------------------------------ S3

type StopStep = { kind: 'red_flag' | 'medical_review_attested'; clock: number };
const arbStops = fc.array(fc.record({ kind: fc.constantFrom('red_flag' as const, 'medical_review_attested' as const), clock: arbClock }), { maxLength: 10 });

/** A device writing S3 events: flags carry an id, attestations name every flag known (what the device store does). */
function writeStops(steps: readonly StopStep[]): SafetyStopEvent[] {
  const out: SafetyStopEvent[] = [];
  steps.forEach((s, i) => {
    const at = iso(BASE + s.clock);
    if (s.kind === 'red_flag') out.push({ kind: 'red_flag', at, id: uuid(i + 1) });
    else out.push({ kind: 'medical_review_attested', at, attests: out.filter((e) => e.kind === 'red_flag').map((e) => e.id!) });
  });
  return out;
}
/** The truth: locked iff a red flag was written after the last attestation. */
const trulyLocked = (steps: readonly StopStep[]) => {
  const lastFlag = steps.map((s) => s.kind).lastIndexOf('red_flag');
  return lastFlag > steps.map((s) => s.kind).lastIndexOf('medical_review_attested');
};

describe('S3: a red flag is never unlocked by an older attestation, whatever the clock and the order', () => {
  it('truly locked → locked, for any timestamps (equal or backwards) and any order (as written, sorted by the device clock, shuffled)', () => {
    fc.assert(
      fc.property(arbStops, fc.infiniteStream(fc.nat()), (steps, seeds) => {
        const events = writeStops(steps);
        const byClock = events.map((e, i) => ({ e, i })).sort((a, b) => a.e.at.localeCompare(b.e.at) || a.i - b.i).map((x) => x.e);
        const shuffled = events.map((e) => ({ e, k: seeds.next().value })).sort((a, b) => a.k - b.k).map((x) => x.e);
        for (const list of [events, byClock, shuffled]) if (trulyLocked(steps)) expect(intensityLockStatus(list).locked).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });

  it('the regression case: an old attestation dated after a new red flag (clock moved back) does not lift it', () => {
    const events: SafetyStopEvent[] = [
      { kind: 'red_flag', at: iso(BASE), id: uuid(1) },
      { kind: 'medical_review_attested', at: iso(BASE + 10_000), attests: [uuid(1)] },
      { kind: 'red_flag', at: iso(BASE + 5_000), id: uuid(2) },
    ];
    const byClock = [...events].sort((a, b) => a.at.localeCompare(b.at));
    expect(intensityLockStatus(byClock)).toEqual({ locked: true, since: iso(BASE + 5_000) });
    // Without ids (records stored before ADR-023) the order-by-clock reading could not tell.
    expect(intensityLockStatus(byClock.map(({ kind, at }) => ({ kind, at }))).locked).toBe(false);
    // An attestation that names it lifts it.
    expect(intensityLockStatus([...events, { kind: 'medical_review_attested', at: iso(BASE + 20_000), attests: [uuid(1), uuid(2)] }])).toEqual({ locked: false, since: null });
  });
});

// ------------------------------------------------------------------------ S2

type PainStep = { score: number; session: number; clock: number; phase: 'during' | 'after_session' | 'next_morning' };
const arbPain = fc.array(
  fc.record({ score: fc.integer({ min: 0, max: 10 }), session: fc.integer({ min: 0, max: 5 }), clock: fc.integer({ min: -3, max: 3 }), phase: fc.constantFrom('during' as const, 'after_session' as const, 'next_morning' as const) }),
  { maxLength: 10 },
);
const sessionId = (n: number) => (n === 0 ? null : uuid(1000 + n));

/** Sessions only move forward in real life: a later report's session is never an earlier one (renumbered in order of first use). */
function realistic(steps: readonly PainStep[]): PainStep[] {
  const firstUse = new Map<number, number>();
  let current = 0;
  return steps.map((s) => {
    if (s.session === 0) return s;
    if (!firstUse.has(s.session)) firstUse.set(s.session, ++current);
    return { ...s, session: Math.max(firstUse.get(s.session)!, current) };
  });
}

/** What a device writes: each report names the previous report of the joint (one writer, a linear chain). */
function writePain(steps: readonly PainStep[], clockOf: (s: PainStep, i: number) => number): PainReport[] {
  return steps.map((s, i) => ({ joint: 'knee', score: s.score, at: iso(BASE + clockOf(s, i)), phase: s.phase, sessionId: sessionId(s.session), id: uuid(i + 1), after: i === 0 ? [] : [uuid(i)] }));
}

describe('S2: a red joint is never cleared by a report written before it or unaware of it, whatever the clock and the order', () => {
  it('red in truth (written order, real clock) → red for any device timestamps (equal or backwards) and any order', () => {
    fc.assert(
      fc.property(arbPain, fc.infiniteStream(fc.nat()), (raw, seeds) => {
        const steps = realistic(raw);
        const truth = jointFlagsFromPain(writePain(steps, (_, i) => i * 3_600_000)).knee;
        const device = writePain(steps, (s) => s.clock * 1000);
        const byClock = device.map((r, i) => ({ r, i })).sort((a, b) => a.r.at.localeCompare(b.r.at) || a.i - b.i).map((x) => x.r);
        const shuffled = device.map((r) => ({ r, k: seeds.next().value })).sort((a, b) => a.k - b.k).map((x) => x.r);
        if (truth === 'red') for (const list of [device, byClock, shuffled]) expect(jointFlagsFromPain(list).knee).toBe('red');
      }),
      { numRuns: 10_000 },
    );
  });

  it('the regression case: an old green of a later session, dated after a new red, does not clear it', () => {
    const green: PainReport = { joint: 'knee', score: 1, at: iso(BASE + 10_000), phase: 'during', sessionId: uuid(1001), id: uuid(1), after: [] };
    const red: PainReport = { joint: 'knee', score: 7, at: iso(BASE + 5_000), phase: 'during', sessionId: uuid(1002), id: uuid(2), after: [uuid(1)] };
    expect(jointFlagsFromPain([red, green]).knee).toBe('red');
    // Before ADR-023 (no links) the clock order cleared it.
    const legacy = [red, green].map(({ id: _id, after: _after, ...r }) => r);
    expect(jointFlagsFromPain(legacy).knee ?? 'green').toBe('green');
    // A report from another device that never saw the red does not clear it either.
    const unaware: PainReport = { joint: 'knee', score: 0, at: iso(BASE + 20_000), phase: 'during', sessionId: uuid(1003), id: uuid(3), after: [uuid(1)] };
    expect(jointFlagsFromPain([green, red, unaware]).knee).toBe('red');
    // A later session that knew it does.
    const aware: PainReport = { ...unaware, id: uuid(4), after: [uuid(2)] };
    expect(jointFlagsFromPain([green, red, aware]).knee ?? 'green').toBe('green');
  });
});

describe('S3 on raw execution logs (the server and the device selector pass them as stored)', () => {
  it('reads a red flag’s `eventId` like its `id`', () => {
    const flag = { kind: 'red_flag', at: iso(BASE + 5_000), eventId: uuid(7) };
    const old = { kind: 'medical_review_attested', at: iso(BASE + 10_000), attests: [uuid(1)] };
    expect(intensityLockStatus([flag, old]).locked).toBe(true);
    expect(intensityLockStatus([flag, old, { kind: 'medical_review_attested', at: iso(BASE + 11_000), attests: [uuid(7)] }]).locked).toBe(false);
  });
});
