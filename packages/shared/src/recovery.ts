import { z } from 'zod';
import { ReasonCodeSchema } from './assessment.js';
import { IsoDateTimeSchema } from './common.js';
import { MovementPatternSchema, SlugSchema } from './exercise.js';
import { IsoDateSchema } from './program.js';

/**
 * M05 — Recovery, mobility and pain-monitored safety contracts
 * (docs/specs/M05-recovery-mobility-pain-safety.md, ADR-017).
 *
 * Entities: WarmupPlan (and the cool-down), ReadinessCheck, PainReport (the
 * M02 `pain` execution log, extended with the phase of the check and the
 * next-morning answer — one pain model, packages/safety), DeloadEvent (the
 * engine's triggered-deload decision, fed back into generateSession) and
 * RedFlagEvent (the M02 `red_flag` execution log, in a session or at a
 * check-in). Every number the engine uses lives in packages/engine
 * RECOVERY_CONFIG with its source and `validated: false`.
 */

// ------------------------------------------------------------------ warm-up

/** A mobility drill of the warm-up, chosen for the day's movement patterns. */
export const WarmupDrillSchema = z.strictObject({
  exerciseId: SlugSchema,
  /** The day's movement patterns this drill prepares (≥ 1). */
  forPatterns: z.array(MovementPatternSchema).min(1),
  seconds: z.number().int().min(10).max(300),
  reasonCodes: z.array(ReasonCodeSchema).min(1),
});
export type WarmupDrill = z.infer<typeof WarmupDrillSchema>;

/** One lighter set before the first heavy lift (e.g. ~40/60/80 % of the working load). */
export const RampUpSetSchema = z.strictObject({
  percent: z.number().int().min(1).max(99),
  loadKg: z.number().min(0),
  reps: z.number().int().min(1).max(20),
});
export type RampUpSet = z.infer<typeof RampUpSetSchema>;

export const WarmupPlanSchema = z.strictObject({
  /** 2–3 minutes of easy general movement; exerciseId null = any easy movement the person likes (nothing suitable in the graph). */
  general: z.strictObject({ exerciseId: SlugSchema.nullable(), seconds: z.number().int().min(0).max(600), reasonCodes: z.array(ReasonCodeSchema).min(1) }),
  mobility: z.array(WarmupDrillSchema),
  /** Ramp-up sets before the first heavy lift (index into the plan's exercises), or null when no lift is loaded. */
  rampUp: z
    .strictObject({
      exerciseIndex: z.number().int().min(0).max(19),
      exerciseId: SlugSchema,
      workingLoadKg: z.number().min(0),
      sets: z.array(RampUpSetSchema).min(1),
      seconds: z.number().int().min(0).max(600),
      reasonCodes: z.array(ReasonCodeSchema).min(1),
    })
    .nullable(),
  /** Total of the blocks, in seconds (5–8 minutes). */
  seconds: z.number().int().min(0).max(900),
});
export type WarmupPlan = z.infer<typeof WarmupPlanSchema>;

/** A cool-down after the session: easy mobility for the patterns trained (only when time is left). */
export const CoolDownSchema = z.strictObject({
  minutes: z.number().min(0).max(15),
  drills: z.array(WarmupDrillSchema).min(1),
  reasonCodes: z.array(ReasonCodeSchema).min(1),
});
export type CoolDown = z.infer<typeof CoolDownSchema>;

// ---------------------------------------------------------------- readiness

/** 1–5 answer. sleep: 5 = slept very well; soreness: 5 = very sore; stress: 5 = very stressed; energy: 5 = full of energy. */
export const ReadinessAnswerSchema = z.number().int().min(1).max(5);

/** Optional M12 wearable readings (all nullable: missing data never blocks). Bounds reject typing errors only. */
export const ReadinessWearableSchema = z.strictObject({
  hrvMs: z.number().min(5).max(300).nullable(),
  hrvBaselineMs: z.number().min(5).max(300).nullable(),
  restingHr: z.number().int().min(25).max(220).nullable(),
  restingHrBaseline: z.number().int().min(25).max(220).nullable(),
});
export type ReadinessWearable = z.infer<typeof ReadinessWearableSchema>;

/** The optional 10-second readiness check (collection `readiness_checks`, append-only, health data). */
export const ReadinessCheckSchema = z.strictObject({
  schemaVersion: z.literal(1),
  /** The person's local calendar date the check is for. */
  date: IsoDateSchema,
  at: IsoDateTimeSchema,
  sleep: ReadinessAnswerSchema,
  soreness: ReadinessAnswerSchema,
  stress: ReadinessAnswerSchema,
  energy: ReadinessAnswerSchema,
  wearable: ReadinessWearableSchema.nullable(),
});
export type ReadinessCheck = z.infer<typeof ReadinessCheckSchema>;

// ------------------------------------------------------------------- pain

/** When a pain score was given: during the session, in the check after it, or in the next-morning check. */
export const PAIN_PHASES = ['during', 'after_session', 'next_morning'] as const;
export const PainPhaseSchema = z.enum(PAIN_PHASES);
export type PainPhase = z.infer<typeof PainPhaseSchema>;

// ------------------------------------------------------------------ deload

/** Why a deload applies: M08's scheduled deload week, or an M05 trigger. */
export const DELOAD_TRIGGERS = ['scheduled', 'amber_weeks', 'red_flag', 'performance_drop', 'low_readiness'] as const;
export const TRIGGERED_DELOAD_TRIGGERS = ['amber_weeks', 'red_flag', 'performance_drop', 'low_readiness'] as const;
export const DeloadTriggerSchema = z.enum(DELOAD_TRIGGERS);
export type DeloadTrigger = z.infer<typeof DeloadTriggerSchema>;

/**
 * DeloadEvent: a triggered deload the engine decided (packages/engine
 * deloadStatus), fed back into generateSession. `until` is null while it
 * cannot end yet (a red flag before the medical review is attested).
 */
export const DeloadEventSchema = z.strictObject({
  trigger: z.enum(TRIGGERED_DELOAD_TRIGGERS),
  since: IsoDateTimeSchema,
  until: IsoDateTimeSchema.nullable(),
});
export type DeloadEvent = z.infer<typeof DeloadEventSchema>;

// ----------------------------------------------------------- session modes

/** 'mobility_balance': a standalone mobility and balance session (targeted at 55+) instead of today's training. */
export const SESSION_MODES = ['training', 'mobility_balance'] as const;
export const SessionModeSchema = z.enum(SESSION_MODES);
export type SessionMode = z.infer<typeof SessionModeSchema>;

/** Version of the medical-review statement the person confirms to lift the S3 lock (wording in packages/i18n). */
export const MEDICAL_REVIEW_STATEMENT_VERSION = 1 as const;

export const RECOVERY_COLLECTIONS = { readinessChecks: 'readiness_checks' } as const;
