import { z } from 'zod';
import { IsoDateTimeSchema, SupersedesSchema, UuidSchema } from './common.js';
import { defineConfig } from './config.js';
import {
  EquipmentIdSchema,
  EquipmentLocationSchema,
  JointSchema,
  SafetyProfileSchema,
  ScreeningQuestionIdSchema,
  SlugSchema,
} from './exercise.js';

/**
 * M01 — Onboarding, health screening and dynamic profile contracts
 * (docs/specs/M01-onboarding-screening-profile.md, ADR-012).
 *
 * Entities: Profile, Goal, EquipmentProfile, ScreeningResponse, SafetyProfile
 * (in exercise.ts, extended by M01) and Limitation. Stored on the device and
 * synced (ADR-002): `profile` and `equipment_profiles` are mutable,
 * `screenings` is append-only (a re-screen is a new record; the latest counts).
 */

/** A calendar date as entered (no time zone). */
export const CalendarDateSchema = z.strictObject({
  year: z.number().int().min(1),
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
});
export type CalendarDateValue = z.infer<typeof CalendarDateSchema>;

export const GOAL_IDS = ['fat_loss', 'muscle_gain', 'strength', 'calisthenics_skills', 'general_health', 'endurance'] as const;
export const GoalIdSchema = z.enum(GOAL_IDS);
export type GoalId = z.infer<typeof GoalIdSchema>;

export const GoalsSchema = z
  .strictObject({ primary: GoalIdSchema, secondary: GoalIdSchema.nullable() })
  .refine((g) => g.secondary !== g.primary, { message: 'secondary goal must differ from the primary goal' });
export type Goals = z.infer<typeof GoalsSchema>;

/** Self-reported training experience; boundaries are explained in the copy. */
export const EXPERIENCE_LEVELS = ['none', 'returning', 'beginner', 'intermediate', 'advanced'] as const;
export const ExperienceLevelSchema = z.enum(EXPERIENCE_LEVELS);
export type ExperienceLevel = z.infer<typeof ExperienceLevelSchema>;

export const TRAINING_TIMES = ['early_morning', 'morning', 'midday', 'afternoon', 'evening'] as const;
export const TrainingTimeSchema = z.enum(TRAINING_TIMES);
export type TrainingTime = z.infer<typeof TrainingTimeSchema>;

/** Session-length choices offered in onboarding (UI options, not coefficients). */
export const SESSION_MINUTES_OPTIONS = [15, 20, 30, 40, 45, 60, 75, 90] as const;
export const DAYS_PER_WEEK_OPTIONS = [1, 2, 3, 4, 5, 6, 7] as const;

export const ScheduleSchema = z.strictObject({
  daysPerWeek: z.number().int().min(1).max(7),
  minutesPerSession: z.number().int().refine((m) => (SESSION_MINUTES_OPTIONS as readonly number[]).includes(m), { message: 'unsupported session length' }),
  preferredTimes: z.array(TrainingTimeSchema).max(TRAINING_TIMES.length),
  remindersEnabled: z.boolean(),
});
export type Schedule = z.infer<typeof ScheduleSchema>;

/**
 * Plausibility bounds for optional biometrics. They only catch typing errors
 * (they are not health thresholds) and carry no external source.
 */
export const PROFILE_INPUT_BOUNDS = defineConfig({
  heightCmMin: { value: 100, unit: 'cm', source: 'engineering default: input plausibility bound (M01), no external source', validated: false },
  heightCmMax: { value: 250, unit: 'cm', source: 'engineering default: input plausibility bound (M01), no external source', validated: false },
  weightKgMin: { value: 25, unit: 'kg', source: 'engineering default: input plausibility bound (M01), no external source', validated: false },
  weightKgMax: { value: 350, unit: 'kg', source: 'engineering default: input plausibility bound (M01), no external source', validated: false },
  bodyFatPercentMin: { value: 2, unit: '%', source: 'engineering default: input plausibility bound (M01), no external source', validated: false },
  bodyFatPercentMax: { value: 70, unit: '%', source: 'engineering default: input plausibility bound (M01), no external source', validated: false },
  motivationMaxLength: { value: 120, unit: 'characters', source: 'M01 spec ("one-line motivation anchor"); length chosen by the engineer', validated: false },
});
const bound = (key: keyof typeof PROFILE_INPUT_BOUNDS) => PROFILE_INPUT_BOUNDS[key].value;

/** Every field is optional and can be deferred (M01 rule: never blocks progress). Metric internally. */
export const BiometricsSchema = z.strictObject({
  heightCm: z.number().min(bound('heightCmMin')).max(bound('heightCmMax')).nullable(),
  weightKg: z.number().min(bound('weightKgMin')).max(bound('weightKgMax')).nullable(),
  bodyFatPercent: z.number().min(bound('bodyFatPercentMin')).max(bound('bodyFatPercentMax')).nullable(),
});
export type Biometrics = z.infer<typeof BiometricsSchema>;
export const EMPTY_BIOMETRICS: Biometrics = Object.freeze({ heightCm: null, weightKg: null, bodyFatPercent: null });

/** A limitation: a body region to treat with caution (no diagnosis, no free text). */
export const LimitationSchema = z.strictObject({ region: JointSchema });
export type Limitation = z.infer<typeof LimitationSchema>;

/** Record id of the single profile record of a user (sync record ids are UUIDs, scoped per user). */
export const PROFILE_RECORD_ID = '00000000-0000-4000-8000-000000000001';

export const ProfileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  goals: GoalsSchema,
  experience: ExperienceLevelSchema,
  schedule: ScheduleSchema,
  /** Needed for age-based safety rules (S4 under 18, S7 under 16) and the server-side age check. */
  birthDate: CalendarDateSchema,
  biometrics: BiometricsSchema,
  limitations: z.array(LimitationSchema).max(7),
  excludedExerciseIds: z.array(SlugSchema).max(200),
  motivation: z.string().trim().max(bound('motivationMaxLength')).nullable(),
  activeEquipmentProfileId: UuidSchema.nullable(),
  onboardingCompletedAt: IsoDateTimeSchema.nullable(),
});
export type Profile = z.infer<typeof ProfileSchema>;

/**
 * M02: the loads a place actually offers, so prescriptions round to the
 * smallest step the user's equipment allows (plates, dumbbell pairs, machine
 * stacks). Every list is optional information: an empty list (or null) means
 * "not known", and the engine then asks the user to choose a light load
 * rather than inventing a number. Metric, per implement (a dumbbell load is
 * per dumbbell).
 */
export const EquipmentLoadsSchema = z.strictObject({
  /** Barbell (and Smith machine bar) weight; null when unknown. */
  barKg: z.number().min(0).max(50).nullable(),
  /** Plate sizes available in pairs (e.g. 20, 10, 5, 2.5, 1.25; microplates 0.5, 0.25). */
  platePairsKg: z.array(z.number().positive().max(50)).max(20),
  /** Dumbbells available, kg per dumbbell (each one as a pair). */
  dumbbellsKg: z.array(z.number().positive().max(100)).max(80),
  kettlebellsKg: z.array(z.number().positive().max(100)).max(40),
  /** Weight-stack machines and cables: first step, step size and top of the stack. */
  stack: z
    .strictObject({ minKg: z.number().min(0).max(100), stepKg: z.number().positive().max(50), maxKg: z.number().positive().max(500) })
    .refine((s) => s.maxKg >= s.minKg, { message: 'stack top below its first step' })
    .nullable(),
});
export type EquipmentLoads = z.infer<typeof EquipmentLoadsSchema>;

/** One equipment profile per location (Home, Gym, Park, Travel), built from the M06 taxonomy. */
export const EquipmentProfileSchema = z.strictObject({
  location: EquipmentLocationSchema,
  equipment: z.array(EquipmentIdSchema).refine((ids) => new Set(ids).size === ids.length, { message: 'duplicate equipment' }),
  /** M02 (optional, added in place): the loads this place offers; absent = the engine's defaults for the location. */
  loads: EquipmentLoadsSchema.optional(),
});
export type EquipmentProfile = z.infer<typeof EquipmentProfileSchema>;

export const ScreeningAnswerSchema = z.enum(['yes', 'no']);
export type ScreeningAnswer = z.infer<typeof ScreeningAnswerSchema>;

/**
 * What the user answered. Every question must be answered: a missing answer
 * is not a "no" (fails closed in evaluateScreening).
 */
export const ScreeningResponsesSchema = z.strictObject({
  answers: z.partialRecord(ScreeningQuestionIdSchema, ScreeningAnswerSchema),
  /** S1: the user attests that a health professional cleared them for exercise. */
  clearanceAttested: z.boolean(),
  birthDate: CalendarDateSchema,
  answeredOn: CalendarDateSchema,
  limitations: z.array(LimitationSchema).max(7),
  excludedExerciseIds: z.array(SlugSchema).max(200),
});
export type ScreeningResponses = z.infer<typeof ScreeningResponsesSchema>;

export const SCREENING_REASONS = ['onboarding', 'annual', 'new_condition', 'clearance'] as const;
export const ScreeningReasonSchema = z.enum(SCREENING_REASONS);

/** One completed screening (append-only). The SafetyProfile is derived from the responses and re-checked by the server. */
export const ScreeningRecordSchema = z.strictObject({
  reason: ScreeningReasonSchema,
  responses: ScreeningResponsesSchema,
  safetyProfile: SafetyProfileSchema,
  completedAt: IsoDateTimeSchema,
  /** Record ids of the screenings this one replaces (ADR-023); absent on screenings stored before it. */
  supersedes: SupersedesSchema.optional(),
});
export type ScreeningRecord = z.infer<typeof ScreeningRecordSchema>;

/** Sync collection names used by M01 (packages/sync registers their policies). */
export const PROFILE_COLLECTIONS = { profile: 'profile', equipmentProfiles: 'equipment_profiles', screenings: 'screenings' } as const;
