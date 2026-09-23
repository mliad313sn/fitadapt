import { z } from 'zod';
import { IsoDateTimeSchema, UuidSchema } from './common.js';
import { SlugSchema } from './exercise.js';

/**
 * M07 — Assessment & benchmark testing contracts
 * (docs/specs/M07-assessment-benchmarks.md, ADR-014).
 *
 * Entities: AssessmentProtocol (defined as data in packages/engine),
 * AssessmentResult (what the user did), CapacityModel (what the engine
 * derived: a ladder rung and a starting load per movement slot), and the
 * synced AssessmentRecord (append-only: a re-assessment is a new record, the
 * latest counts). Values are metric; loads are what the user entered for that
 * exercise (e.g. per dumbbell for a dumbbell exercise).
 */

export const ASSESSMENT_PROTOCOL_IDS = ['home', 'gym', 'home_55plus'] as const;
export const AssessmentProtocolIdSchema = z.enum(ASSESSMENT_PROTOCOL_IDS);
export type AssessmentProtocolId = z.infer<typeof AssessmentProtocolIdSchema>;

/** Movement slots the capacity model covers (a subset of the M02 slots). */
export const CAPACITY_SLOTS = ['squat', 'horizontal_push', 'vertical_pull', 'horizontal_pull', 'hinge', 'core'] as const;
export const CapacitySlotIdSchema = z.enum(CAPACITY_SLOTS);
export type CapacitySlotId = z.infer<typeof CapacitySlotIdSchema>;

export const ASSESSMENT_TEST_KINDS = ['reps', 'hold', 'timed_reps', 'load_reps'] as const;
export const AssessmentTestKindSchema = z.enum(ASSESSMENT_TEST_KINDS);
export type AssessmentTestKind = z.infer<typeof AssessmentTestKindSchema>;

export const ASSESSMENT_SKIP_REASONS = ['equipment', 'safety', 'user_choice', 'discomfort'] as const;
export const AssessmentSkipReasonSchema = z.enum(ASSESSMENT_SKIP_REASONS);
export type AssessmentSkipReason = z.infer<typeof AssessmentSkipReasonSchema>;

/** A dotted reason code (rendered through packages/i18n `engine.reason.<code>`). */
export const ReasonCodeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_.]{2,119}$/, 'dotted reason code')
  .refine((code) => code.includes('.') && !code.includes('..') && !code.endsWith('.'), 'dotted reason code');
export type ReasonCode = z.infer<typeof ReasonCodeSchema>;

/** Upper bounds reject typing errors; they are not performance norms. */
export const AssessmentTestResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('done'),
    testId: SlugSchema,
    /** The variant or exercise the user performed (their chosen level). */
    exerciseId: SlugSchema,
    /** Reps completed (reps, timed_reps, load_reps tests). */
    reps: z.number().int().min(0).max(300).nullable(),
    /** Seconds held (hold tests). */
    seconds: z.number().int().min(0).max(600).nullable(),
    /** External load used (load_reps tests), kg. */
    loadKg: z.number().min(0).max(500).nullable(),
    /** Reps the user felt they still had in reserve when they stopped (load_reps tests). */
    rir: z.number().int().min(0).max(5).nullable(),
  }),
  z.strictObject({ status: z.literal('skipped'), testId: SlugSchema, reason: AssessmentSkipReasonSchema }),
]);
export type AssessmentTestResult = z.infer<typeof AssessmentTestResultSchema>;

export const AssessmentResultSchema = z.strictObject({
  protocolId: AssessmentProtocolIdSchema,
  protocolVersion: z.number().int().positive(),
  /** Reserve (reps in reserve) every test was instructed to stop at; never below 2. */
  stopRir: z.number().int().min(2).max(5),
  startedAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema,
  tests: z.array(AssessmentTestResultSchema).min(1).max(20),
});
export type AssessmentResult = z.infer<typeof AssessmentResultSchema>;

export const SlotTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('reps'), min: z.number().int().min(1), max: z.number().int().min(1) }),
  z.strictObject({ kind: z.literal('hold'), seconds: z.number().int().min(1) }),
]);
export type SlotTarget = z.infer<typeof SlotTargetSchema>;

export const CapacitySlotSchema = z.strictObject({
  slot: CapacitySlotIdSchema,
  ladderId: SlugSchema,
  /** Starting rung: the exercise and its step on the ladder (0 = lowest). */
  exerciseId: SlugSchema,
  stepIndex: z.number().int().min(0),
  /** The test that placed the slot (null: not tested, lowest rung). */
  testId: SlugSchema.nullable(),
  /** RIR-adjusted Epley estimate for loaded tests (null otherwise or out of range). */
  e1rmKg: z.number().positive().nullable(),
  /** Starting working load for loaded rungs (null for bodyweight rungs). */
  loadKg: z.number().min(0).nullable(),
  target: SlotTargetSchema,
  reasonCodes: z.array(ReasonCodeSchema).min(1),
});
export type CapacitySlot = z.infer<typeof CapacitySlotSchema>;

export const CapacityModelSchema = z.strictObject({
  schemaVersion: z.literal(1),
  protocolId: AssessmentProtocolIdSchema,
  protocolVersion: z.number().int().positive(),
  engineVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  assessedAt: IsoDateTimeSchema,
  /** End of the default mesocycle after this assessment: re-assessment is due from then (M08 may set another end). */
  reassessDueAt: IsoDateTimeSchema,
  slots: z.array(CapacitySlotSchema).min(1),
});
export type CapacityModel = z.infer<typeof CapacityModelSchema>;

export const ASSESSMENT_REASONS = ['first', 'mesocycle_end', 'on_demand'] as const;
export const AssessmentReasonSchema = z.enum(ASSESSMENT_REASONS);

/** Synced record (collection `assessments`, append-only). */
export const AssessmentRecordSchema = z.strictObject({
  reason: AssessmentReasonSchema,
  result: AssessmentResultSchema,
  capacity: CapacityModelSchema,
  /** True when S1 made the tests stop further from failure than RIR 2 (logged as a safety event, L11). */
  cappedByS1: z.boolean(),
});
export type AssessmentRecord = z.infer<typeof AssessmentRecordSchema>;

export const ASSESSMENT_COLLECTION = 'assessments' as const;

// ---- First session (M07 → M02): the plan generateSession() returns.

export const PlannedSetSchema = z.strictObject({
  index: z.number().int().min(1),
  target: SlotTargetSchema,
  loadKg: z.number().min(0).nullable(),
  targetRir: z.number().int().min(0).max(10),
  restSeconds: z.number().int().min(0),
  reasonCodes: z.array(ReasonCodeSchema).min(1),
});
export type PlannedSet = z.infer<typeof PlannedSetSchema>;

export const PlannedExerciseSchema = z.strictObject({
  slot: CapacitySlotIdSchema,
  exerciseId: SlugSchema,
  sets: z.array(PlannedSetSchema).min(1),
  reasonCodes: z.array(ReasonCodeSchema).min(1),
});
export type PlannedExercise = z.infer<typeof PlannedExerciseSchema>;

export const SessionPlanSchema = z.strictObject({
  planId: UuidSchema,
  kind: z.literal('first_session'),
  engineVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  generatedAt: IsoDateTimeSchema,
  seed: z.number().int(),
  /** The capacity model the plan was built from (its assessment time). */
  capacityAssessedAt: IsoDateTimeSchema,
  targetRir: z.number().int().min(0).max(10),
  estimatedMinutes: z.number().min(0),
  exercises: z.array(PlannedExerciseSchema).min(1),
  reasonCodes: z.array(ReasonCodeSchema).min(1),
});
export type SessionPlan = z.infer<typeof SessionPlanSchema>;
