/**
 * Test-only fictional library and inputs for the M02 session tests (not
 * built into dist). It extends the M07 fixture exercises with every movement
 * pattern a program uses, tags (negatives, skills), %-bodyweight
 * coefficients and SUBSTITUTES edges, so exercise choice, progression,
 * substitution and the Anywhere Switcher can be exercised without the seed.
 * packages/exercise-library re-runs the persona sessions on the real seed.
 */
import type { EquipmentId, EquipmentLoads, ExerciseTag, LoadType, ProgramSessionContext, ProgramSlot, ScheduledSession } from '@fitadapt/shared';
import type { SessionLibrary } from '../session/library.js';
import { createExerciseGraph, type GraphExercise } from '../substitution.js';
import { FIXTURE_EXERCISES, FIXTURE_LADDERS, FIXTURE_LIBRARY } from './library.js';

type Extra = { id: string; pattern: GraphExercise['pattern']; eq?: (EquipmentId | EquipmentId[])[]; lt?: LoadType; hold?: boolean; tags?: ExerciseTag[]; skill?: GraphExercise['skill']; joints?: Partial<GraphExercise['jointLoad']>; ci?: GraphExercise['contraindications'] };

const EXTRAS: Extra[] = [
  { id: 'pike_push_up', pattern: 'vertical_push', ci: ['inversion'], joints: { shoulder: 'high' } },
  { id: 'wall_handstand_hold', pattern: 'vertical_push', hold: true, ci: ['inversion'], skill: 'advanced', joints: { shoulder: 'high', wrist: 'high' } },
  { id: 'band_overhead_press', pattern: 'vertical_push', eq: ['resistance_band'], lt: 'band', joints: { shoulder: 'medium' } },
  { id: 'seated_dumbbell_shoulder_press', pattern: 'vertical_push', eq: ['dumbbell'], lt: 'external', joints: { shoulder: 'high' } },
  { id: 'barbell_overhead_press', pattern: 'vertical_push', eq: ['barbell'], lt: 'external', skill: 'intermediate', joints: { shoulder: 'high', lumbar: 'medium' } },
  { id: 'dumbbell_curl', pattern: 'isolation', eq: ['dumbbell'], lt: 'external', joints: { elbow: 'medium' } },
  { id: 'band_curl', pattern: 'isolation', eq: ['resistance_band'], lt: 'band', joints: { elbow: 'low' } },
  { id: 'cable_triceps_pushdown', pattern: 'isolation', eq: ['cable_station'], lt: 'machine', joints: { elbow: 'medium' } },
  { id: 'farmer_carry', pattern: 'carry', eq: [['dumbbell', 'kettlebell']], lt: 'external', hold: true },
  { id: 'supported_single_leg_stand', pattern: 'balance', hold: true, tags: ['balance', 'supported'], skill: 'entry', joints: { knee: 'low', ankle: 'medium' } },
  { id: 'tandem_stance', pattern: 'balance', hold: true, tags: ['balance'], skill: 'entry', joints: { knee: 'low', ankle: 'low' } },
  { id: 'hip_circles', pattern: 'mobility', tags: ['mobility'], skill: 'entry', joints: { knee: 'low' } },
  { id: 'reverse_lunge', pattern: 'lunge', joints: { knee: 'high' } },
  { id: 'supported_reverse_lunge', pattern: 'lunge', eq: [['sturdy_chair', 'box']], tags: ['supported'], joints: { knee: 'medium' } },
  { id: 'dumbbell_reverse_lunge', pattern: 'lunge', eq: ['dumbbell'], lt: 'external', joints: { knee: 'high' } },
  { id: 'glute_bridge', pattern: 'hinge', joints: { knee: 'low', lumbar: 'low' } },
  { id: 'dead_bug', pattern: 'core', skill: 'entry', joints: { knee: 'low' } },
  { id: 'negative_dip', pattern: 'horizontal_push', eq: ['parallel_bars'], tags: ['eccentric_focus'], skill: 'intermediate', joints: { shoulder: 'high', elbow: 'high' } },
  { id: 'muscle_up_transition', pattern: 'vertical_pull', eq: ['gymnastic_rings'], tags: ['calisthenics_skill'], skill: 'advanced', ci: ['hanging'], joints: { shoulder: 'high', elbow: 'high' } },
  { id: 'burpee', pattern: 'locomotion', tags: ['conditioning'], joints: { knee: 'high' } },
];

const BASE_TAGS: Record<string, ExerciseTag[]> = { negative_pull_up: ['eccentric_focus'], knee_plank: ['isometric'], front_plank: ['isometric'], dead_hang: ['isometric'] };
const BW: Record<string, number> = { wall_push_up: 0.2, incline_push_up_high: 0.3, incline_push_up_low: 0.41, knee_push_up: 0.49, push_up: 0.64, diamond_push_up: 0.64, deficit_push_up: 0.66, archer_push_up: 0.75, pull_up: 0.95, air_squat: 0.7, box_squat: 0.7, split_squat: 0.7 };

const low = { shoulder: 'low', elbow: 'low', wrist: 'low', lumbar: 'low', hip: 'low', knee: 'medium', ankle: 'low' } as const;

export const SESSION_EXERCISES: GraphExercise[] = [
  ...FIXTURE_EXERCISES,
  ...EXTRAS.map((x) => ({
    id: x.id,
    pattern: x.pattern,
    skill: x.skill ?? 'beginner',
    impact: 'none' as const,
    jointLoad: { ...low, ...(x.joints ?? {}) },
    equipment: (x.eq ?? []).map((g) => ({ anyOf: Array.isArray(g) ? g : [g] })),
    contraindications: x.ci ?? [],
  })),
];

const extra = new Map(EXTRAS.map((x) => [x.id, x]));

/** SUBSTITUTES edges within a pattern (similarity 0.8 for a shared ladder, 0.6 otherwise) — enough for the switcher. */
function edges() {
  const out: { type: 'SUBSTITUTES'; from: string; to: string; similarity: number; validated: false; source: string }[] = [];
  for (const a of SESSION_EXERCISES) {
    for (const b of SESSION_EXERCISES) {
      if (a.id === b.id || a.pattern !== b.pattern) continue;
      const sharedLadder = FIXTURE_LADDERS.some((l) => l.steps.flat().includes(a.id) && l.steps.flat().includes(b.id));
      out.push({ type: 'SUBSTITUTES', from: a.id, to: b.id, similarity: sharedLadder ? 0.8 : 0.6, validated: false, source: 'fixture' });
    }
  }
  return out;
}

export const SESSION_LADDERS = [
  ...FIXTURE_LADDERS,
  { id: 'vertical_push_bodyweight', steps: [['pike_push_up'], ['wall_handstand_hold']] },
  { id: 'vertical_push_loaded', steps: [['band_overhead_press'], ['seated_dumbbell_shoulder_press'], ['barbell_overhead_press']] },
  { id: 'lunge', steps: [['supported_reverse_lunge'], ['reverse_lunge']] },
  { id: 'balance', steps: [['supported_single_leg_stand'], ['tandem_stance']] },
];

export const SESSION_LIBRARY: SessionLibrary = {
  ladders: SESSION_LADDERS,
  isHold: (id) => FIXTURE_LIBRARY.isHold(id) || extra.get(id)?.hold === true,
  loadType: (id) => (extra.has(id) ? (extra.get(id)!.lt ?? 'bodyweight') : FIXTURE_LIBRARY.loadType(id)),
  tags: (id) => [...(BASE_TAGS[id] ?? []), ...(extra.get(id)?.tags ?? [])],
  bodyweightLoad: (id) => BW[id] ?? null,
  graph: createExerciseGraph(SESSION_EXERCISES, [...(edges() as never[])]),
};

/** Fixture gym loads: 20 kg bar, plates down to 1.25 kg (2.5 kg steps), dumbbells 2–40 kg by 2, stack 5–100 by 5. */
export const GYM_LOADS: EquipmentLoads = {
  barKg: 20,
  platePairsKg: [20, 10, 5, 2.5, 1.25],
  dumbbellsKg: Array.from({ length: 20 }, (_, i) => 2 * (i + 1)),
  kettlebellsKg: [8, 12, 16, 20, 24],
  stack: { minKg: 5, stepKg: 5, maxKg: 100 },
};
/** P1-like home: one pair of 10 kg dumbbells. */
export const HOME_LOADS: EquipmentLoads = { barKg: null, platePairsKg: [], dumbbellsKg: [10], kettlebellsKg: [], stack: null };

export const GYM_ID = '22222222-2222-4222-8222-222222222222';
export const HOME_ID = '11111111-1111-4111-8111-111111111111';

const slot = (pattern: ProgramSlot['pattern'], role: ProgramSlot['role'], intent: ProgramSlot['intent'], hardSets: number): ProgramSlot => ({ pattern, role, intent, hardSets });

/** A full-body program session (the M08 shape after programDay), fictional. */
export function programContext(over: Partial<ScheduledSession> & { kind?: 'accumulation' | 'deload' | 'transition'; intent?: 'hypertrophy' | 'strength' | 'general' | 'skill'; week?: number } = {}): ProgramSessionContext {
  const { kind = 'accumulation', intent = 'hypertrophy', week = 1, ...session } = over;
  const slotIntent = intent === 'strength' ? 'strength' : intent === 'general' ? 'general' : intent === 'skill' ? 'skill' : 'hypertrophy';
  const base: ScheduledSession = {
    id: 'w01.s1',
    date: '2026-09-28',
    weekday: 'mon',
    focus: 'full_body',
    equipmentProfileId: GYM_ID,
    location: 'gym',
    slots: [slot('squat', 'primary', slotIntent, 3), slot('horizontal_push', 'primary', slotIntent, 3), slot('horizontal_pull', 'primary', slotIntent, 3), slot('hinge', 'secondary', slotIntent, 2), slot('vertical_push', 'accessory', slotIntent, 2), slot('core', 'accessory', slotIntent, 2)],
    conditioning: null,
    targetRpe: 8,
    hardPatterns: ['squat', 'horizontal_push', 'horizontal_pull'],
    heavyLower: true,
    priority: 2,
    estimatedMinutes: 50,
    reasonCodes: ['program.session.full_body'],
    ...session,
  };
  return { programId: '44444444-4444-4444-8444-444444444444', session: { ...base, originalDate: base.date, state: 'planned', mergedFrom: [] }, microcycle: { week, kind, volumeFactor: kind === 'deload' ? 0.5 : 1 }, mesocycle: { index: 1, intent } };
}

export { slot };
