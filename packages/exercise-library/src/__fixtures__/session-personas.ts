/**
 * Test-only session inputs for the six committee personas
 * (docs/specs/00-product-vision.md): a fictional starting-point check each,
 * the loads of their places and how they train in the simulation. Fictional
 * people; not built into dist.
 */
import { defaultEquipmentLoads, EMPTY_EQUIPMENT_LOADS } from '@fitadapt/engine';
import type { AssessmentResult, AssessmentTestResult, CalendarDateValue, EquipmentLoads, ExperienceLevel, JointFlags } from '@fitadapt/shared';
import { GYM_ID, HOME_ID, PARK_ID } from './personas.js';

type Done = { reps?: number; seconds?: number; loadKg?: number; rir?: number };
const done = (testId: string, exerciseId: string, m: Done): AssessmentTestResult => ({ status: 'done', testId, exerciseId, reps: m.reps ?? null, seconds: m.seconds ?? null, loadKg: m.loadKg ?? null, rir: m.rir ?? null });
const result = (protocolId: AssessmentResult['protocolId'], tests: AssessmentTestResult[]): AssessmentResult => ({ protocolId, protocolVersion: 1, stopRir: 2, startedAt: '2026-09-24T17:00:00.000Z', completedAt: '2026-09-24T17:30:00.000Z', tests });

export interface PersonaSession {
  readonly assessment: AssessmentResult;
  /** Loads per place (equipment profile id). */
  readonly loads: Readonly<Record<string, EquipmentLoads>>;
  readonly bodyweightKg: number;
  /** M03: height where the vision document gives it (P1 178 cm, P2 165 cm), for the BMI impact default. */
  readonly heightCm: number | null;
  readonly birthDate: CalendarDateValue;
  readonly experience: ExperienceLevel;
  readonly jointFlags: JointFlags;
  /** The load the person picks when the engine asks them to choose one (null: they log none). */
  readonly chosenKg: number | null;
  /** Weekdays the person cannot make (reported on the day; the engine reflows). */
  readonly misses: readonly string[];
}

const gym = defaultEquipmentLoads('gym');

export const PERSONA_SESSIONS: Record<'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6', PersonaSession> = {
  /** Ibrahima: home, one pair of 10 kg dumbbells, knees with an amber history. */
  P1: {
    assessment: result('home', [done('push_reps', 'knee_push_up', { reps: 4 }), done('dead_hang_hold', 'dead_hang', { seconds: 12 }), done('row_reps', 'pull_up', { reps: 0 }), done('squat_reps', 'air_squat', { reps: 15 }), done('plank_hold', 'knee_plank', { seconds: 25 })]),
    loads: { [HOME_ID]: { ...EMPTY_EQUIPMENT_LOADS, dumbbellsKg: [10] } },
    bodyweightKg: 120,
    heightCm: 178,
    birthDate: { year: 1988, month: 6, day: 1 },
    experience: 'beginner',
    jointFlags: { knee: 'amber' },
    chosenKg: 10,
    misses: [],
  },
  /** Awa: gym on Monday and Friday, P1's home on Wednesday; working toward a first strict pull-up. */
  P2: {
    assessment: result('home', [done('push_reps', 'knee_push_up', { reps: 12 }), done('dead_hang_hold', 'dead_hang', { seconds: 25 }), done('row_reps', 'pull_up', { reps: 0 }), done('squat_reps', 'air_squat', { reps: 20 }), done('plank_hold', 'front_plank', { seconds: 35 })]),
    loads: { [GYM_ID]: gym, [HOME_ID]: { ...EMPTY_EQUIPMENT_LOADS, dumbbellsKg: [10] } },
    bodyweightKg: 60,
    heightCm: 165,
    birthDate: { year: 1994, month: 6, day: 1 },
    experience: 'beginner',
    jointFlags: {},
    chosenKg: 8,
    misses: [],
  },
  /** David: commercial gym, hypertrophy, often misses Fridays. */
  P3: {
    assessment: result('gym', [
      done('squat_load', 'barbell_back_squat', { loadKg: 100, reps: 8, rir: 2 }),
      done('press_load', 'barbell_bench_press', { loadKg: 80, reps: 8, rir: 2 }),
      done('pulldown_load', 'lat_pulldown', { loadKg: 60, reps: 10, rir: 2 }),
      done('row_load', 'barbell_row', { loadKg: 70, reps: 8, rir: 2 }),
      done('hinge_load', 'barbell_romanian_deadlift', { loadKg: 90, reps: 8, rir: 2 }),
      done('plank_hold', 'front_plank', { seconds: 50 }),
    ]),
    loads: { [GYM_ID]: gym },
    bodyweightKg: 82,
    heightCm: null,
    birthDate: { year: 1982, month: 6, day: 1 },
    experience: 'intermediate',
    jointFlags: {},
    chosenKg: 20,
    misses: ['fri'],
  },
  /** Mariam: home with a chair, a mat and a band; controlled hypertension, cleared with restrictions; 55+ check. */
  P4: {
    assessment: result('home_55plus', [done('chair_stand', 'box_squat', { reps: 10 }), done('push_reps_55', 'incline_push_up_high', { reps: 8 }), done('plank_hold_55', 'knee_plank', { seconds: 20 })]),
    loads: { [HOME_ID]: EMPTY_EQUIPMENT_LOADS },
    bodyweightKg: 70,
    heightCm: null,
    birthDate: { year: 1964, month: 6, day: 1 },
    experience: 'returning',
    jointFlags: {},
    chosenKg: null,
    misses: [],
  },
  /** Ousmane: full gym with microplates (0.25 kg plates → 0.5 kg barbell steps), strength. */
  P5: {
    assessment: result('gym', [
      done('squat_load', 'barbell_back_squat', { loadKg: 160, reps: 8, rir: 2 }),
      done('press_load', 'barbell_bench_press', { loadKg: 110, reps: 8, rir: 2 }),
      done('pulldown_load', 'lat_pulldown', { loadKg: 80, reps: 10, rir: 2 }),
      done('row_load', 'barbell_row', { loadKg: 100, reps: 8, rir: 2 }),
      done('hinge_load', 'barbell_romanian_deadlift', { loadKg: 140, reps: 6, rir: 2 }),
      done('plank_hold', 'front_plank', { seconds: 50 }),
    ]),
    loads: { [GYM_ID]: { ...gym, platePairsKg: [...gym.platePairsKg, 0.5, 0.25] } },
    bodyweightKg: 93,
    heightCm: null,
    birthDate: { year: 1997, month: 6, day: 1 },
    experience: 'advanced',
    jointFlags: {},
    chosenKg: 30,
    misses: [],
  },
  /** Léa-type: park bars, bench and her own rings; advanced calisthenics. */
  P6: {
    assessment: result('home', [done('push_reps', 'push_up', { reps: 25 }), done('dead_hang_hold', 'dead_hang', { seconds: 45 }), done('row_reps', 'pull_up', { reps: 14 }), done('squat_reps', 'air_squat', { reps: 30 }), done('plank_hold', 'front_plank', { seconds: 90 })]),
    loads: { [PARK_ID]: EMPTY_EQUIPMENT_LOADS },
    bodyweightKg: 58,
    heightCm: null,
    birthDate: { year: 1999, month: 6, day: 1 },
    experience: 'advanced',
    jointFlags: {},
    chosenKg: null,
    misses: [],
  },
};
