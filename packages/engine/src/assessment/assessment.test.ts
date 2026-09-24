import { S1_RPE_AT_ZERO_RIR, trainingHoldFlags } from '@fitadapt/safety';
import { SCREENING_QUESTION_IDS, SafetyProfileSchema, type AssessmentResult, type AssessmentTestResult, type SafetyProfile } from '@fitadapt/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FIXTURE_EXERCISES, FIXTURE_LIBRARY, FULL_GYM, P1_HOME, profileFrom } from '../__fixtures__/library.js';
import { fixedClock } from '../clock.js';
import { ENGINE_VERSION } from '../version.js';
import { firstSessionRir } from '../session/first-session.js';
import { rpeForRir } from './config.js';
import {
  ASSESSMENT_CONFIG,
  ASSESSMENT_MIN_STOP_RIR,
  ASSESSMENT_PROTOCOLS,
  AssessmentInputError,
  FIRST_SESSION_CONFIG,
  GYM_PROTOCOL,
  HOME_PROTOCOL,
  OLDER_ADULT_PROTOCOL,
  assessmentStopRir,
  buildAssessmentPlan,
  buildCapacityModel,
  epleyE1RM,
  estimatedMinutes,
  loadForReps,
  mapTestResult,
  protocol,
  reassessmentStatus,
  recommendProtocol,
  roundDownToIncrement,
  type AssessmentProtocol,
  type AssessmentTestDefinition,
} from './index.js';

const exercises = new Map(FIXTURE_EXERCISES.map((e) => [e.id, e]));
const cleared = profileFrom();
const flagged = profileFrom(['heart_or_blood_pressure']);
const def = (p: AssessmentProtocol, id: string) => p.tests.find((t) => t.id === id) as AssessmentTestDefinition;
const done = (testId: string, exerciseId: string, m: { reps?: number; seconds?: number; loadKg?: number; rir?: number }): AssessmentTestResult => ({
  status: 'done',
  testId,
  exerciseId,
  reps: m.reps ?? null,
  seconds: m.seconds ?? null,
  loadKg: m.loadKg ?? null,
  rir: m.rir ?? null,
});
const map = (p: AssessmentProtocol, testId: string, r: AssessmentTestResult, stopRir = 2) => mapTestResult(def(p, testId), r, FIXTURE_LIBRARY, stopRir);

/** SAF-2: the safety facts an assessment requires, at their "nothing reported" values. */
const ASSESS_FACTS = { jointFlags: {}, intensityLock: { locked: false, since: null }, birthDate: null, localDate: null, nowMs: Date.parse('2026-09-24T08:00:00.000Z') } as const;

describe('protocols (goal condition 1)', () => {
  it('defines home, gym and 55+ protocols of submaximal tests only', () => {
    expect(Object.keys(ASSESSMENT_PROTOCOLS).sort()).toEqual(['gym', 'home', 'home_55plus']);
    expect(HOME_PROTOCOL.tests.map((t) => t.id)).toEqual(['push_reps', 'dead_hang_hold', 'row_reps', 'squat_reps', 'plank_hold']);
    expect(OLDER_ADULT_PROTOCOL.tests.map((t) => t.id)).toEqual(['chair_stand', 'push_reps_55', 'plank_hold_55']);
    expect(GYM_PROTOCOL.tests.filter((t) => t.kind === 'load_reps').map((t) => t.slot)).toEqual(['squat', 'horizontal_push', 'vertical_pull', 'horizontal_pull', 'hinge']);
    for (const p of Object.values(ASSESSMENT_PROTOCOLS)) {
      expect(protocol(p.id)).toBe(p);
      for (const t of p.tests) {
        expect(t.effort).toBe('submaximal');
        // Every test has a safety cap (reps, time or a fixed window).
        expect(t.capReps ?? t.capSeconds ?? t.windowSeconds).not.toBeNull();
        expect(t.kind === 'load_reps' ? t.mapping : t.mapping?.stayMin).toBeDefined();
      }
      // The first test of a slot is never gated.
      for (const slot of new Set(p.tests.map((t) => t.slot))) expect(p.tests.find((t) => t.slot === slot)!.gate).toBeNull();
    }
  });

  it('the home assessment takes at most 15 minutes; the 55+ one uses the 30-second chair stand', () => {
    expect(estimatedMinutes(HOME_PROTOCOL)).toBeLessThanOrEqual(15);
    expect(estimatedMinutes(OLDER_ADULT_PROTOCOL)).toBeLessThanOrEqual(15);
    const chair = buildAssessmentPlan(OLDER_ADULT_PROTOCOL, { ...ASSESS_FACTS, safetyProfile: cleared, equipment: ['sturdy_chair'], exercises });
    expect(chair.status === 'available' && chair.instructions[0]).toMatchObject({ testId: 'chair_stand', kind: 'timed_reps', stop: { windowSeconds: 30 } });
  });

  it('recommends the 55+ protocol from 55, the gym protocol with gym equipment, home otherwise', () => {
    expect(recommendProtocol({ ageYears: 62, hasGymEquipment: true })).toBe('home_55plus');
    expect(recommendProtocol({ ageYears: 55, hasGymEquipment: false })).toBe('home_55plus');
    expect(recommendProtocol({ ageYears: 54, hasGymEquipment: true })).toBe('gym');
    expect(recommendProtocol({ ageYears: 29, hasGymEquipment: false })).toBe('home');
  });

  it('keeps every coefficient in config with a source and validated:false', () => {
    for (const cfg of [ASSESSMENT_CONFIG, FIRST_SESSION_CONFIG]) {
      for (const [key, value] of Object.entries(cfg)) {
        expect(value.validated, key).toBe(false);
        expect(value.source.length, key).toBeGreaterThan(10);
      }
    }
    // Citations say they were not checked against the source.
    expect(ASSESSMENT_CONFIG.epleyRepDivisor.source).toMatch(/not checked against the source/);
    expect(ASSESSMENT_CONFIG.rpeAtZeroRir.source).toMatch(/not checked against the source/);
    expect(ASSESSMENT_CONFIG.chairStandWindowSeconds.source).toMatch(/not checked against the source/);
    // A1/A2 M07-41: the 55+ protocol age is a product choice (the paper's population was 60+).
    expect(ASSESSMENT_CONFIG.olderAdultProtocolAge.source).toMatch(/product choice/);
  });

  it('CS-8: the RIR→RPE anchor is the S1 invariant: the configured coefficient can only raise it, so the S1 reserve never loosens', () => {
    expect(S1_RPE_AT_ZERO_RIR).toBe(10);
    expect(ASSESSMENT_CONFIG.rpeAtZeroRir.value).toBeGreaterThanOrEqual(S1_RPE_AT_ZERO_RIR);
    for (let rir = 0; rir <= 10; rir++) expect(rpeForRir(rir)).toBeGreaterThanOrEqual(S1_RPE_AT_ZERO_RIR - rir);
    // An unresolved flag caps effort at RPE 7: every reserve the engine picks for it is at least 3 (first session and tests).
    // Integration FIX-A × FIX-B: a HOLDING flag (CS-1, e.g. chest_discomfort) is stricter still: no reserve at all (null).
    for (const yes of [['chest_discomfort'], ['medication_affecting_effort'], ['heart_or_blood_pressure']] as const) {
      const flagged = profileFrom([...yes]);
      if (trainingHoldFlags(flagged).length > 0) {
        expect(firstSessionRir(flagged)).toBeNull();
        expect(assessmentStopRir(flagged)).toBeNull();
        continue;
      }
      expect(firstSessionRir(flagged)).toBeGreaterThanOrEqual(3);
      expect(assessmentStopRir(flagged)).toBeGreaterThanOrEqual(3);
    }
    expect(trainingHoldFlags(profileFrom(['chest_discomfort']))).toEqual(['chest_discomfort']);
    expect(trainingHoldFlags(profileFrom(['heart_or_blood_pressure']))).toEqual([]);
  });
});

describe('e1RM by RIR-adjusted Epley (goal condition 2)', () => {
  it('is w × (1 + (reps + RIR) / 30) for every effective rep count (reps + RIR) from 1 to 12', () => {
    const table: [number, number, number, number][] = [
      [100, 1, 0, 103.333],
      [100, 1, 2, 110],
      [100, 5, 0, 116.667],
      [100, 8, 2, 133.333],
      [60, 10, 2, 84],
      [140, 8, 2, 186.667],
      [20, 12, 0, 28],
      [80, 10, 2, 112],
    ];
    for (const [w, reps, rir, expected] of table) expect(epleyE1RM(w, reps, rir)).toBeCloseTo(expected, 3);
    for (let reps = 1; reps <= 12; reps++) {
      for (let rir = 0; rir <= 4; rir++) {
        // A3/A5 pre-review #2: the limit is on the reps the formula is fed (reps + RIR), never above 12.
        if (reps + rir <= 12) expect(epleyE1RM(100, reps, rir)).toBeCloseTo(100 * (1 + (reps + rir) / 30), 9);
        else expect(epleyE1RM(100, reps, rir)).toBeNull();
      }
    }
  });

  it('property: grows with reps and RIR, is above the load, and inverts with loadForReps', () => {
    fc.assert(
      fc.property(fc.double({ min: 1, max: 400, noNaN: true }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 0, max: 4 }), (w, reps, rir) => {
        fc.pre(reps + rir <= 12);
        const e = epleyE1RM(w, reps, rir)!;
        expect(e).toBeGreaterThan(w);
        if (reps + rir < 12) expect(epleyE1RM(w, reps + 1, rir)!).toBeGreaterThan(e);
        if (reps + rir < 12) expect(epleyE1RM(w, reps, rir + 1)!).toBeGreaterThan(e);
        expect(loadForReps(e, reps, rir)).toBeCloseTo(w, 6);
      }),
      { numRuns: 1000 },
    );
  });

  it('refuses to estimate outside 1–12 reps, without a positive load or with an invalid RIR', () => {
    expect(epleyE1RM(100, 0)).toBeNull();
    expect(epleyE1RM(100, 13)).toBeNull();
    // Effective reps above 12 (reps + RIR): no estimate (it would inflate the e1RM and the first loads).
    expect(epleyE1RM(100, 12, 1)).toBeNull();
    expect(epleyE1RM(100, 10, 3)).toBeNull();
    expect(epleyE1RM(100, 7, 5)).toBeCloseTo(140, 9);
    expect(epleyE1RM(100, 2.5)).toBeNull();
    expect(epleyE1RM(0, 5)).toBeNull();
    expect(epleyE1RM(Number.POSITIVE_INFINITY, 5)).toBeNull();
    expect(epleyE1RM(100, 5, -1)).toBeNull();
    expect(epleyE1RM(100, 5, 1.5)).toBeNull();
  });

  it('rounds loads down to the equipment step, never up', () => {
    expect(roundDownToIncrement(126)).toBe(125);
    expect(roundDownToIncrement(127.49)).toBe(125);
    expect(roundDownToIncrement(20.1, 2)).toBe(20);
    expect(roundDownToIncrement(9.99, 1.25)).toBe(8.75);
    expect(roundDownToIncrement(0.3)).toBe(0);
    expect(() => roundDownToIncrement(10, 0)).toThrow(RangeError);
    // SAF-4: never rounds up to the next hundredth before flooring.
    expect(roundDownToIncrement(49.9995, 0.5)).toBe(49.5);
    expect(roundDownToIncrement(45.45 * 1.1, 0.5)).toBe(49.5);
    expect(roundDownToIncrement(99.99957, 0.5)).toBe(99.5);
    fc.assert(
      fc.property(fc.constantFrom(0.5, 1, 1.25, 2, 2.5, 5), fc.integer({ min: 1, max: 400 }), fc.double({ min: 0, max: 0.009, noNaN: true }), (step, k, below) => {
        const x = k * step - below;
        expect(roundDownToIncrement(x, step)).toBeLessThanOrEqual(x + 1e-9);
      }),
    );
    fc.assert(
      fc.property(fc.double({ min: 0, max: 500, noNaN: true }), fc.constantFrom(0.5, 1, 1.25, 2, 2.5, 5), (x, step) => {
        const r = roundDownToIncrement(x, step);
        expect(r).toBeLessThanOrEqual(x + 1e-9);
        expect(x - r).toBeLessThan(step + 1e-9);
      }),
    );
  });
});

describe('mapping tables: result → ladder rung and starting load (goal condition 2)', () => {
  it.each([
    // [test, variant, reps, expected rung, reason]
    ['push_reps', 'knee_push_up', 0, 'wall_push_up', 'assessment.mapping.zero_lowest_rung'],
    ['push_reps', 'push_up', 0, 'wall_push_up', 'assessment.mapping.zero_lowest_rung'],
    ['push_reps', 'knee_push_up', 4, 'incline_push_up_low', 'assessment.mapping.step_down'],
    ['push_reps', 'knee_push_up', 5, 'knee_push_up', 'assessment.mapping.in_range'],
    ['push_reps', 'knee_push_up', 14, 'knee_push_up', 'assessment.mapping.in_range'],
    ['push_reps', 'knee_push_up', 15, 'push_up', 'assessment.mapping.step_up'],
    ['push_reps', 'wall_push_up', 3, 'wall_push_up', 'assessment.mapping.step_down'],
    ['push_reps', 'push_up', 40, 'deficit_push_up', 'assessment.mapping.step_up'],
    ['row_reps', 'inverted_row_incline', 0, 'dead_hang', 'assessment.mapping.zero_lowest_rung'],
    ['row_reps', 'inverted_row', 12, 'band_assisted_pull_up', 'assessment.mapping.step_up'],
    ['row_reps', 'pull_up', 6, 'pull_up', 'assessment.mapping.in_range'],
    ['squat_reps', 'air_squat', 0, 'box_squat', 'assessment.mapping.zero_lowest_rung'],
    ['squat_reps', 'air_squat', 7, 'box_squat', 'assessment.mapping.step_down'],
    ['squat_reps', 'air_squat', 15, 'air_squat', 'assessment.mapping.in_range'],
    ['squat_reps', 'air_squat', 25, 'goblet_squat', 'assessment.mapping.step_up'],
  ] as const)('home %s: %s × %i → %s', (testId, variant, reps, rung, reason) => {
    const placed = map(HOME_PROTOCOL, testId, done(testId, variant, { reps }));
    expect(placed.slot.exerciseId).toBe(rung);
    expect(placed.slot.reasonCodes).toEqual([reason]);
    expect(placed.slot.loadKg).toBeNull();
  });

  it.each([
    ['dead_hang_hold', 'dead_hang', 0, 'dead_hang', 'assessment.mapping.zero_lowest_rung'],
    ['dead_hang_hold', 'dead_hang', 9, 'dead_hang', 'assessment.mapping.step_down'],
    ['dead_hang_hold', 'dead_hang', 20, 'dead_hang', 'assessment.mapping.in_range'],
    ['dead_hang_hold', 'dead_hang', 30, 'scapular_pull_up', 'assessment.mapping.step_up'],
    ['plank_hold', 'front_plank', 0, 'knee_plank', 'assessment.mapping.zero_lowest_rung'],
    ['plank_hold', 'front_plank', 19, 'knee_plank', 'assessment.mapping.step_down'],
    ['plank_hold', 'front_plank', 45, 'front_plank', 'assessment.mapping.in_range'],
    ['plank_hold', 'front_plank', 200, 'ab_wheel_kneeling', 'assessment.mapping.step_up'],
  ] as const)('home %s: %s held %i s → %s', (testId, variant, seconds, rung, reason) => {
    const placed = map(HOME_PROTOCOL, testId, done(testId, variant, { seconds }));
    expect(placed.slot.exerciseId).toBe(rung);
    expect(placed.slot.reasonCodes).toEqual([reason]);
  });

  it.each([
    ['chair_stand', 'box_squat', 0, 'box_squat', 'assessment.mapping.zero_lowest_rung'],
    ['chair_stand', 'box_squat', 7, 'box_squat', 'assessment.mapping.step_down'],
    ['chair_stand', 'box_squat', 10, 'box_squat', 'assessment.mapping.in_range'],
    ['chair_stand', 'box_squat', 14, 'air_squat', 'assessment.mapping.step_up'],
    ['push_reps_55', 'wall_push_up', 0, 'wall_push_up', 'assessment.mapping.zero_lowest_rung'],
    ['push_reps_55', 'incline_push_up_high', 16, 'incline_push_up_low', 'assessment.mapping.step_up'],
  ] as const)('55+ %s: %s × %i → %s', (testId, variant, reps, rung, reason) => {
    const placed = map(OLDER_ADULT_PROTOCOL, testId, done(testId, variant, { reps }));
    expect(placed.slot.exerciseId).toBe(rung);
    expect(placed.slot.reasonCodes).toEqual([reason]);
  });

  it('derives working targets from what the user did on the rung they stay on', () => {
    expect(map(HOME_PROTOCOL, 'push_reps', done('push_reps', 'knee_push_up', { reps: 10 })).slot.target).toEqual({ kind: 'reps', min: 6, max: 8 });
    expect(map(HOME_PROTOCOL, 'push_reps', done('push_reps', 'knee_push_up', { reps: 5 })).slot.target).toEqual({ kind: 'reps', min: 3, max: 4 });
    expect(map(HOME_PROTOCOL, 'plank_hold', done('plank_hold', 'front_plank', { seconds: 45 })).slot.target).toEqual({ kind: 'hold', seconds: 27 });
    expect(map(HOME_PROTOCOL, 'dead_hang_hold', done('dead_hang_hold', 'dead_hang', { seconds: 12 })).slot.target).toEqual({ kind: 'hold', seconds: 10 });
    // A new rung starts at the default target of its kind.
    expect(map(HOME_PROTOCOL, 'push_reps', done('push_reps', 'knee_push_up', { reps: 2 })).slot.target).toEqual({ kind: 'reps', min: 5, max: 8 });
    expect(map(HOME_PROTOCOL, 'dead_hang_hold', done('dead_hang_hold', 'dead_hang', { seconds: 40 })).slot.target).toEqual({ kind: 'reps', min: 5, max: 8 });
    expect(map(HOME_PROTOCOL, 'plank_hold', done('plank_hold', 'front_plank', { seconds: 5 })).slot.target).toEqual({ kind: 'hold', seconds: 15 });
    // Zero: the lowest rung with its default target (a hold for the dead hang).
    expect(map(HOME_PROTOCOL, 'row_reps', done('row_reps', 'inverted_row', { reps: 0 })).slot.target).toEqual({ kind: 'hold', seconds: 15 });
    // A result above the test's cap counts as the cap.
    expect(map(HOME_PROTOCOL, 'plank_hold', done('plank_hold', 'knee_plank', { seconds: 600 })).slot).toMatchObject({ exerciseId: 'front_plank', target: { kind: 'hold', seconds: 15 } });
    expect(map(HOME_PROTOCOL, 'plank_hold', done('plank_hold', 'knee_plank', { seconds: 600 })).reachedStayMin).toBe(true);
  });

  it('gym: starting load from the RIR-adjusted Epley e1RM, 90 %, rounded down', () => {
    // 140 kg × 8 at RIR 2 → e1RM 186.7; load for 8 reps at RIR 2 = 140; × 0.9 = 126 → 125.
    const squat = map(GYM_PROTOCOL, 'squat_load', done('squat_load', 'barbell_back_squat', { loadKg: 140, reps: 8, rir: 2 }));
    expect(squat.slot).toMatchObject({ exerciseId: 'barbell_back_squat', stepIndex: 4, e1rmKg: 186.7, loadKg: 125, target: { kind: 'reps', min: 6, max: 10 } });
    expect(squat.slot.reasonCodes).toEqual(['assessment.e1rm.epley_rir', 'assessment.load.first_session_factor']);
    // 100 kg × 10 at RIR 2: e1RM 140; load for 8 at RIR 2 = 140 / (1 + 10/30) = 105; × 0.9 = 94.5 → 92.5.
    expect(map(GYM_PROTOCOL, 'press_load', done('press_load', 'barbell_bench_press', { loadKg: 100, reps: 10, rir: 2 })).slot).toMatchObject({ e1rmKg: 140, loadKg: 92.5 });
    // No RIR reported: the instructed reserve is used.
    expect(map(GYM_PROTOCOL, 'press_load', done('press_load', 'barbell_bench_press', { loadKg: 100, reps: 9 }), 3).slot.e1rmKg).toBe(140);
    // 10 reps with the instructed reserve 3 is 13 effective reps: no Epley estimate, the tested load is the reference.
    expect(map(GYM_PROTOCOL, 'press_load', done('press_load', 'barbell_bench_press', { loadKg: 100, reps: 10 }), 3).slot).toMatchObject({ e1rmKg: null });
    // More than 12 reps: no Epley estimate, the tested load is the reference.
    const pulldown = map(GYM_PROTOCOL, 'pulldown_load', done('pulldown_load', 'lat_pulldown', { loadKg: 40, reps: 20, rir: 2 }));
    expect(pulldown.slot).toMatchObject({ e1rmKg: null, loadKg: 35 });
    expect(pulldown.slot.reasonCodes[0]).toBe('assessment.e1rm.out_of_range');
    // Zero reps (the load was too heavy) or no load: the lowest rung of the ladder.
    expect(map(GYM_PROTOCOL, 'hinge_load', done('hinge_load', 'barbell_romanian_deadlift', { loadKg: 60, reps: 0 })).slot).toMatchObject({ exerciseId: 'hip_hinge_drill', loadKg: null, reasonCodes: ['assessment.mapping.zero_lowest_rung'] });
    expect(map(GYM_PROTOCOL, 'row_load', done('row_load', 'barbell_row', { loadKg: 0, reps: 8 })).slot.exerciseId).toBe('seated_band_row');
  });

  it('skipped tests map to the lowest rung; invalid results are refused', () => {
    expect(map(HOME_PROTOCOL, 'row_reps', { status: 'skipped', testId: 'row_reps', reason: 'equipment' }).slot).toMatchObject({ exerciseId: 'dead_hang', stepIndex: 0, reasonCodes: ['assessment.mapping.skipped_equipment'] });
    expect(() => map(HOME_PROTOCOL, 'push_reps', done('push_reps', 'archer_push_up', { reps: 3 }))).toThrow('assessment.result.unknown_variant.push_reps');
    expect(() => map(HOME_PROTOCOL, 'push_reps', done('push_reps', 'knee_push_up', { seconds: 3 }))).toThrow('assessment.result.missing_measure.push_reps');
    const badLadder = { ...FIXTURE_LIBRARY, ladders: FIXTURE_LIBRARY.ladders.map((l) => (l.id === 'push' ? { ...l, steps: [['wall_push_up']] } : l)) };
    expect(() => mapTestResult(def(HOME_PROTOCOL, 'push_reps'), done('push_reps', 'knee_push_up', { reps: 3 }), badLadder, 2)).toThrow('variant_not_on_ladder');
    const noLadder = { ...FIXTURE_LIBRARY, ladders: [] };
    expect(() => mapTestResult(def(HOME_PROTOCOL, 'push_reps'), done('push_reps', 'knee_push_up', { reps: 3 }), noLadder, 2)).toThrow(AssessmentInputError);
  });
});

function homeResult(tests: AssessmentTestResult[], stopRir = 2): AssessmentResult {
  return { protocolId: 'home', protocolVersion: 1, stopRir, startedAt: '2026-09-23T10:00:00.000Z', completedAt: '2026-09-23T10:14:00.000Z', tests };
}

describe('CapacityModel', () => {
  it('P1-like home result: every slot gets a rung; rows count only after a tolerable dead hang', () => {
    const tests = [
      done('push_reps', 'knee_push_up', { reps: 4 }),
      done('dead_hang_hold', 'dead_hang', { seconds: 12 }),
      { status: 'skipped' as const, testId: 'row_reps', reason: 'equipment' as const },
      done('squat_reps', 'air_squat', { reps: 15 }),
      done('plank_hold', 'knee_plank', { seconds: 25 }),
    ];
    const model = buildCapacityModel(homeResult(tests), FIXTURE_LIBRARY);
    expect(model).toMatchObject({ schemaVersion: 1, protocolId: 'home', engineVersion: ENGINE_VERSION, assessedAt: '2026-09-23T10:14:00.000Z', reassessDueAt: '2026-10-21T10:14:00.000Z' });
    expect(Object.fromEntries(model.slots.map((s) => [s.slot, s.exerciseId]))).toEqual({
      squat: 'air_squat',
      horizontal_push: 'incline_push_up_low',
      vertical_pull: 'dead_hang',
      horizontal_pull: 'seated_band_row',
      hinge: 'hip_hinge_drill',
      core: 'knee_plank',
    });
    expect(model.slots.find((s) => s.slot === 'hinge')!.reasonCodes).toEqual(['assessment.mapping.not_tested_lowest_rung']);

    // Good rows with a short hang do not raise the pull rung; with a tolerable hang they do.
    const rows = done('row_reps', 'inverted_row', { reps: 8 });
    const shortHang = buildCapacityModel(homeResult([...tests.slice(0, 1), done('dead_hang_hold', 'dead_hang', { seconds: 5 }), rows, ...tests.slice(3)]), FIXTURE_LIBRARY);
    expect(shortHang.slots.find((s) => s.slot === 'vertical_pull')!.exerciseId).toBe('dead_hang');
    const goodHang = buildCapacityModel(homeResult([...tests.slice(0, 1), done('dead_hang_hold', 'dead_hang', { seconds: 15 }), rows, ...tests.slice(3)]), FIXTURE_LIBRARY);
    expect(goodHang.slots.find((s) => s.slot === 'vertical_pull')).toMatchObject({ exerciseId: 'inverted_row', testId: 'row_reps' });
  });

  it('refuses incomplete results, unknown tests and another protocol version', () => {
    const base = homeResult(HOME_PROTOCOL.tests.map((t) => ({ status: 'skipped' as const, testId: t.id, reason: 'user_choice' as const })));
    expect(buildCapacityModel(base, FIXTURE_LIBRARY).slots.every((s) => s.stepIndex === 0)).toBe(true);
    expect(() => buildCapacityModel({ ...base, tests: base.tests.slice(1) }, FIXTURE_LIBRARY)).toThrow('assessment.result.incomplete.push_reps');
    expect(() => buildCapacityModel({ ...base, tests: [...base.tests, { status: 'skipped', testId: 'extra_test', reason: 'user_choice' }] }, FIXTURE_LIBRARY)).toThrow('assessment.result.unknown_test');
    expect(() => buildCapacityModel({ ...base, protocolVersion: 2 }, FIXTURE_LIBRARY)).toThrow('assessment.result.protocol_version');
    expect(() => buildCapacityModel({ ...base, stopRir: 1 }, FIXTURE_LIBRARY)).toThrow();
  });

  it('is deterministic (same result, same model)', () => {
    const r = homeResult(HOME_PROTOCOL.tests.map((t) => ({ status: 'skipped' as const, testId: t.id, reason: 'user_choice' as const })));
    expect(buildCapacityModel(r, FIXTURE_LIBRARY)).toEqual(buildCapacityModel(structuredClone(r), FIXTURE_LIBRARY));
  });
});

// ---- Gating (goal condition 3)

const arbProfile: fc.Arbitrary<SafetyProfile> = fc
  .record({
    yes: fc.subarray([...SCREENING_QUESTION_IDS]),
    clearance: fc.boolean(),
    birthYear: fc.integer({ min: 1940, max: 2010 }),
  })
  .map(({ yes, clearance, birthYear }) => profileFrom(yes, { clearanceAttested: clearance, birthYear }));

/** Synthetic protocol with to-failure tests: only the S1 gate stands between them and the user. */
const MAXIMAL: AssessmentProtocol = { ...HOME_PROTOCOL, tests: HOME_PROTOCOL.tests.map((t) => ({ ...t, effort: 'maximal' as const })) };

describe('S1 gating: allowMaxTests=false → every test stops at RIR 2 or further from failure (goal condition 3)', () => {
  it('property: for every screening outcome without allowMaxTests, no instruction goes to failure and every one stops at RIR ≥ 2 (exactly 2 where S1 allows RPE 8)', () => {
    let gatedSeen = 0;
    fc.assert(
      fc.property(arbProfile, fc.constantFrom(...Object.values(ASSESSMENT_PROTOCOLS), MAXIMAL), fc.subarray(FULL_GYM), (profile, p, equipment) => {
        const plan = buildAssessmentPlan(p, { ...ASSESS_FACTS, safetyProfile: profile, equipment, exercises });
        if (profile.allowMaxTests && profile.unresolvedFlags.length === 0) return;
        gatedSeen += 1;
        if (plan.status === 'unavailable') return;
        for (const i of plan.instructions) {
          expect(i.stop.toFailure).toBe(false);
          expect(i.stop.rir).toBeGreaterThanOrEqual(ASSESSMENT_MIN_STOP_RIR);
          expect(i.stop.rpe).toBeLessThanOrEqual(Math.min(profile.maxRPE, 8));
          expect(i.stop.rir).toBe(profile.maxRPE >= 8 && profile.unresolvedFlags.length === 0 ? 2 : 10 - Math.min(profile.maxRPE, 7));
        }
        if (p === MAXIMAL) expect(plan.safetyEvents.map((e) => e.reasonCode)).toContain('safety.s1.max_test_not_allowed');
      }),
      { numRuns: 3000 },
    );
    expect(gatedSeen).toBeGreaterThan(100);
  });

  it('a hand-built profile with allowMaxTests=false and no flag: every instruction stops at exactly RIR 2', () => {
    const profile = SafetyProfileSchema.parse({ ...cleared, allowMaxTests: false });
    for (const p of [...Object.values(ASSESSMENT_PROTOCOLS), MAXIMAL]) {
      const plan = buildAssessmentPlan(p, { ...ASSESS_FACTS, safetyProfile: profile, equipment: FULL_GYM, exercises });
      expect(plan.status).toBe('available');
      if (plan.status !== 'available') continue;
      expect(plan.instructions.every((i) => i.stop.rir === 2 && !i.stop.toFailure)).toBe(true);
      expect(plan.stopRir).toBe(2);
    }
  });

  it('an unresolved flag (S1, RPE ≤ 7) stops every test at RIR 3 and records an S1 safety event', () => {
    const plan = buildAssessmentPlan(HOME_PROTOCOL, { ...ASSESS_FACTS, safetyProfile: flagged, equipment: P1_HOME, exercises });
    expect(plan).toMatchObject({ status: 'available', stopRir: 3, cappedByS1: true, noticeId: 'assessment' });
    if (plan.status !== 'available') return;
    expect(plan.instructions.every((i) => i.stop.rir === 3 && i.stop.rpe === 7 && i.reasonCodes.includes('assessment.stop.s1_reserve'))).toBe(true);
    expect(plan.safetyEvents).toEqual([{ invariant: 'S1', reasonCode: 'safety.s1.rpe_above_cap', action: 'capped', engineVersion: ENGINE_VERSION }]);
    expect(assessmentStopRir(flagged)).toBe(3);
  });

  it('only a cleared user with allowMaxTests may get a to-failure test, and no shipped protocol has one', () => {
    const maximal = buildAssessmentPlan(MAXIMAL, { ...ASSESS_FACTS, safetyProfile: cleared, equipment: FULL_GYM, exercises });
    expect(maximal.status === 'available' && maximal.instructions.every((i) => i.stop.toFailure && i.stop.rir === 0)).toBe(true);
    for (const p of Object.values(ASSESSMENT_PROTOCOLS)) {
      const plan = buildAssessmentPlan(p, { ...ASSESS_FACTS, safetyProfile: cleared, equipment: FULL_GYM, exercises });
      expect(plan.status === 'available' && plan.instructions.every((i) => !i.stop.toFailure && i.stop.rir === 2 && i.reasonCodes[0] === 'assessment.stop.reserve')).toBe(true);
      expect(plan.status === 'available' && plan.safetyEvents).toEqual([]);
    }
  });

  it('offers only variants the equipment and SafetyProfile allow, and skips a test with none', () => {
    const plan = buildAssessmentPlan(HOME_PROTOCOL, { ...ASSESS_FACTS, safetyProfile: cleared, equipment: P1_HOME, exercises });
    if (plan.status !== 'available') throw new Error('expected a plan');
    const byId = Object.fromEntries(plan.instructions.map((i) => [i.testId, i]));
    expect(byId.push_reps!.options).toEqual(['wall_push_up', 'incline_push_up_high', 'knee_push_up', 'push_up']);
    expect(byId.row_reps!.options).toEqual(['pull_up']);
    expect(byId.squat_reps!.options).toEqual(['air_squat']);
    const noBar = buildAssessmentPlan(HOME_PROTOCOL, { ...ASSESS_FACTS, safetyProfile: cleared, equipment: [], exercises });
    if (noBar.status !== 'available') throw new Error('expected a plan');
    expect(noBar.instructions.find((i) => i.testId === 'dead_hang_hold')).toMatchObject({ options: [], skipReason: 'equipment', reasonCodes: ['assessment.stop.reserve', 'assessment.skip.equipment'] });
    const noFloor = SafetyProfileSchema.parse({ ...cleared, avoidTags: ['floor_transfer'] });
    const floor = buildAssessmentPlan(HOME_PROTOCOL, { ...ASSESS_FACTS, safetyProfile: noFloor, equipment: P1_HOME, exercises });
    if (floor.status !== 'available') throw new Error('expected a plan');
    expect(floor.instructions.find((i) => i.testId === 'plank_hold')).toMatchObject({ options: [], skipReason: 'safety' });
    const unknown = buildAssessmentPlan(HOME_PROTOCOL, { ...ASSESS_FACTS, safetyProfile: cleared, equipment: P1_HOME, exercises: new Map() });
    expect(unknown.status === 'available' && unknown.instructions.every((i) => i.skipReason === 'equipment')).toBe(true);
  });

  it('SAF-2: no assessment while intensity is locked (S3), under 16 on the local date (S7) or with a wrong device date; a red joint removes the tests loading it (S2)', () => {
    const gym = (facts: Partial<typeof ASSESS_FACTS> | Record<string, unknown>) => buildAssessmentPlan(GYM_PROTOCOL, { ...ASSESS_FACTS, ...facts, safetyProfile: cleared, equipment: FULL_GYM, exercises } as never);
    expect(gym({ intensityLock: { locked: true, since: '2026-09-23T08:00:00.000Z' } })).toEqual({ status: 'unavailable', reasonCode: 'assessment.unavailable.s3_intensity_locked' });
    expect(gym({ birthDate: { year: 2010, month: 9, day: 25 }, localDate: { year: 2026, month: 9, day: 24 } })).toEqual({ status: 'unavailable', reasonCode: 'assessment.unavailable.s7_age' });
    expect(gym({ birthDate: { year: 2010, month: 9, day: 24 }, localDate: { year: 2026, month: 9, day: 24 } }).status).toBe('available');
    expect(gym({ localDate: { year: 2026, month: 10, day: 24 } })).toEqual({ status: 'unavailable', reasonCode: 'assessment.unavailable.clock_mismatch' });
    const open = gym({});
    const red = gym({ jointFlags: { knee: 'red' } });
    if (open.status !== 'available' || red.status !== 'available') throw new Error('expected plans');
    const squat = (p: typeof open) => p.instructions.find((i) => i.testId === 'squat_load')!;
    expect(squat(open).options.length).toBeGreaterThan(0);
    for (const id of squat(red).options) expect(['medium', 'high']).not.toContain(exercises.get(id)!.jointLoad.knee);
    expect(squat(red).options.length < squat(open).options.length || squat(red).skipReason === 'safety').toBe(true);
    // Missing facts are an error at the type level and fail closed at run time (no lock read → never "unlocked").
    expect(() => buildAssessmentPlan(GYM_PROTOCOL, { safetyProfile: cleared, equipment: FULL_GYM, exercises } as never)).toThrow();
  });

  it('no assessment for blocked, not-screened or professional-guidance users, or when no reserve satisfies the cap', () => {
    const at = (p: Partial<SafetyProfile>) => buildAssessmentPlan(HOME_PROTOCOL, { ...ASSESS_FACTS, safetyProfile: SafetyProfileSchema.parse({ ...cleared, ...p }), equipment: P1_HOME, exercises });
    expect(buildAssessmentPlan(HOME_PROTOCOL, { ...ASSESS_FACTS, safetyProfile: profileFrom([], { birthYear: 2015 }), equipment: P1_HOME, exercises })).toEqual({ status: 'unavailable', reasonCode: 'assessment.unavailable.blocked' });
    expect(at({ screeningOutcome: 'not_screened' })).toEqual({ status: 'unavailable', reasonCode: 'assessment.unavailable.not_screened' });
    expect(buildAssessmentPlan(HOME_PROTOCOL, { ...ASSESS_FACTS, safetyProfile: profileFrom(['pregnancy_or_recent_birth']), equipment: P1_HOME, exercises })).toEqual({ status: 'unavailable', reasonCode: 'assessment.unavailable.professional_guidance' });
    expect(at({ maxRPE: 4 })).toEqual({ status: 'unavailable', reasonCode: 'assessment.unavailable.effort_cap' });
  });
});

describe('re-assessment at the end of a mesocycle (fake clock, goal condition 5)', () => {
  const model = { reassessDueAt: '2026-10-21T10:14:00.000Z' };
  it('is due from the end of the default mesocycle, not before', () => {
    expect(reassessmentStatus(null, fixedClock(0))).toEqual({ status: 'never_assessed' });
    expect(reassessmentStatus(model, fixedClock(Date.parse('2026-10-21T10:13:59.999Z')))).toEqual({ status: 'not_due', dueAt: model.reassessDueAt });
    expect(reassessmentStatus(model, fixedClock(Date.parse('2026-10-21T10:14:00.000Z')))).toEqual({ status: 'due', dueAt: model.reassessDueAt, reasonCode: 'assessment.reassess.mesocycle_end' });
  });
  it('follows the mesocycle end M08 gives, when there is one', () => {
    const end = '2026-11-04T00:00:00.000Z';
    expect(reassessmentStatus(model, fixedClock(Date.parse('2026-10-25T00:00:00.000Z')), end)).toEqual({ status: 'not_due', dueAt: end });
    expect(reassessmentStatus(model, fixedClock(Date.parse(end)), end).status).toBe('due');
  });
});
