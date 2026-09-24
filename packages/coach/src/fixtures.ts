import { createEngineContext, defaultEquipmentLoads, fixedClock, programDay, programSessionContext, type GenerateSessionInput } from '@fitadapt/engine';
import { EQUIPMENT_PRESETS, buildCapacityModel, generateProgram, generateSession } from '@fitadapt/exercise-library';
import { evaluateScreening } from '@fitadapt/safety';
import { SCREENING_QUESTION_IDS, type AssessmentResult, type CoachContext, type EquipmentId, type ProgramInput, type ProgramRecord, type SafetyProfile } from '@fitadapt/shared';

/**
 * Fictional test users for the coach (no real person, L12): an intermediate
 * gym user on a hypertrophy program, on the program's first Monday.
 */
export const GYM: EquipmentId[] = [...EQUIPMENT_PRESETS.full_gym];
export const MONDAY = '2026-09-28';
export const NOW = Date.parse('2026-09-28T07:00:00.000Z');
export const BIRTH = { year: 1982, month: 5, day: 4 };
const GYM_ID = '0b9a6f2e-4d1c-4a57-9e7b-2f3c8d9e1a01';

export function safetyProfile(yes: string[] = [], clearance = false): SafetyProfile {
  const answers = Object.fromEntries(SCREENING_QUESTION_IDS.map((q) => [q, yes.includes(q) ? 'yes' : 'no']));
  return evaluateScreening({ answers, clearanceAttested: clearance, birthDate: BIRTH, answeredOn: { year: 2026, month: 9, day: 24 }, limitations: [], excludedExerciseIds: [] } as Parameters<typeof evaluateScreening>[0]);
}

const gymResult: AssessmentResult = {
  protocolId: 'gym',
  protocolVersion: 1,
  stopRir: 2,
  startedAt: '2026-09-24T17:00:00.000Z',
  completedAt: '2026-09-24T17:30:00.000Z',
  tests: [
    { status: 'done', testId: 'squat_load', exerciseId: 'barbell_back_squat', loadKg: 100, reps: 8, rir: 2, seconds: null },
    { status: 'done', testId: 'press_load', exerciseId: 'barbell_bench_press', loadKg: 80, reps: 8, rir: 2, seconds: null },
    { status: 'done', testId: 'pulldown_load', exerciseId: 'lat_pulldown', loadKg: 60, reps: 10, rir: 2, seconds: null },
    { status: 'done', testId: 'row_load', exerciseId: 'barbell_row', loadKg: 70, reps: 8, rir: 2, seconds: null },
    { status: 'done', testId: 'hinge_load', exerciseId: 'barbell_romanian_deadlift', loadKg: 90, reps: 8, rir: 2, seconds: null },
    { status: 'done', testId: 'plank_hold', exerciseId: 'front_plank', loadKg: null, reps: null, seconds: 50, rir: null },
  ],
};

export function programRecord(sp: SafetyProfile): ProgramRecord {
  const r = tryProgram(sp);
  if (!r) throw new Error('program unavailable');
  return r;
}

export function tryProgram(sp: SafetyProfile): ProgramRecord | null {
  const input: ProgramInput = { goals: { primary: 'muscle_gain', secondary: null }, experience: 'intermediate', daysPerWeek: 3, minutesPerSession: 45, trainingDays: null, startDate: MONDAY, safetyProfile: sp, locations: [{ equipmentProfileId: GYM_ID, location: 'gym', equipment: GYM }], defaultEquipmentProfileId: GYM_ID, locationByWeekday: {}, previousGoal: null };
  const r = generateProgram(input, createEngineContext({ clock: fixedClock(Date.parse('2026-09-24T08:00:00.000Z')), seed: 42 }));
  if (r.status !== 'ok') return null;
  return { reason: 'first', input, program: r.program };
}

export interface ContextOptions {
  readonly locale?: 'fr' | 'en';
  readonly yes?: string[];
  readonly over?: Partial<GenerateSessionInput>;
  readonly started?: boolean;
  readonly withPlan?: boolean;
  readonly withProgram?: boolean;
}

export function gymContext(options: ContextOptions = {}): CoachContext {
  const sp = safetyProfile(options.yes ?? []);
  const program = tryProgram(sp);
  const day = program ? programDay(program.program, [], MONDAY) : null;
  const input: GenerateSessionInput = {
    safetyProfile: sp,
    equipment: GYM,
    equipmentLoads: defaultEquipmentLoads('gym'),
    equipmentProfileId: GYM_ID,
    minutesAvailable: 45,
    capacity: buildCapacityModel(gymResult),
    programSession: day ? programSessionContext(day, day.sessions[0]!) : null,
    history: [],
    birthDate: BIRTH,
    experience: 'intermediate',
    intensityLock: { locked: false, since: null },
    ...options.over,
  };
  const generated = generateSession(input, createEngineContext({ clock: fixedClock(NOW), seed: 7 }));
  const plan = options.withPlan === false || generated.status !== 'ok' ? null : generated.plan;
  return {
    locale: options.locale ?? 'en',
    jurisdiction: 'GB',
    today: { input: input as CoachContext['today'] extends infer T ? (T extends { input: infer I } ? I : never) : never, plan, started: options.started ?? false, generatedAt: new Date(NOW).toISOString(), seed: 7 },
    program: options.withProgram === false || !program ? null : { record: program, reflows: [], today: MONDAY },
  };
}

let n = 0;
/** Deterministic record ids for tests. */
export function testEnv(nowMs = NOW) {
  return { nowMs, seed: 11, newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` };
}
