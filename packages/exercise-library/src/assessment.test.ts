import { SAFE_FACTS } from './__fixtures__/session-personas.js';
import {
  ASSESSMENT_PROTOCOLS,
  ASSESSMENT_REASON_CODES,
  SESSION_REASON_CODES,
  DEFAULT_SLOT_LADDERS,
  createEngineContext,
  fixedClock,
  hasEquipment,
  loadForReps,
  recommendProtocol,
  roundDownToIncrement,
  type AssessmentPlan,
} from '@fitadapt/engine';
import { en, fr } from '@fitadapt/i18n';
import { evaluateScreening } from '@fitadapt/safety';
import { SCREENING_QUESTION_IDS, type AssessmentResult, type AssessmentTestResult, type EquipmentId, type ScreeningQuestionId } from '@fitadapt/shared';
import { describe, expect, it } from 'vitest';
import { EQUIPMENT_PRESETS, LADDERS, buildAssessmentPlan, buildCapacityModel, generateSession, hasGymEquipment, seedLibrary, sessionLibrary } from './index.js';

/**
 * M07 against the real M06 seed (goal condition 4): an assessment completed
 * by persona P1 (home) and P5 (gym) produces a CapacityModel that
 * generateSession() uses for the first session. Personas are fictional
 * (docs/specs/00-product-vision.md).
 */
const lib = seedLibrary();
const NOW = Date.parse('2026-09-24T07:00:00.000Z');
const ctx = () => createEngineContext({ clock: fixedClock(NOW), seed: 2026 });
const profile = (yes: ScreeningQuestionId[] = [], birthYear = 1988) =>
  evaluateScreening({
    answers: Object.fromEntries(SCREENING_QUESTION_IDS.map((q) => [q, yes.includes(q) ? 'yes' : 'no'])),
    clearanceAttested: false,
    birthDate: { year: birthYear, month: 3, day: 1 },
    answeredOn: { year: 2026, month: 9, day: 23 },
    limitations: [],
    excludedExerciseIds: [],
  });
const done = (testId: string, exerciseId: string, m: { reps?: number; seconds?: number; loadKg?: number; rir?: number }): AssessmentTestResult => ({
  status: 'done',
  testId,
  exerciseId,
  reps: m.reps ?? null,
  seconds: m.seconds ?? null,
  loadKg: m.loadKg ?? null,
  rir: m.rir ?? null,
});
const available = (plan: AssessmentPlan) => {
  if (plan.status !== 'available') throw new Error(plan.reasonCode);
  return plan;
};

/** SAF-2: the safety facts an assessment requires, at their "nothing reported" values. */
const ASSESS_FACTS = { jointFlags: {}, intensityLock: { locked: false, since: null }, birthDate: null, localDate: null, nowMs: Date.parse('2026-09-24T08:00:00.000Z') } as const;

describe('M07 protocols refer to the M06 seed', () => {
  it('every test variant is a seed exercise on the ladder its test maps to; default slot ladders exist', () => {
    for (const p of Object.values(ASSESSMENT_PROTOCOLS)) {
      for (const t of p.tests) {
        const ladder = LADDERS.find((l) => l.id === t.ladderId);
        expect(ladder, `${p.id}/${t.id}`).toBeDefined();
        for (const id of t.options) {
          expect(lib.byId.has(id), id).toBe(true);
          expect(ladder!.steps.some((s) => s.includes(id)), `${id} on ${t.ladderId}`).toBe(true);
        }
        // Test wording exists in both languages.
        for (const part of ['name', 'how']) {
          expect(en[`assessment.test.${t.messageId}.${part}` as keyof typeof en], `${t.messageId}.${part}`).toBeTruthy();
          expect(fr[`assessment.test.${t.messageId}.${part}` as keyof typeof fr]).toBeTruthy();
        }
      }
    }
    for (const id of Object.values(DEFAULT_SLOT_LADDERS)) expect(LADDERS.some((l) => l.id === id), id).toBe(true);
  });

  it('holds are the isometric seed exercises; loaded rungs come from the seed load types', () => {
    const s = sessionLibrary();
    expect(['dead_hang', 'knee_plank', 'front_plank'].every(s.isHold)).toBe(true);
    expect(['push_up', 'air_squat', 'barbell_back_squat'].some(s.isHold)).toBe(false);
    expect(s.loadType('barbell_back_squat')).toBe('external');
    expect(s.loadType('lat_pulldown')).toBe('machine');
    expect(s.loadType('nope')).toBeUndefined();
  });

  it('recommends by age and equipment: P4 (62) the 55+ protocol, P5 the gym, P1 home', () => {
    expect(recommendProtocol({ ageYears: 62, hasGymEquipment: false })).toBe('home_55plus');
    expect(hasGymEquipment(EQUIPMENT_PRESETS.full_gym)).toBe(true);
    expect(hasGymEquipment(['pull_up_bar', 'resistance_band', 'dumbbell'])).toBe(false);
    expect(recommendProtocol({ ageYears: 29, hasGymEquipment: hasGymEquipment(EQUIPMENT_PRESETS.full_gym) })).toBe('gym');
  });
});

describe('persona P1 (home: pull-up bar, bands, 2 × 10 kg dumbbells; 3 × 40 min; knees amber history)', () => {
  const equipment: EquipmentId[] = ['pull_up_bar', 'resistance_band', 'dumbbell'];
  const safetyProfile = profile([], 1988);

  it('"0 pull-ups" places him on the pull ladder; the CapacityModel drives his first session', () => {
    const plan = available(buildAssessmentPlan(ASSESSMENT_PROTOCOLS.home, { ...ASSESS_FACTS, safetyProfile, equipment }));
    expect(plan.stopRir).toBe(2);
    expect(plan.instructions.every((i) => !i.stop.toFailure && i.stop.rir === 2)).toBe(true);
    const offered = Object.fromEntries(plan.instructions.map((i) => [i.testId, i.options]));
    expect(offered.row_reps).toEqual(['pull_up']); // no low bar or rings at home: only the strict pull-up option
    expect(offered.squat_reps).toEqual(['air_squat']);

    const result: AssessmentResult = {
      protocolId: 'home',
      protocolVersion: 1,
      stopRir: plan.stopRir,
      startedAt: '2026-09-23T18:00:00.000Z',
      completedAt: '2026-09-23T18:13:00.000Z',
      tests: [
        done('push_reps', 'incline_push_up_high', { reps: 8 }),
        done('dead_hang_hold', 'dead_hang', { seconds: 12 }),
        done('row_reps', 'pull_up', { reps: 0 }),
        done('squat_reps', 'air_squat', { reps: 12 }),
        done('plank_hold', 'knee_plank', { seconds: 20 }),
      ],
    };
    const capacity = buildCapacityModel(result);
    const rungs = Object.fromEntries(capacity.slots.map((s) => [s.slot, [s.exerciseId, s.reasonCodes[0]]]));
    expect(rungs).toEqual({
      squat: ['air_squat', 'assessment.mapping.in_range'],
      horizontal_push: ['incline_push_up_high', 'assessment.mapping.in_range'],
      vertical_pull: ['dead_hang', 'assessment.mapping.in_range'],
      horizontal_pull: ['seated_band_row', 'assessment.mapping.not_tested_lowest_rung'],
      hinge: ['hip_hinge_drill', 'assessment.mapping.not_tested_lowest_rung'],
      core: ['knee_plank', 'assessment.mapping.in_range'],
    });

    const session = generateSession({ ...SAFE_FACTS, capacity, safetyProfile, equipment, minutesAvailable: 40, jointFlags: { knee: 'amber' } }, ctx());
    if (session.status !== 'ok') throw new Error(session.reasonCodes.join());
    const { plan: first } = session;
    expect(first.capacityAssessedAt).toBe(capacity.assessedAt);
    expect(first.estimatedMinutes).toBeLessThanOrEqual(40);
    for (const e of first.exercises) {
      const slot = capacity.slots.find((s) => s.slot === e.slot)!;
      expect(e.exerciseId).toBe(slot.exerciseId);
      expect(e.reasonCodes).toEqual(['session.exercise.from_assessment', ...slot.reasonCodes]);
      expect(e.sets.every((s) => s.target === slot.target || JSON.stringify(s.target) === JSON.stringify(slot.target))).toBe(true);
      expect(hasEquipment(lib.graph.exercises.get(e.exerciseId)!, new Set(equipment))).toBe(true);
    }
    expect(first.exercises.map((e) => e.exerciseId)).toEqual(['air_squat', 'incline_push_up_high', 'dead_hang', 'seated_band_row', 'hip_hinge_drill', 'knee_plank']);
  });
});

describe('persona P5 (advanced powerlifter, full gym with microplates, 4 × 75 min, goal strength)', () => {
  const equipment = [...EQUIPMENT_PRESETS.full_gym];
  const safetyProfile = profile([], 1997);

  it('submaximal load tests give RIR-adjusted Epley e1RMs; the first session loads come from them', () => {
    const plan = available(buildAssessmentPlan(ASSESSMENT_PROTOCOLS.gym, { ...ASSESS_FACTS, safetyProfile, equipment }));
    expect(plan.instructions.filter((i) => i.kind === 'load_reps').every((i) => i.stop.rir === 2 && i.stop.capReps === 12)).toBe(true);
    const result: AssessmentResult = {
      protocolId: 'gym',
      protocolVersion: 1,
      stopRir: plan.stopRir,
      startedAt: '2026-09-23T18:00:00.000Z',
      completedAt: '2026-09-23T18:35:00.000Z',
      tests: [
        done('squat_load', 'barbell_back_squat', { loadKg: 160, reps: 8, rir: 2 }),
        done('press_load', 'barbell_bench_press', { loadKg: 110, reps: 8, rir: 2 }),
        done('pulldown_load', 'lat_pulldown', { loadKg: 80, reps: 10, rir: 2 }),
        done('row_load', 'barbell_row', { loadKg: 100, reps: 8, rir: 2 }),
        done('hinge_load', 'barbell_romanian_deadlift', { loadKg: 140, reps: 6, rir: 2 }),
        done('plank_hold', 'front_plank', { seconds: 50 }),
      ],
    };
    const capacity = buildCapacityModel(result);
    const squat = capacity.slots.find((s) => s.slot === 'squat')!;
    expect(squat).toMatchObject({ exerciseId: 'barbell_back_squat', e1rmKg: 213.3, loadKg: 142.5 });
    expect(capacity.slots.find((s) => s.slot === 'hinge')).toMatchObject({ e1rmKg: 177.3 });

    const session = generateSession({ ...SAFE_FACTS, capacity, safetyProfile, equipment, minutesAvailable: 75, loadIncrementKg: 0.5 }, ctx());
    if (session.status !== 'ok') throw new Error(session.reasonCodes.join());
    const { plan: first } = session;
    expect(first.targetRir).toBe(3);
    for (const e of first.exercises) {
      const slot = capacity.slots.find((s) => s.slot === e.slot)!;
      expect(e.exerciseId).toBe(slot.exerciseId);
      if (slot.e1rmKg !== null) {
        const expected = roundDownToIncrement(loadForReps(slot.e1rmKg, 10, 3) * 0.9, 0.5);
        expect(e.sets.every((s) => s.loadKg === expected && s.reasonCodes.includes('session.load.from_e1rm'))).toBe(true);
      }
    }
    // Checked by hand: squat e1RM 160 × (1 + 10/30) = 213.3; 213.3 / (1 + 13/30) × 0.9 = 133.9 → 133.5 (0.5 kg plates).
    expect(first.exercises.map((e) => [e.exerciseId, e.sets[0]!.loadKg])).toEqual([
      ['barbell_back_squat', 133.5],
      ['barbell_bench_press', 92],
      ['lat_pulldown', 70],
      ['barbell_row', 83.5],
      ['barbell_romanian_deadlift', 111],
      ['front_plank', null],
    ]);
  });
});

describe('every M07 reason code has an FR and EN explanation, and the engine emits no other', () => {
  it('renders all assessment and session reason codes in both languages', () => {
    for (const code of [...ASSESSMENT_REASON_CODES, ...SESSION_REASON_CODES]) {
      expect(en[`engine.reason.${code}` as keyof typeof en], code).toBeTruthy();
      expect(fr[`engine.reason.${code}` as keyof typeof fr], code).toBeTruthy();
    }
  });

  it('codes emitted over many plans, capacity models and sessions are all in the lists', () => {
    const known = new Set([...ASSESSMENT_REASON_CODES, ...SESSION_REASON_CODES]);
    const seen = new Set<string>();
    const places: EquipmentId[][] = [[], ['pull_up_bar'], ['pull_up_bar', 'resistance_band', 'dumbbell'], ['sturdy_chair'], [...EQUIPMENT_PRESETS.full_gym], [...EQUIPMENT_PRESETS.park]];
    const profiles = [profile(), profile(['chest_discomfort']), profile(['bone_joint_back']), profile(['pregnancy_or_recent_birth']), profile([], 2015)];
    for (const p of Object.values(ASSESSMENT_PROTOCOLS)) {
      for (const safetyProfile of profiles) {
        for (const equipment of places) {
          const plan = buildAssessmentPlan(p, { ...ASSESS_FACTS, safetyProfile, equipment });
          if (plan.status === 'unavailable') {
            seen.add(plan.reasonCode);
            continue;
          }
          for (const i of plan.instructions) i.reasonCodes.forEach((c) => seen.add(c));
          for (const measure of [0, 3, 10, 40]) {
            const tests = plan.instructions.map((i): AssessmentTestResult =>
              i.options.length === 0
                ? { status: 'skipped', testId: i.testId, reason: i.skipReason! }
                : done(i.testId, i.options[i.options.length - 1]!, i.kind === 'hold' ? { seconds: measure } : i.kind === 'load_reps' ? { loadKg: measure * 2, reps: measure === 40 ? 14 : measure, rir: 2 } : { reps: measure }),
            );
            const capacity = buildCapacityModel({ protocolId: p.id, protocolVersion: p.version, stopRir: plan.stopRir, startedAt: '2026-09-23T18:00:00.000Z', completedAt: '2026-09-23T18:15:00.000Z', tests });
            capacity.slots.forEach((s) => s.reasonCodes.forEach((c) => seen.add(c)));
            for (const minutes of [10, 45]) {
              const session = generateSession({ ...SAFE_FACTS, capacity, safetyProfile, equipment, minutesAvailable: minutes, jointFlags: { knee: 'red' } }, ctx());
              if (session.status === 'unavailable') session.reasonCodes.forEach((c) => seen.add(c));
              else {
                session.plan.reasonCodes.forEach((c) => seen.add(c));
                session.plan.exercises.forEach((e) => [...e.reasonCodes, ...e.sets.flatMap((x) => x.reasonCodes)].forEach((c) => seen.add(c)));
              }
            }
          }
        }
      }
    }
    expect([...seen].filter((c) => !known.has(c))).toEqual([]);
    expect(seen.size).toBeGreaterThan(25);
  });
});
