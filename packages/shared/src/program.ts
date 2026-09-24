import { z } from 'zod';
import { IsoDateTimeSchema, SupersedesSchema, UuidSchema } from './common.js';
import { EquipmentIdSchema, EquipmentLocationSchema, MovementPatternSchema, SafetyProfileSchema } from './exercise.js';
import { ExperienceLevelSchema, GoalIdSchema, GoalsSchema } from './profile.js';
import { ReasonCodeSchema } from './assessment.js';

/**
 * M08 — Program Architect: periodization and scheduling contracts
 * (docs/specs/M08-program-architect-periodization.md, ADR-015).
 *
 * Entities: Program, Mesocycle, Microcycle (one calendar week),
 * ScheduledSession, VolumeTarget; plus the synced ProgramRecord (the program
 * with the inputs it was derived from) and ReflowRecord (a missed session and
 * what the engine did with it). Both collections are append-only: a new
 * program is a new record (the latest counts); a reflow is never edited.
 *
 * Dates are calendar dates ('YYYY-MM-DD', the user's local calendar, no time
 * zone). The engine (packages/engine/src/program) produces all of this; the
 * app, the API and M02 only read it.
 */

/** A calendar date as 'YYYY-MM-DD' (validated as a real date). */
export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
  .refine((s) => {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number];
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  }, 'not a calendar date');
export type IsoDate = z.infer<typeof IsoDateSchema>;

/** Monday first (ISO 8601). */
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export const WeekdaySchema = z.enum(WEEKDAYS);
export type Weekday = z.infer<typeof WeekdaySchema>;

/** Training age used for volume targets and mesocycle length (from the M01 experience level). */
export const TRAINING_AGES = ['beginner', 'intermediate', 'advanced'] as const;
export const TrainingAgeSchema = z.enum(TRAINING_AGES);
export type TrainingAge = z.infer<typeof TrainingAgeSchema>;

/** Split families (spec: 2–3 days full body, 4 upper/lower, 5–6 push/pull/legs or hybrid, calisthenics skill days). */
export const SPLIT_IDS = ['full_body', 'upper_lower', 'push_pull_legs', 'hybrid', 'full_body_conditioning', 'calisthenics_skill'] as const;
export const SplitIdSchema = z.enum(SPLIT_IDS);
export type SplitId = z.infer<typeof SplitIdSchema>;

export const SESSION_FOCUSES = ['full_body', 'upper', 'lower', 'push', 'pull', 'legs', 'skill', 'conditioning', 'mobility_balance'] as const;
export const SessionFocusSchema = z.enum(SESSION_FOCUSES);
export type SessionFocus = z.infer<typeof SessionFocusSchema>;

/** What a slot's sets are for; M02 turns it into a rep range and load. */
export const SLOT_INTENTS = ['strength', 'hypertrophy', 'general', 'skill', 'balance', 'mobility'] as const;
export const SlotIntentSchema = z.enum(SLOT_INTENTS);
export type SlotIntent = z.infer<typeof SlotIntentSchema>;

export const SLOT_ROLES = ['primary', 'secondary', 'accessory'] as const;
export const SlotRoleSchema = z.enum(SLOT_ROLES);
export type SlotRole = z.infer<typeof SlotRoleSchema>;

/** Muscle groups the weekly hard-set targets are counted for. */
export const PROGRAM_MUSCLE_GROUPS = ['chest', 'back', 'shoulders', 'arms', 'quads', 'glutes_hamstrings', 'core'] as const;
export const ProgramMuscleGroupSchema = z.enum(PROGRAM_MUSCLE_GROUPS);
export type ProgramMuscleGroup = z.infer<typeof ProgramMuscleGroupSchema>;

export const MESOCYCLE_INTENTS = ['hypertrophy', 'strength', 'general', 'skill'] as const;
export const MesocycleIntentSchema = z.enum(MESOCYCLE_INTENTS);
export type MesocycleIntent = z.infer<typeof MesocycleIntentSchema>;

export const MICROCYCLE_KINDS = ['accumulation', 'deload', 'transition'] as const;
export const MicrocycleKindSchema = z.enum(MICROCYCLE_KINDS);
export type MicrocycleKind = z.infer<typeof MicrocycleKindSchema>;

/** One movement-pattern slot of a scheduled session: M02 fills it with an exercise from the M06 graph. */
export const ProgramSlotSchema = z.strictObject({
  pattern: MovementPatternSchema,
  role: SlotRoleSchema,
  intent: SlotIntentSchema,
  /** Hard sets (counted toward the weekly targets unless the intent is balance or mobility). */
  hardSets: z.number().int().min(1).max(12),
});
export type ProgramSlot = z.infer<typeof ProgramSlotSchema>;

export const CONDITIONING_KINDS = ['steady', 'intervals'] as const;
export const ConditioningKindSchema = z.enum(CONDITIONING_KINDS);
export type ConditioningKind = z.infer<typeof ConditioningKindSchema>;

/** Aerobic work in a session: the whole session or a finisher after the strength work (M03 builds the protocol). */
export const ConditioningSchema = z.strictObject({
  kind: ConditioningKindSchema,
  placement: z.enum(['session', 'finisher']),
  minutes: z.number().int().min(1).max(180),
});
export type Conditioning = z.infer<typeof ConditioningSchema>;

export const ScheduledSessionSchema = z.strictObject({
  /** Stable within the program, e.g. 'w03.s2' (week 3, second session). */
  id: z.string().regex(/^w\d{2}\.s\d$/),
  date: IsoDateSchema,
  weekday: WeekdaySchema,
  focus: SessionFocusSchema,
  /** The M01 equipment profile (location) the session is planned for. */
  equipmentProfileId: UuidSchema.nullable(),
  location: EquipmentLocationSchema.nullable(),
  slots: z.array(ProgramSlotSchema).max(10),
  conditioning: ConditioningSchema.nullable(),
  /** Effort ceiling for the hard sets (RPE), already capped by S1. */
  targetRpe: z.number().min(1).max(10),
  /** Movement patterns trained hard in this session (reflow: never on consecutive days). */
  hardPatterns: z.array(MovementPatternSchema),
  /** Heavy lower-body session (concurrent-training rule: no intervals the day before). */
  heavyLower: z.boolean(),
  /** 2 = main strength session, 1 = conditioning or mobility (reflow keeps higher priority first). */
  priority: z.number().int().min(1).max(2),
  estimatedMinutes: z.number().int().min(0),
  reasonCodes: z.array(ReasonCodeSchema).min(1),
});
export type ScheduledSession = z.infer<typeof ScheduledSessionSchema>;

/** Weekly hard-set target for one muscle group ("starting points, to be validated": config, validated:false). */
export const VolumeTargetSchema = z.strictObject({
  muscle: ProgramMuscleGroupSchema,
  min: z.number().min(0),
  max: z.number().min(0),
  /** The target for this week (ramped within the mesocycle, reduced in deload and transition weeks). */
  target: z.number().min(0),
  /** Hard sets the week's sessions actually plan for this group (fractional sets count secondary muscles). */
  planned: z.number().min(0),
  /** Hard sets of patterns whose main group this is (never above max; fractional sets from other patterns can add to `planned`). */
  direct: z.number().int().min(0),
});
export type VolumeTarget = z.infer<typeof VolumeTargetSchema>;

export const MicrocycleSchema = z.strictObject({
  /** Week of the program, 1-based. */
  week: z.number().int().min(1),
  mesocycle: z.number().int().min(1),
  weekInMesocycle: z.number().int().min(1),
  kind: MicrocycleKindSchema,
  startDate: IsoDateSchema,
  endDate: IsoDateSchema,
  /** Share of the accumulation volume planned this week (1 = full, M05 deload = reduced). */
  volumeFactor: z.number().min(0).max(1),
  sessions: z.array(ScheduledSessionSchema).max(7),
  volume: z.array(VolumeTargetSchema),
  aerobicMinutes: z.number().int().min(0),
  reasonCodes: z.array(ReasonCodeSchema),
});
export type Microcycle = z.infer<typeof MicrocycleSchema>;

export const MesocycleSchema = z.strictObject({
  index: z.number().int().min(1),
  intent: MesocycleIntentSchema,
  startDate: IsoDateSchema,
  endDate: IsoDateSchema,
  /** 4–6 weeks (spec), the last one a deload. */
  weeks: z.number().int().min(4).max(6),
  deloadWeek: z.number().int().min(1),
});
export type Mesocycle = z.infer<typeof MesocycleSchema>;

export const ProgramSchema = z.strictObject({
  schemaVersion: z.literal(1),
  programId: UuidSchema,
  engineVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  /** Version of the program rules and templates (packages/engine/src/program). */
  rulesVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  generatedAt: IsoDateTimeSchema,
  seed: z.number().int(),
  templateId: z.string().regex(/^[a-z_]+\.\dd$/),
  goal: GoalIdSchema,
  secondaryGoal: GoalIdSchema.nullable(),
  trainingAge: TrainingAgeSchema,
  split: SplitIdSchema,
  daysPerWeek: z.number().int().min(1).max(7),
  trainingDays: z.array(WeekdaySchema).min(1).max(6),
  minutesPerSession: z.number().int().min(10).max(180),
  startDate: IsoDateSchema,
  endDate: IsoDateSchema,
  mesocycles: z.array(MesocycleSchema).min(1),
  microcycles: z.array(MicrocycleSchema).min(4),
  reasonCodes: z.array(ReasonCodeSchema).min(1),
});
export type Program = z.infer<typeof ProgramSchema>;

/** A place the user trains at (an M01 equipment profile). */
export const ProgramLocationSchema = z.strictObject({
  equipmentProfileId: UuidSchema,
  location: EquipmentLocationSchema,
  equipment: z.array(EquipmentIdSchema),
});
export type ProgramLocation = z.infer<typeof ProgramLocationSchema>;

/** Everything a program is derived from (stored with it so the server can re-derive it). */
export const ProgramInputSchema = z.strictObject({
  goals: GoalsSchema,
  experience: ExperienceLevelSchema,
  daysPerWeek: z.number().int().min(1).max(7),
  minutesPerSession: z.number().int().min(10).max(180),
  /** Days the user wants to train (optional; the engine picks spaced days otherwise). */
  trainingDays: z.array(WeekdaySchema).max(7).nullable(),
  /** First day of the program (the engine starts on the Monday of that week). */
  startDate: IsoDateSchema,
  safetyProfile: SafetyProfileSchema,
  locations: z.array(ProgramLocationSchema).max(8),
  /** Default place (M01 active equipment profile); null = the first location. */
  defaultEquipmentProfileId: UuidSchema.nullable(),
  /** Per-weekday place overrides (e.g. gym on Monday, home on Wednesday). */
  locationByWeekday: z.partialRecord(WeekdaySchema, UuidSchema),
  /** The goal of the program this one replaces (a changed goal starts with a transition week). */
  previousGoal: GoalIdSchema.nullable(),
});
export type ProgramInput = z.infer<typeof ProgramInputSchema>;

export const PROGRAM_REASONS = ['first', 'goal_change', 'schedule_change', 'renewal'] as const;
export const ProgramReasonSchema = z.enum(PROGRAM_REASONS);

/** Synced record (collection `programs`, append-only; the latest counts). */
export const ProgramRecordSchema = z.strictObject({
  reason: ProgramReasonSchema,
  input: ProgramInputSchema,
  program: ProgramSchema,
  /** Record ids of the programs this one replaces (ADR-023); absent on records stored before it. */
  supersedes: SupersedesSchema.optional(),
});
export type ProgramRecord = z.infer<typeof ProgramRecordSchema>;

export const ReflowOutcomeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('shifted'), toDate: IsoDateSchema }),
  z.strictObject({ kind: z.literal('merged'), intoSessionId: z.string().regex(/^w\d{2}\.s\d$/), patterns: z.array(MovementPatternSchema).min(1) }),
  z.strictObject({ kind: z.literal('skipped') }),
]);
export type ReflowOutcome = z.infer<typeof ReflowOutcomeSchema>;

/** Synced record (collection `program_reflows`, append-only): the user could not do a session; what the engine did. */
export const ReflowRecordSchema = z.strictObject({
  programId: UuidSchema,
  sessionId: z.string().regex(/^w\d{2}\.s\d$/),
  /** The day the user told the app (local calendar). */
  reportedOn: IsoDateSchema,
  outcome: ReflowOutcomeSchema,
  engineVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  decidedAt: IsoDateTimeSchema,
  reasonCodes: z.array(ReasonCodeSchema).min(1),
  /** Record ids of the reflows of the same program this one follows (ADR-023: replayed in chain order); absent on records stored before it. */
  supersedes: SupersedesSchema.optional(),
});
export type ReflowRecord = z.infer<typeof ReflowRecordSchema>;

/** A deload week as M05 reads it (scheduled by M08; M05 adds triggered deloads). */
export const ScheduledDeloadSchema = z.strictObject({
  week: z.number().int().min(1),
  mesocycle: z.number().int().min(1),
  startDate: IsoDateSchema,
  endDate: IsoDateSchema,
  volumeFactor: z.number().min(0).max(1),
  trigger: z.literal('scheduled'),
});
export type ScheduledDeload = z.infer<typeof ScheduledDeloadSchema>;

export const PROGRAM_COLLECTIONS = { programs: 'programs', reflows: 'program_reflows' } as const;
