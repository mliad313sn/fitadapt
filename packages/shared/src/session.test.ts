import { describe, expect, it } from 'vitest';
import {
  EquipmentLoadsSchema,
  EquipmentProfileSchema,
  ExecutionLogSchema,
  GenerateSessionResultSchema,
  PlannedSetSchema,
  ReasonParamsSchema,
  SessionPlanSchema,
  SetLogSchema,
} from './index.js';

const set = { index: 1, target: { kind: 'reps', min: 6, max: 10 }, loadKg: 60, targetRir: 2, restSeconds: 90, tempo: null, reasonCodes: ['session.progression.load_increased'], reasonParams: { deltaKg: 2.5 } };
const exercise = { slot: 'horizontal_push', role: 'primary', exerciseId: 'barbell_bench_press', ladderId: null, supersetGroup: null, sets: [set], reasonCodes: ['session.exercise.continued'] };
const plan = {
  planId: '11111111-1111-4111-8111-111111111111',
  kind: 'program_session',
  engineVersion: '0.2.0',
  rulesVersion: '0.1.0',
  generatedAt: '2026-09-28T08:00:00.000Z',
  seed: 1,
  capacityAssessedAt: null,
  program: { programId: '22222222-2222-4222-8222-222222222222', sessionId: 'w01.s1', date: '2026-09-28', week: 1, microcycleKind: 'accumulation', mesocycleIntent: 'hypertrophy' },
  equipmentProfileId: null,
  targetRir: 2,
  minutesAvailable: 45,
  estimatedMinutes: 40,
  warmUp: { minutes: 8, minimumMinutes: 5 },
  conditioning: null,
  exercises: [exercise],
  reasonCodes: ['session.program.from_program'],
};

describe('M02 session contracts', () => {
  it('every planned set carries at least one reason code; parameters are numbers with short names (no free text)', () => {
    expect(PlannedSetSchema.safeParse(set).success).toBe(true);
    expect(PlannedSetSchema.safeParse({ ...set, reasonCodes: [] }).success).toBe(false);
    expect(ReasonParamsSchema.safeParse({ note: 'chest pain' }).success).toBe(false);
    expect(ReasonParamsSchema.safeParse({ 'free text': 1 }).success).toBe(false);
    expect(PlannedSetSchema.safeParse({ ...set, tempo: { eccentricSeconds: 0 } }).success).toBe(false);
  });

  it('a plan needs an exercise or a conditioning block; a first session needs an exercise', () => {
    expect(SessionPlanSchema.safeParse(plan).success).toBe(true);
    expect(SessionPlanSchema.safeParse({ ...plan, exercises: [] }).success).toBe(false);
    expect(SessionPlanSchema.safeParse({ ...plan, exercises: [], conditioning: { kind: 'steady', placement: 'session', minutes: 30 } }).success).toBe(true);
    expect(SessionPlanSchema.safeParse({ ...plan, kind: 'first_session', exercises: [], conditioning: { kind: 'steady', placement: 'session', minutes: 30 } }).success).toBe(false);
    expect(SessionPlanSchema.safeParse({ ...plan, extra: true }).success).toBe(false);
    expect(GenerateSessionResultSchema.safeParse({ status: 'unavailable', reasonCodes: [] }).success).toBe(false);
  });

  it('equipment loads (in place, optional on the M01 equipment profile)', () => {
    const loads = { barKg: 20, platePairsKg: [20, 10, 1.25], dumbbellsKg: [10], kettlebellsKg: [], stack: { minKg: 5, stepKg: 5, maxKg: 100 } };
    expect(EquipmentLoadsSchema.safeParse(loads).success).toBe(true);
    expect(EquipmentLoadsSchema.safeParse({ ...loads, stack: { minKg: 50, stepKg: 5, maxKg: 10 } }).success).toBe(false);
    expect(EquipmentProfileSchema.safeParse({ location: 'home', equipment: ['dumbbell'] }).success).toBe(true);
    expect(EquipmentProfileSchema.safeParse({ location: 'home', equipment: ['dumbbell'], loads }).success).toBe(true);
    expect(EquipmentProfileSchema.safeParse({ location: 'home', equipment: ['dumbbell'], loads: { ...loads, dumbbellsKg: [-1] } }).success).toBe(false);
  });

  it('set logs and execution logs are closed records (append-only collections)', () => {
    const log = { schemaVersion: 1, planId: plan.planId, exerciseIndex: 0, exerciseId: 'barbell_bench_press', set: { index: 1, status: 'done', reps: 10, seconds: null, loadKg: 60, rir: 2 }, loggedAt: plan.generatedAt, correctionOf: null };
    expect(SetLogSchema.safeParse(log).success).toBe(true);
    expect(SetLogSchema.safeParse({ ...log, note: 'felt great' }).success).toBe(false);
    expect(SetLogSchema.safeParse({ ...log, set: { ...log.set, reps: 101 } }).success).toBe(false);
    expect(ExecutionLogSchema.safeParse({ kind: 'red_flag', planId: plan.planId, symptom: 'chest_pain_pressure', at: plan.generatedAt }).success).toBe(true);
    expect(ExecutionLogSchema.safeParse({ kind: 'red_flag', planId: plan.planId, symptom: 'headache', at: plan.generatedAt }).success).toBe(false);
    expect(ExecutionLogSchema.safeParse({ kind: 'pain', planId: null, joint: 'knee', score: 11, at: plan.generatedAt }).success).toBe(false);
    expect(ExecutionLogSchema.safeParse({ kind: 'swapped', planId: plan.planId, exerciseIndex: 0, fromExerciseId: 'barbell_bench_press', replacement: exercise, reason: 'user', at: plan.generatedAt }).success).toBe(true);
    expect(ExecutionLogSchema.safeParse({ kind: 'medical_review_attested', at: plan.generatedAt }).success).toBe(true);
  });
});
