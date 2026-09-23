/**
 * Test-only program inputs for the six committee personas
 * (docs/specs/00-product-vision.md). Fictional people; not built into dist.
 */
import { evaluateScreening } from '@fitadapt/safety';
import { SCREENING_QUESTION_IDS, type EquipmentId, type Joint, type ProgramInput, type ScreeningQuestionId } from '@fitadapt/shared';
import { EQUIPMENT_PRESETS } from '../taxonomy.js';

export const HOME_ID = '11111111-1111-4111-8111-111111111111';
export const GYM_ID = '22222222-2222-4222-8222-222222222222';
export const PARK_ID = '33333333-3333-4333-8333-333333333333';

function safety(birthYear: number, yes: ScreeningQuestionId[] = [], options: { clearance?: boolean; limitations?: Joint[] } = {}) {
  return evaluateScreening({
    answers: Object.fromEntries(SCREENING_QUESTION_IDS.map((q) => [q, yes.includes(q) ? 'yes' : 'no'])),
    clearanceAttested: options.clearance ?? false,
    birthDate: { year: birthYear, month: 6, day: 1 },
    answeredOn: { year: 2026, month: 9, day: 23 },
    limitations: (options.limitations ?? []).map((region) => ({ region })),
    excludedExerciseIds: [],
  });
}

const place = (equipmentProfileId: string, location: 'home' | 'gym' | 'park', equipment: readonly EquipmentId[]) => ({ equipmentProfileId, location, equipment: [...equipment] });
const P1_HOME: EquipmentId[] = ['pull_up_bar', 'resistance_band', 'dumbbell'];
const base = { trainingDays: null, startDate: '2026-09-28', locationByWeekday: {}, previousGoal: null, defaultEquipmentProfileId: null } as const;

export const PERSONA_INPUTS: Record<'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6', ProgramInput> = {
  /** Ibrahima: 38, beginner, home (pull-up bar, bands, 2×10 kg dumbbells), 3×40 min, fat loss, knees: amber history. */
  P1: { ...base, goals: { primary: 'fat_loss', secondary: null }, experience: 'beginner', daysPerWeek: 3, minutesPerSession: 40, safetyProfile: safety(1988, ['bone_joint_back'], { limitations: ['knee'] }), locations: [place(HOME_ID, 'home', P1_HOME)] },
  /** Awa: 32, beginner, home + gym, 3×45 min, first strict pull-up + tone; trains with P1 at home. */
  P2: {
    ...base,
    goals: { primary: 'calisthenics_skills', secondary: 'muscle_gain' },
    experience: 'beginner',
    daysPerWeek: 3,
    minutesPerSession: 45,
    safetyProfile: safety(1994),
    locations: [place(HOME_ID, 'home', P1_HOME), place(GYM_ID, 'gym', EQUIPMENT_PRESETS.full_gym)],
    defaultEquipmentProfileId: GYM_ID,
    locationByWeekday: { wed: HOME_ID },
  },
  /** David: 44, intermediate (3 yrs), commercial gym, 3×45 min, hypertrophy, often misses Fridays. */
  P3: { ...base, goals: { primary: 'muscle_gain', secondary: null }, experience: 'intermediate', daysPerWeek: 3, minutesPerSession: 45, safetyProfile: safety(1982), locations: [place(GYM_ID, 'gym', EQUIPMENT_PRESETS.full_gym)] },
  /** Mariam: 62, returning after 10 yrs, home, 3×30 min, health/balance, controlled hypertension (cleared with restrictions). */
  P4: { ...base, goals: { primary: 'general_health', secondary: null }, experience: 'returning', daysPerWeek: 3, minutesPerSession: 30, safetyProfile: safety(1964, ['heart_or_blood_pressure'], { clearance: true }), locations: [place(HOME_ID, 'home', ['sturdy_chair', 'exercise_mat', 'resistance_band'])] },
  /** Ousmane: 29, advanced powerlifter, full gym with microplates, 4×75 min, strength. */
  P5: { ...base, goals: { primary: 'strength', secondary: null }, experience: 'advanced', daysPerWeek: 4, minutesPerSession: 75, safetyProfile: safety(1997), locations: [place(GYM_ID, 'gym', EQUIPMENT_PRESETS.full_gym)] },
  /** Léa-type: 27, advanced calisthenics, park + rings, 5×60 min, skills (muscle-up). */
  P6: { ...base, goals: { primary: 'calisthenics_skills', secondary: null }, experience: 'advanced', daysPerWeek: 5, minutesPerSession: 60, safetyProfile: safety(1999), locations: [place(PARK_ID, 'park', [...new Set<EquipmentId>([...EQUIPMENT_PRESETS.park, 'gymnastic_rings'])])] },
};
