import { z } from 'zod';
import { CapacityModelSchema, ReasonCodeSchema, SlotTargetSchema } from './assessment.js';
import { IsoDateTimeSchema, UuidSchema } from './common.js';
import { EquipmentIdSchema, JointFlagsSchema, JointSchema, MovementPatternSchema, SafetyProfileSchema, SlugSchema } from './exercise.js';
import { CalendarDateSchema, EquipmentLoadsSchema, ExperienceLevelSchema, PROFILE_INPUT_BOUNDS } from './profile.js';
import { ConditioningSchema, IsoDateSchema, MesocycleIntentSchema, MicrocycleKindSchema, ScheduledSessionSchema, SlotRoleSchema } from './program.js';
import { CoolDownSchema, DeloadEventSchema, PainPhaseSchema, SessionModeSchema, WarmupPlanSchema } from './recovery.js';
import { CardioPlanSchema, CardioProtocolSchema, CardioRequestSchema, HeartRateInfoSchema } from './cardio.js';

/**
 * M02 — Adaptive training engine and session execution contracts
 * (docs/specs/M02-adaptive-training-engine.md, ADR-016).
 *
 * Entities: SessionPlan, PlannedExercise, PlannedSet (what the engine
 * prescribes; M07's first session is the same plan), ReasonCode (assessment.ts),
 * ExecutionLog and SetLog (append-only, what the user did), plus the
 * generator's input and the progression decision. The engine
 * (packages/engine/src/session) is the only producer of plans; the app, the
 * API and the AI coach only read them. Metric internally.
 */

const engineVersion = z.string().regex(/^\d+\.\d+\.\d+$/);

// ------------------------------------------------------------------ the plan

/** Slow-eccentric tempo, prescribed only for specific progressions (negatives), never as a default. */
export const TempoSchema = z.strictObject({ eccentricSeconds: z.number().int().min(1).max(10) });
export type Tempo = z.infer<typeof TempoSchema>;

/** Numbers a reason code's FR/EN sentence needs (e.g. "+2.5 kg: you reached 3×12 at RIR 2"). No free text. */
export const ReasonParamsSchema = z.record(z.string().regex(/^[a-z][a-zA-Z]{0,30}$/), z.number().finite());
export type ReasonParams = z.infer<typeof ReasonParamsSchema>;

export const PlannedSetSchema = z.strictObject({
  index: z.number().int().min(1),
  target: SlotTargetSchema,
  /** External load (per implement, e.g. per dumbbell); null = body weight, band or a load the user chooses. */
  loadKg: z.number().min(0).nullable(),
  targetRir: z.number().int().min(0).max(10),
  restSeconds: z.number().int().min(0),
  tempo: TempoSchema.nullable(),
  /** Why this set is what it is (≥ 1, rendered FR/EN through packages/i18n `engine.reason.<code>`). */
  reasonCodes: z.array(ReasonCodeSchema).min(1),
  reasonParams: ReasonParamsSchema,
});
export type PlannedSet = z.infer<typeof PlannedSetSchema>;

export const PlannedExerciseSchema = z.strictObject({
  /** The movement-pattern slot the exercise fills (M08 program slot or M07 capacity slot). */
  slot: MovementPatternSchema,
  role: SlotRoleSchema,
  exerciseId: SlugSchema,
  /** The variant ladder the exercise was taken from (bodyweight progression), if any. */
  ladderId: SlugSchema.nullable(),
  /** Exercises sharing a group letter are done as a superset (time-boxing). */
  supersetGroup: z.string().regex(/^[A-Z]$/).nullable(),
  sets: z.array(PlannedSetSchema).min(1),
  reasonCodes: z.array(ReasonCodeSchema).min(1),
});
export type PlannedExercise = z.infer<typeof PlannedExerciseSchema>;

/** 'cardio_session' (M03): a standalone cardio or conditioning session (mode 'cardio'). */
export const SESSION_KINDS = ['first_session', 'program_session', 'mobility_session', 'cardio_session'] as const;
export const SessionKindSchema = z.enum(SESSION_KINDS);
export type SessionKind = z.infer<typeof SessionKindSchema>;

/** Where a program session comes from (M08). */
export const PlanProgramRefSchema = z.strictObject({
  programId: UuidSchema,
  sessionId: z.string().regex(/^w\d{2}\.s\d$/),
  date: IsoDateSchema,
  week: z.number().int().min(1),
  microcycleKind: MicrocycleKindSchema,
  mesocycleIntent: MesocycleIntentSchema,
});
export type PlanProgramRef = z.infer<typeof PlanProgramRefSchema>;

export const WarmUpSchema = z.strictObject({
  minutes: z.number().min(0),
  /** Time-boxing never cuts the warm-up below this. */
  minimumMinutes: z.number().min(0),
  /** M05: what the warm-up is (general movement, mobility for the day's patterns, ramp-up sets). Absent on plans made before engine 0.3.0. */
  content: WarmupPlanSchema.optional(),
});
export type WarmUp = z.infer<typeof WarmUpSchema>;

export const SessionPlanSchema = z
  .strictObject({
    planId: UuidSchema,
    kind: SessionKindSchema,
    engineVersion,
    /** Version of the session rules and coefficients (packages/engine/src/session). */
    rulesVersion: engineVersion,
    generatedAt: IsoDateTimeSchema,
    seed: z.number().int(),
    /** The capacity model the plan used (its assessment time), if any. */
    capacityAssessedAt: IsoDateTimeSchema.nullable(),
    program: PlanProgramRefSchema.nullable(),
    equipmentProfileId: UuidSchema.nullable(),
    /** Session reserve: every set stops at least this many reps before failure (S1 raises it). */
    targetRir: z.number().int().min(0).max(10),
    minutesAvailable: z.number().min(0),
    estimatedMinutes: z.number().min(0),
    warmUp: WarmUpSchema,
    /** Aerobic work handed to M03 (steady or intervals; S1 already applied). */
    conditioning: ConditioningSchema.nullable(),
    exercises: z.array(PlannedExerciseSchema),
    /** M05: easy mobility after the session, only when time is left (null: none; absent before engine 0.3.0). */
    coolDown: CoolDownSchema.nullable().optional(),
    /** M03: the conditioning block as the device runs it (protocol, movements, zones, timeline); null without conditioning; absent before engine 0.4.0. */
    cardio: CardioPlanSchema.nullable().optional(),
    reasonCodes: z.array(ReasonCodeSchema).min(1),
  })
  .refine((p) => p.exercises.length > 0 || p.conditioning !== null, { message: 'a plan needs an exercise or a conditioning block' })
  .refine((p) => p.kind === 'program_session' || p.kind === 'cardio_session' || p.exercises.length > 0, { message: 'a first or mobility session needs an exercise' })
  .refine((p) => p.kind !== 'cardio_session' || (p.conditioning !== null && p.cardio != null), { message: 'a cardio session needs its cardio block' })
  .refine((p) => p.cardio == null || (p.conditioning !== null && p.cardio.placement === p.conditioning.placement), { message: 'a cardio block belongs to the conditioning block' });
export type SessionPlan = z.infer<typeof SessionPlanSchema>;

export const SessionSafetyEventSchema = z.strictObject({
  invariant: z.enum(['S1', 'S2', 'S3', 'S5', 'S7']),
  reasonCode: z.string().regex(/^[a-z0-9_.-]{1,80}$/),
  action: z.enum(['blocked', 'substituted', 'session_ended', 'intensity_locked', 'capped']),
  engineVersion,
});
export type SessionSafetyEventValue = z.infer<typeof SessionSafetyEventSchema>;

export const GenerateSessionResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('ok'), plan: SessionPlanSchema, safetyEvents: z.array(SessionSafetyEventSchema) }),
  z.strictObject({ status: z.literal('unavailable'), reasonCodes: z.array(ReasonCodeSchema).min(1) }),
]);

// ------------------------------------------------------------ what was done

export const PERFORMED_SET_STATUSES = ['done', 'skipped'] as const;

/** One set as the user did (or skipped) it. Bounds reject typing errors; they are not performance norms. */
export const PerformedSetSchema = z.strictObject({
  index: z.number().int().min(1).max(20),
  status: z.enum(PERFORMED_SET_STATUSES),
  reps: z.number().int().min(0).max(100).nullable(),
  seconds: z.number().int().min(0).max(600).nullable(),
  loadKg: z.number().min(0).max(500).nullable(),
  /** Reps the user felt they still had in reserve (RIR); null when not reported. */
  rir: z.number().int().min(0).max(10).nullable(),
});
export type PerformedSet = z.infer<typeof PerformedSetSchema>;

/** One exercise of a past session: what was prescribed and what was done. */
export const HistoryExerciseSchema = z.strictObject({
  slot: MovementPatternSchema,
  role: SlotRoleSchema,
  exerciseId: SlugSchema,
  ladderId: SlugSchema.nullable(),
  target: SlotTargetSchema,
  targetRir: z.number().int().min(0).max(10),
  /** The load the engine prescribed (null = body weight, band, or a load the user chose). */
  prescribedLoadKg: z.number().min(0).nullable(),
  performed: z.array(PerformedSetSchema).max(20),
});
export type HistoryExercise = z.infer<typeof HistoryExerciseSchema>;

/** A past session the user started (built by the engine from workout_sessions + set_logs + execution_logs). */
export const SessionHistoryEntrySchema = z.strictObject({
  planId: UuidSchema,
  /** When the plan was generated (the prescription time S5 counts from). */
  prescribedAt: IsoDateTimeSchema,
  startedAt: IsoDateTimeSchema,
  /** Deload and transition weeks do not count toward progression decisions. */
  countsForProgression: z.boolean(),
  exercises: z.array(HistoryExerciseSchema).max(20),
  /** M03: seconds of cardio run in this session (from its `cardio_done` log); absent when none was logged. */
  cardioSeconds: z.number().int().min(0).optional(),
});
export type SessionHistoryEntry = z.infer<typeof SessionHistoryEntrySchema>;

/** A load prescribed earlier for an exercise (M07 S5 input; the history covers it for M02 sessions). */
export const RecentLoadSchema = z.strictObject({ exerciseId: SlugSchema, loadKg: z.number().min(0), prescribedAt: IsoDateTimeSchema });
export type RecentLoadValue = z.infer<typeof RecentLoadSchema>;

// ----------------------------------------------------------- engine inputs

/** The program session M02 builds (M08 programDay → EffectiveSession, after reflows). */
export const ProgramSessionContextSchema = z.strictObject({
  programId: UuidSchema,
  session: ScheduledSessionSchema.extend({
    originalDate: IsoDateSchema,
    state: z.enum(['planned', 'shifted']),
    mergedFrom: z.array(z.string().regex(/^w\d{2}\.s\d$/)),
  }),
  microcycle: z.strictObject({ week: z.number().int().min(1), kind: MicrocycleKindSchema, volumeFactor: z.number().min(0).max(1) }),
  mesocycle: z.strictObject({ index: z.number().int().min(1), intent: MesocycleIntentSchema }),
});
export type ProgramSessionContext = z.infer<typeof ProgramSessionContextSchema>;

/** S3: after a red-flag stop, intensity stays locked until the user attests a medical review (packages/safety intensityLockStatus). */
export const IntensityLockSchema = z.strictObject({ locked: z.boolean(), since: IsoDateTimeSchema.nullable() });
export type IntensityLock = z.infer<typeof IntensityLockSchema>;

export const READINESS_LEVELS = ['normal', 'reduced'] as const;

export const GenerateSessionInputSchema = z.strictObject({
  safetyProfile: SafetyProfileSchema,
  /** Equipment of the place the user trains at today (Anywhere Switcher: may differ from the program's place). */
  equipment: z.array(EquipmentIdSchema),
  /** The loads that place offers (null/absent: legacy rounding to `loadIncrementKg`). */
  equipmentLoads: EquipmentLoadsSchema.nullable().optional(),
  equipmentProfileId: UuidSchema.nullable().optional(),
  minutesAvailable: z.number().min(0).max(600),
  /** M05 pain traffic light (S2). */
  jointFlags: JointFlagsSchema.optional(),
  /** M07 capacity model (first session; starting rungs and e1RMs later). */
  capacity: CapacityModelSchema.nullable().optional(),
  /** M08 session of the day; absent → the first session from the capacity model. */
  programSession: ProgramSessionContextSchema.nullable().optional(),
  /** Past sessions, oldest first. */
  history: z.array(SessionHistoryEntrySchema).max(60).optional(),
  /** M07: loads prescribed recently (S5). */
  recentLoads: z.array(RecentLoadSchema).max(500).optional(),
  /** M07: rounding step when the place's loads are not known. */
  loadIncrementKg: z.number().positive().max(50).optional(),
  bodyweightKg: z.number().min(25).max(350).nullable().optional(),
  /** S7 re-check with the M17 age gate on the engine clock's date. */
  birthDate: CalendarDateSchema.nullable().optional(),
  experience: ExperienceLevelSchema.nullable().optional(),
  intensityLock: IntensityLockSchema.optional(),
  /** M05/M12 readiness: 'reduced' → fewer sets and more reps in reserve. */
  readiness: z.enum(READINESS_LEVELS).optional(),
  /** M05: a triggered deload (engine deloadStatus) → volume −40–50 %, no progression. */
  deload: DeloadEventSchema.nullable().optional(),
  /** M05: 'mobility_balance' → a standalone mobility and balance session instead of today's training; M03: 'cardio' → a cardio session (with `cardio`). */
  mode: SessionModeSchema.optional(),
  /** M03: the cardio session the user chose (mode 'cardio'). */
  cardio: CardioRequestSchema.nullable().optional(),
  /** M03: heart-rate facts (resting heart rate and where it comes from); absent → effort and talk test only. */
  heartRate: HeartRateInfoSchema.nullable().optional(),
  /** M03: height (cm) for the body-mass-index impact default (with bodyweightKg). */
  heightCm: z.number().min(PROFILE_INPUT_BOUNDS.heightCmMin.value).max(PROFILE_INPUT_BOUNDS.heightCmMax.value).nullable().optional(),
  /** M03: the user opted up from the low-impact default (never above the SafetyProfile ceiling, never on a red joint). */
  impactOptIn: z.boolean().optional(),
});
export type GenerateSessionInputValue = z.infer<typeof GenerateSessionInputSchema>;

// ------------------------------------------------------ progression decision

export const LOAD_IMPLEMENT_KINDS = ['barbell', 'dumbbell', 'kettlebell', 'stack', 'plate', 'increment'] as const;

/** The loads an exercise can take on this equipment (packages/engine increments.ts). */
export const LoadImplementSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('barbell'), barKg: z.number().min(0), stepKg: z.number().positive() }),
  z.strictObject({ kind: z.enum(['dumbbell', 'kettlebell', 'plate']), loadsKg: z.array(z.number().positive()).min(1) }),
  z.strictObject({ kind: z.literal('stack'), minKg: z.number().min(0), stepKg: z.number().positive(), maxKg: z.number().positive() }),
  /** Legacy (M07): any multiple of a step. */
  z.strictObject({ kind: z.literal('increment'), stepKg: z.number().positive() }),
]);
export type LoadImplement = z.infer<typeof LoadImplementSchema>;

export const PROGRESSION_LOADINGS = ['load', 'bodyweight', 'self_select'] as const;

/** One earlier session of this exercise, as evaluateProgression reads it (most recent last). */
export const ProgressionSessionSchema = z.strictObject({
  at: IsoDateTimeSchema,
  target: SlotTargetSchema,
  targetRir: z.number().int().min(0).max(10),
  prescribedLoadKg: z.number().min(0).nullable(),
  performed: z.array(PerformedSetSchema).max(20),
});

export const ProgressionInputSchema = z.strictObject({
  exerciseId: SlugSchema,
  pattern: MovementPatternSchema,
  loading: z.enum(PROGRESSION_LOADINGS),
  /** The target the next session asks for (rep range or hold). */
  target: SlotTargetSchema,
  targetRir: z.number().int().min(0).max(10),
  /** Sessions of this exercise that count (no deload or transition weeks), oldest first. */
  sessions: z.array(ProgressionSessionSchema).max(60),
  /** Achievable loads on today's equipment (null: not known → the user chooses). */
  implement: LoadImplementSchema.nullable(),
  /** S5: loads prescribed or used for this exercise, with their time. */
  loadReferences: z.array(z.strictObject({ loadKg: z.number().min(0), at: IsoDateTimeSchema })).max(500),
  /** The engine clock (S5 window). */
  asOf: IsoDateTimeSchema,
  /** False in deload and transition weeks: no load, variant or hold increase (regressions still apply). Absent = true. */
  allowProgression: z.boolean().optional(),
});
export type ProgressionInput = z.infer<typeof ProgressionInputSchema>;

export const PROGRESSION_ACTIONS = ['start', 'hold', 'increase_load', 'decrease_load', 'rebase', 'variant_up', 'variant_down', 'increase_hold', 'decrease_hold'] as const;
export type ProgressionAction = (typeof PROGRESSION_ACTIONS)[number];

export const ProgressionDecisionSchema = z.strictObject({
  action: z.enum(PROGRESSION_ACTIONS),
  /** Next load (null: body weight, or the user chooses). */
  loadKg: z.number().min(0).nullable(),
  target: SlotTargetSchema,
  /** True when S5 lowered the load. */
  s5Capped: z.boolean(),
  reasonCodes: z.array(ReasonCodeSchema).min(1),
  reasonParams: ReasonParamsSchema,
});
export type ProgressionDecision = z.infer<typeof ProgressionDecisionSchema>;

// ----------------------------------------------------- synced execution data

/** The plan a user started (collection `workout_sessions`, append-only): the executed prescription with the inputs it came from. */
export const WorkoutSessionRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  input: GenerateSessionInputSchema,
  plan: SessionPlanSchema,
  safetyEvents: z.array(SessionSafetyEventSchema),
  startedAt: IsoDateTimeSchema,
  /** L2 on the server: the jurisdiction whose texts the user accepted. */
  jurisdiction: z.string().regex(/^[A-Z]{2}$/),
  /** L3: this was the user's first workout (the first-workout notice was shown and acknowledged). */
  firstWorkout: z.boolean(),
});
export type WorkoutSessionRecord = z.infer<typeof WorkoutSessionRecordSchema>;

/** One logged set (collection `set_logs`, append-only; a correction is a new entry naming the one it corrects). */
export const SetLogSchema = z.strictObject({
  schemaVersion: z.literal(1),
  planId: UuidSchema,
  exerciseIndex: z.number().int().min(0).max(19),
  exerciseId: SlugSchema,
  set: PerformedSetSchema,
  loggedAt: IsoDateTimeSchema,
  /** Record id of the set log this entry corrects (append-only corrections). */
  correctionOf: UuidSchema.nullable(),
});
export type SetLog = z.infer<typeof SetLogSchema>;

/** S3 symptoms (docs/specs/00-product-vision.md): any of them ends the session and locks intensity. */
export const RED_FLAG_SYMPTOMS = ['chest_pain_pressure', 'fainting', 'disproportionate_breathlessness', 'palpitations', 'sudden_numbness_weakness'] as const;
export const RedFlagSymptomSchema = z.enum(RED_FLAG_SYMPTOMS);
export type RedFlagSymptom = z.infer<typeof RedFlagSymptomSchema>;

export const SESSION_END_REASONS = ['completed', 'user_stop', 'time', 'pain', 'red_flag'] as const;
export const SWAP_REASONS = ['user', 'pain', 'equipment'] as const;

/** What happened during execution (collection `execution_logs`, append-only; health data: pain and red flags). */
export const ExecutionLogSchema = z.discriminatedUnion('kind', [
  /** The user (or a pain flag) swapped an exercise: `replacement` is what the engine prescribed for it (replacementsFor). */
  z.strictObject({ kind: z.literal('swapped'), planId: UuidSchema, exerciseIndex: z.number().int().min(0).max(19), fromExerciseId: SlugSchema, replacement: PlannedExerciseSchema, reason: z.enum(SWAP_REASONS), at: IsoDateTimeSchema }),
  z.strictObject({ kind: z.literal('exercise_skipped'), planId: UuidSchema, exerciseIndex: z.number().int().min(0).max(19), at: IsoDateTimeSchema }),
  /**
   * PainReport (M05 pain-monitoring model, packages/safety painTrafficLight): a 0–10 score for a joint during a
   * session, in the check after it, or in the next-morning check (with `settled`: back to how it usually is?).
   * Absent phase = during (M02 records).
   */
  z.strictObject({
    kind: z.literal('pain'),
    planId: UuidSchema.nullable(),
    joint: JointSchema,
    score: z.number().int().min(0).max(10),
    at: IsoDateTimeSchema,
    phase: PainPhaseSchema.optional(),
    settled: z.boolean().optional(),
  }),
  z.strictObject({ kind: z.literal('ended'), planId: UuidSchema, reason: z.enum(SESSION_END_REASONS), at: IsoDateTimeSchema }),
  /** S3: a red-flag symptom ended the session; intensity is locked until a medical review is attested. */
  z.strictObject({ kind: z.literal('red_flag'), planId: UuidSchema.nullable(), symptom: RedFlagSymptomSchema, at: IsoDateTimeSchema }),
  /** S3: the person confirmed the medical-review statement (M05: self-attestation, the version they confirmed). */
  z.strictObject({ kind: z.literal('medical_review_attested'), at: IsoDateTimeSchema, statementVersion: z.number().int().positive().optional() }),
  /**
   * M03: a cardio block was run (to the end or stopped early). The seconds done at moderate and vigorous effort feed
   * the weekly aerobic ledger (vigorous counts double); `rounds` is the AMRAP rounds the user reported.
   */
  z.strictObject({
    kind: z.literal('cardio_done'),
    planId: UuidSchema,
    protocol: CardioProtocolSchema,
    moderateSeconds: z.number().int().min(0).max(10_800),
    vigorousSeconds: z.number().int().min(0).max(10_800),
    completedWork: z.number().int().min(0).max(400),
    totalWork: z.number().int().min(0).max(400),
    rounds: z.number().int().min(0).max(200).nullable(),
    endedEarly: z.boolean(),
    at: IsoDateTimeSchema,
  }),
]);
export type ExecutionLog = z.infer<typeof ExecutionLogSchema>;

export const SESSION_COLLECTIONS = { workoutSessions: 'workout_sessions', setLogs: 'set_logs', executionLogs: 'execution_logs' } as const;
