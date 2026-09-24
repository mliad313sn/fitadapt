import { screeningGateCheck, trainingHoldFlags } from '@fitadapt/safety';
import {
  JOINTS,
  MOVEMENT_PATTERNS,
  SCREENING_QUESTION_IDS,
  SafetyProfileSchema,
  type EquipmentId,
  type EquipmentLoads,
  type JointFlags,
  type SafetyProfile,
  type SessionHistoryEntry,
  type SessionPlan,
} from '@fitadapt/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildCapacityModel } from '../assessment/index.js';
import { FIXTURE_LIBRARY, profileFrom } from '../__fixtures__/library.js';
import { SESSION_EXERCISES, SESSION_LIBRARY, programContext } from '../__fixtures__/session.js';
import { Diary, type Performance } from '../__fixtures__/simulate.js';
import { fixedClock } from '../clock.js';
import { createEngineContext } from '../context.js';
import { blockingReasons, hasEquipment, redJointsLoaded } from '../substitution.js';
import { generateSession } from './generate.js';
import { s5Violations } from './history.js';
import { reasonParamsFor } from './reason-codes.js';
import { planSeconds } from './timebox.js';
import type { GenerateSessionInput, RecentLoad } from './types.js';

/**
 * Goal condition 3 — fast-check over ≥ 10,000 random valid inputs, trying
 * hard to break the invariants: tampered SafetyProfiles, adversarial
 * histories (loads the user never could lift, e1RM jumps, wrong patterns,
 * skipped and unreported sets), time travel (history dated after the clock,
 * clocks moved back), equipment that changes between sessions, red joints,
 * tiny time budgets. For every plan:
 *  - SafetyProfile caps are never exceeded (S1 RPE cap incl. 7 with an unresolved flag, HIIT, impact, avoided tags, exclusions);
 *  - no load rises more than 10 % over any load of the same exercise in the 7 days before (or dated after) the plan (S5);
 *  - the planned duration never exceeds the minutes available;
 *  - no exercise needs equipment missing from the active profile;
 *  - no exercise loads a red-flagged joint at medium or high level (S2);
 *  - every set has a reason code and the parameters its sentence needs.
 */

const NOW = Date.parse('2026-10-12T08:00:00.000Z');
const DAY = 86_400_000;
const EQUIPMENT: EquipmentId[] = ['barbell', 'squat_rack', 'flat_bench', 'dumbbell', 'kettlebell', 'leg_press', 'lat_pulldown', 'weight_plate', 'resistance_band', 'pull_up_bar', 'box', 'ab_wheel', 'gymnastic_rings', 'cable_station', 'parallel_bars', 'sturdy_chair', 'low_bar', 'parallettes', 'assisted_pull_up_machine'];
const IDS = SESSION_EXERCISES.map((e) => e.id);

const gymCapacity = buildCapacityModel(
  {
    protocolId: 'gym',
    protocolVersion: 1,
    stopRir: 2,
    startedAt: '2026-09-23T17:00:00.000Z',
    completedAt: '2026-09-23T17:30:00.000Z',
    tests: [
      { status: 'done', testId: 'squat_load', exerciseId: 'barbell_back_squat', loadKg: 140, reps: 8, rir: 2, seconds: null },
      { status: 'done', testId: 'press_load', exerciseId: 'barbell_bench_press', loadKg: 100, reps: 8, rir: 2, seconds: null },
      { status: 'done', testId: 'pulldown_load', exerciseId: 'lat_pulldown', loadKg: 70, reps: 10, rir: 2, seconds: null },
      { status: 'done', testId: 'row_load', exerciseId: 'barbell_row', loadKg: 80, reps: 8, rir: 2, seconds: null },
      { status: 'done', testId: 'hinge_load', exerciseId: 'barbell_romanian_deadlift', loadKg: 110, reps: 8, rir: 2, seconds: null },
      { status: 'done', testId: 'plank_hold', exerciseId: 'front_plank', loadKg: null, reps: null, seconds: 45, rir: null },
    ],
  },
  FIXTURE_LIBRARY,
);
const homeCapacity = buildCapacityModel(
  {
    protocolId: 'home',
    protocolVersion: 1,
    stopRir: 2,
    startedAt: '2026-09-23T17:00:00.000Z',
    completedAt: '2026-09-23T17:14:00.000Z',
    tests: [
      { status: 'done', testId: 'push_reps', exerciseId: 'knee_push_up', reps: 4, seconds: null, loadKg: null, rir: null },
      { status: 'done', testId: 'dead_hang_hold', exerciseId: 'dead_hang', reps: null, seconds: 12, loadKg: null, rir: null },
      { status: 'done', testId: 'row_reps', exerciseId: 'pull_up', reps: 0, seconds: null, loadKg: null, rir: null },
      { status: 'done', testId: 'squat_reps', exerciseId: 'air_squat', reps: 15, seconds: null, loadKg: null, rir: null },
      { status: 'done', testId: 'plank_hold', exerciseId: 'knee_plank', reps: null, seconds: 25, loadKg: null, rir: null },
    ],
  },
  FIXTURE_LIBRARY,
);

const at = (offsetDays: number) => new Date(NOW + offsetDays * DAY).toISOString();

const profileArb: fc.Arbitrary<SafetyProfile> = fc
  .record({ yes: fc.subarray([...SCREENING_QUESTION_IDS].filter((q) => q !== 'pregnancy_or_recent_birth')), clearance: fc.boolean(), tamper: fc.option(fc.record({ maxRPE: fc.integer({ min: 5, max: 10 }), allowHIIT: fc.boolean() }), { nil: undefined }) })
  .map(({ yes, clearance, tamper }) => {
    const p = profileFrom(yes, { clearanceAttested: clearance });
    // A tampered stored profile (looser or stricter than the screening gives): the engine's S1 gate still applies.
    return tamper ? SafetyProfileSchema.parse({ ...p, ...tamper }) : p;
  });

const loadsArb: fc.Arbitrary<EquipmentLoads | null> = fc.option(
  fc.record({
    barKg: fc.option(fc.constantFrom(10, 15, 20), { nil: null }),
    platePairsKg: fc.subarray([20, 10, 5, 2.5, 1.25, 0.5, 0.25]),
    dumbbellsKg: fc.uniqueArray(fc.integer({ min: 1, max: 100 }).map((x) => x / 2), { maxLength: 12 }),
    kettlebellsKg: fc.uniqueArray(fc.constantFrom(4, 8, 12, 16, 20, 24, 32), { maxLength: 5 }),
    stack: fc.option(fc.record({ minKg: fc.constantFrom(0, 5), stepKg: fc.constantFrom(2.5, 5, 7), maxKg: fc.constantFrom(40, 100) }), { nil: null }),
  }),
  { nil: null },
);

const flagsArb: fc.Arbitrary<JointFlags> = fc.record(Object.fromEntries(JOINTS.map((j) => [j, fc.constantFrom('green', 'amber', 'red')])) as Record<(typeof JOINTS)[number], fc.Arbitrary<'green' | 'amber' | 'red'>>, { requiredKeys: [] });

const setArb = (index: number) =>
  fc.record({
    index: fc.constant(index),
    status: fc.constantFrom('done', 'done', 'done', 'skipped'),
    reps: fc.option(fc.integer({ min: 0, max: 40 }), { nil: null }),
    seconds: fc.option(fc.integer({ min: 0, max: 120 }), { nil: null }),
    loadKg: fc.option(fc.oneof(fc.integer({ min: 0, max: 300 }), fc.double({ min: 0.5, max: 250, noNaN: true })), { nil: null }),
    rir: fc.option(fc.integer({ min: 0, max: 10 }), { nil: null }),
  });

const historyExerciseArb = fc.record({
  // Adversarial: a pattern that does not match the exercise, any role, any target.
  slot: fc.constantFrom(...MOVEMENT_PATTERNS),
  role: fc.constantFrom('primary', 'secondary', 'accessory'),
  exerciseId: fc.constantFrom(...IDS),
  ladderId: fc.option(fc.constantFrom('push', 'pull', 'squat', 'plank', 'unknown_ladder'), { nil: null }),
  target: fc.oneof(
    fc.record({ kind: fc.constant('reps' as const), min: fc.integer({ min: 1, max: 12 }), max: fc.integer({ min: 12, max: 20 }) }),
    fc.record({ kind: fc.constant('hold' as const), seconds: fc.integer({ min: 5, max: 90 }) }),
  ),
  targetRir: fc.integer({ min: 0, max: 5 }),
  prescribedLoadKg: fc.option(fc.double({ min: 0, max: 300, noNaN: true }), { nil: null }),
  performed: fc.integer({ min: 0, max: 5 }).chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => setArb(i + 1)))),
});

const historyArb: fc.Arbitrary<SessionHistoryEntry[]> = fc.array(
  fc.record({
    // Time travel: sessions up to 30 days before or after the engine clock.
    prescribedOffset: fc.double({ min: -30, max: 30, noNaN: true }),
    startOffset: fc.double({ min: 0, max: 1, noNaN: true }),
    countsForProgression: fc.boolean(),
    exercises: fc.array(historyExerciseArb, { maxLength: 6 }),
  }),
  { maxLength: 8 },
).map((entries) =>
  entries.map((e, i) => ({
    planId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    prescribedAt: at(e.prescribedOffset),
    startedAt: at(e.prescribedOffset + e.startOffset),
    countsForProgression: e.countsForProgression,
    exercises: e.exercises as SessionHistoryEntry['exercises'],
  })),
);

const recentArb: fc.Arbitrary<RecentLoad[]> = fc.array(fc.record({ exerciseId: fc.constantFrom(...IDS), loadKg: fc.double({ min: 0, max: 250, noNaN: true }), prescribedAt: fc.double({ min: -20, max: 20, noNaN: true }).map(at) }), { maxLength: 6 });

const programArb = fc.option(
  fc.record({
    slots: fc.array(fc.record({ pattern: fc.constantFrom(...MOVEMENT_PATTERNS), role: fc.constantFrom('primary', 'secondary', 'accessory'), intent: fc.constantFrom('strength', 'hypertrophy', 'general', 'skill', 'balance', 'mobility'), hardSets: fc.integer({ min: 1, max: 6 }) }), { minLength: 0, maxLength: 8 }),
    targetRpe: fc.integer({ min: 10, max: 20 }).map((x) => x / 2),
    kind: fc.constantFrom('accumulation', 'accumulation', 'deload', 'transition'),
    conditioning: fc.option(fc.record({ kind: fc.constantFrom('steady', 'intervals'), placement: fc.constantFrom('session', 'finisher'), minutes: fc.integer({ min: 1, max: 40 }) }), { nil: null }),
  }),
  { nil: null, freq: 8 },
);

const inputArb: fc.Arbitrary<GenerateSessionInput> = fc
  .record({
    safetyProfile: profileArb,
    equipment: fc.subarray(EQUIPMENT),
    equipmentLoads: loadsArb,
    // Mostly realistic budgets, sometimes tiny ones (which must be refused, never overrun).
    minutesAvailable: fc.oneof({ arbitrary: fc.integer({ min: 15, max: 120 }), weight: 5 }, { arbitrary: fc.double({ min: 10, max: 90, noNaN: true }), weight: 2 }, { arbitrary: fc.integer({ min: 0, max: 15 }), weight: 1 }),
    jointFlags: flagsArb,
    capacity: fc.constantFrom(gymCapacity, homeCapacity, null),
    program: programArb,
    history: historyArb,
    recentLoads: recentArb,
    readiness: fc.constantFrom('normal' as const, 'reduced' as const),
    experience: fc.constantFrom('none', 'returning', 'beginner', 'intermediate', 'advanced'),
  })
  .map(({ program, ...rest }) => ({
    ...rest,
    programSession: program ? programContext({ slots: program.slots as never, targetRpe: program.targetRpe, kind: program.kind, conditioning: program.conditioning as never }) : null,
  }));

/** The S1 cap the SafetyProfile implies (never above 7 while a flag is unresolved). */
const s1Cap = (p: SafetyProfile) => (p.unresolvedFlags.length > 0 ? Math.min(p.maxRPE, 7) : p.maxRPE);

function checkPlan(plan: SessionPlan, input: GenerateSessionInput) {
  const equipment = new Set(input.equipment);
  const flags = input.jointFlags ?? {};
  const cap = s1Cap(input.safetyProfile);
  // Duration.
  expect(plan.estimatedMinutes).toBeLessThanOrEqual(input.minutesAvailable);
  if (plan.kind === 'program_session') expect(planSeconds(plan)).toBeLessThanOrEqual(input.minutesAvailable * 60 + 1e-6);
  // S1 intervals (HIIT) only when the gate allows it.
  if (plan.conditioning?.kind === 'intervals') expect(screeningGateCheck({ profile: input.safetyProfile, request: { rpe: 10 - plan.targetRir, hiit: true, maximalTest: false } })).toBeNull();
  // S5 against the whole history the engine was given (and M07 recent loads).
  expect(s5Violations(plan, input.history ?? [], input.recentLoads ?? [])).toEqual([]);
  for (const e of plan.exercises) {
    const ex = SESSION_LIBRARY.graph.exercises.get(e.exerciseId)!;
    expect(hasEquipment(ex, equipment)).toBe(true);
    expect(redJointsLoaded(ex, flags)).toEqual([]);
    expect(blockingReasons(ex, equipment, flags, input.safetyProfile)).toEqual([]);
    for (const s of e.sets) {
      expect(10 - s.targetRir).toBeLessThanOrEqual(cap);
      expect(s.reasonCodes.length).toBeGreaterThan(0);
      for (const code of s.reasonCodes) for (const param of reasonParamsFor(code)) expect(s.reasonParams[param], `${code} needs ${param}`).toBeTypeOf('number');
    }
  }
}

describe('generateSession never breaks the safety caps, the clock or the equipment (goal condition 3, fast-check)', () => {
  it('over ≥ 10,000 random valid (and adversarial) inputs that produce a plan', () => {
    let plans = 0;
    fc.assert(
      fc.property(inputArb, fc.integer({ min: -40, max: 40 }), fc.integer(), (input, clockShift, seed) => {
        const ctx = createEngineContext({ clock: fixedClock(NOW + clockShift * DAY), seed });
        const r = generateSession(input, SESSION_LIBRARY, ctx);
        // FIX-B (CS-1): a symptom flag without clearance holds all training — never a plan, whatever else the input says.
        if (trainingHoldFlags(input.safetyProfile).length > 0) expect(r.status).toBe('unavailable');
        if (r.status === 'unavailable') {
          expect(r.reasonCodes.length).toBeGreaterThan(0);
          return;
        }
        plans += 1;
        checkPlan(r.plan, input);
      }),
      // FIX-B: held profiles never produce a plan, so more runs keep ≥ 10,000 checked plans.
      { numRuns: 24_000 },
    );
    // Refusals (no time, S1 effort cap, nothing possible) are part of the input space; at least 10,000 plans are checked.
    expect(plans).toBeGreaterThanOrEqual(10_000);
  }, 180_000);

  it('S3 and S7 always win: a locked intensity or an under-16 date of birth never gets a session', () => {
    fc.assert(
      fc.property(inputArb, fc.boolean(), fc.integer({ min: 0, max: 15 }), (input, lock, age) => {
        const guarded: GenerateSessionInput = lock ? { ...input, intensityLock: { locked: true, since: at(-1) } } : { ...input, birthDate: { year: 2026 - age, month: 10, day: 13 } };
        const r = generateSession(guarded, SESSION_LIBRARY, createEngineContext({ clock: fixedClock(NOW), seed: 1 }));
        expect(r.status).toBe('unavailable');
      }),
      { numRuns: 1_000 },
    );
  }, 60_000);
});

describe('over a sequence of sessions, with the clock moved back and forth and the place changing (S5 across plans)', () => {
  const performances: Performance[] = [
    // Always at the top at the target reserve, with a user-chosen load when none is prescribed.
    (s) => ({ status: 'done', reps: s.target.kind === 'reps' ? s.target.max : null, seconds: s.target.kind === 'hold' ? s.target.seconds : null, loadKg: s.loadKg ?? 30, rir: s.targetRir }),
    // Way beyond what was asked (claims a heavier load and many reps: an e1RM jump).
    (s) => ({ status: 'done', reps: 20, seconds: 120, loadKg: (s.loadKg ?? 30) * 2, rir: 5 }),
    // Lighter than prescribed.
    (s) => ({ status: 'done', reps: 12, seconds: 30, loadKg: s.loadKg === null ? null : s.loadKg * 0.8, rir: 3 }),
    // Skips.
    () => null,
  ];

  it('every pair of prescriptions of an exercise within 7 days of each other (in either time order) respects +10 %', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ shift: fc.double({ min: -6, max: 9, noNaN: true }), equipment: fc.subarray(EQUIPMENT, { minLength: 3 }), loads: loadsArb, perf: fc.integer({ min: 0, max: performances.length - 1 }), intent: fc.constantFrom('hypertrophy', 'strength', 'general') }), { minLength: 2, maxLength: 7 }),
        profileArb,
        (steps, safetyProfile) => {
          const diary = new Diary();
          const issued: { exerciseId: string; loadKg: number; at: number }[] = [];
          let clock = NOW;
          steps.forEach((step, i) => {
            clock += step.shift * DAY;
            const input: GenerateSessionInput = { safetyProfile, equipment: step.equipment, equipmentLoads: step.loads, minutesAvailable: 60, capacity: gymCapacity, programSession: programContext({ intent: step.intent as 'general' }), history: diary.history(), experience: 'intermediate' };
            const r = generateSession(input, SESSION_LIBRARY, createEngineContext({ clock: fixedClock(clock), seed: i + 1 }));
            if (r.status !== 'ok') return;
            checkPlan(r.plan, input);
            for (const e of r.plan.exercises) for (const s of e.sets) if (s.loadKg !== null) issued.push({ exerciseId: e.exerciseId, loadKg: s.loadKg, at: clock });
            diary.add(input, r.plan, performances[step.perf]!, new Date(clock).toISOString());
          });
          // In generation order: a later prescription is never more than 10 % above an earlier one of the same exercise
          // dated within 7 days before it, or dated after it (a clock moved back).
          for (let b = 0; b < issued.length; b++) {
            for (let a = 0; a < b; a++) {
              if (issued[a]!.exerciseId !== issued[b]!.exerciseId || issued[a]!.at < issued[b]!.at - 7 * DAY) continue;
              expect(issued[b]!.loadKg).toBeLessThanOrEqual(issued[a]!.loadKg * 1.1 + 1e-9);
            }
          }
        },
      ),
      { numRuns: 400 },
    );
  }, 180_000);
});
