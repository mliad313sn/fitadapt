import { z } from 'zod';
import { ReasonCodeSchema } from './assessment.js';
import { defineConfig } from './config.js';
import { ImpactLevelSchema, SlugSchema } from './exercise.js';
import { IsoDateSchema } from './program.js';

/**
 * M03 — Cardio & Conditioning Suite contracts
 * (docs/specs/M03-cardio-conditioning.md, ADR-018).
 *
 * Entities: IntervalProtocol (the work/rest structure of an interval
 * protocol), CardioSession (`CardioPlan`: what the engine prescribes for a
 * conditioning block — protocol, movements, heart-rate or effort zones and
 * the second-by-second timeline the device runs), HRZoneSet and
 * AerobicMinutesLedger (the week's moderate and vigorous minutes against the
 * WHO range). The engine (packages/engine/src/cardio) is the only producer
 * of cardio plans; the app, the API and the AI coach only read them. Every
 * number the engine uses lives in packages/engine CARDIO_CONFIG with its
 * source and `validated: false`.
 *
 * Honest physiology copy (C9): nothing here, and nothing rendered from it,
 * speaks of a "fat-burning zone" or of lipolysis. Zones are named by effort
 * (light, moderate, vigorous) only.
 */

/**
 * Protocols the engine can build. 'hiit' and 'tabata' are high-intensity
 * interval training: gated by S1 (SafetyProfile.allowHIIT, unresolved
 * screening flags) and by ≥ 2 weeks of consistent logged training; so is a
 * 'custom' protocol asked at vigorous intensity. EMOM and AMRAP are
 * prescribed at a controlled (moderate) effort.
 */
export const CARDIO_PROTOCOLS = ['hiit', 'tabata', 'emom', 'amrap', 'steady', 'custom'] as const;
export const CardioProtocolSchema = z.enum(CARDIO_PROTOCOLS);
export type CardioProtocol = z.infer<typeof CardioProtocolSchema>;

/** Effort bands, lowest first (never named after a fuel: C9). */
export const CARDIO_INTENSITIES = ['light', 'moderate', 'vigorous'] as const;
export const CardioIntensitySchema = z.enum(CARDIO_INTENSITIES);
export type CardioIntensity = z.infer<typeof CardioIntensitySchema>;

/** Talk test (fallback when no heart-rate data): what speaking feels like in the zone. */
export const TALK_TESTS = ['full_conversation', 'short_sentences', 'few_words'] as const;
export const TalkTestSchema = z.enum(TALK_TESTS);
export type TalkTest = z.infer<typeof TalkTestSchema>;

const BOUND = 'engineering default: input plausibility bound (M03), no external source';

/** Plausibility bounds of the inputs. They only catch typing errors (they are not health thresholds) and carry no external source. */
export const CARDIO_INPUT_BOUNDS_CONFIG = defineConfig({
  restingBpmMin: { value: 30, unit: 'bpm', source: BOUND, validated: false },
  restingBpmMax: { value: 120, unit: 'bpm', source: BOUND, validated: false },
  customWorkSecondsMin: { value: 10, unit: 's', source: BOUND, validated: false },
  customWorkSecondsMax: { value: 600, unit: 's', source: BOUND, validated: false },
  customRestSecondsMax: { value: 600, unit: 's', source: BOUND, validated: false },
  customRoundsMax: { value: 30, unit: 'rounds', source: BOUND, validated: false },
});
const bound = (key: keyof typeof CARDIO_INPUT_BOUNDS_CONFIG) => CARDIO_INPUT_BOUNDS_CONFIG[key].value;
export const CARDIO_INPUT_BOUNDS = Object.freeze({
  restingBpmMin: bound('restingBpmMin'),
  restingBpmMax: bound('restingBpmMax'),
  customWorkSecondsMin: bound('customWorkSecondsMin'),
  customWorkSecondsMax: bound('customWorkSecondsMax'),
  customRestSecondsMax: bound('customRestSecondsMax'),
  customRoundsMax: bound('customRoundsMax'),
});

// ------------------------------------------------------------ heart rate

/**
 * Where heart-rate facts come from. 'manual' = the user typed a resting heart
 * rate; 'wearable' = a heart-rate source plugged into the device port (M12);
 * 'none' = no heart-rate data (RPE and talk test only).
 */
export const HEART_RATE_SOURCES = ['none', 'manual', 'wearable'] as const;
export const HeartRateSourceKindSchema = z.enum(HEART_RATE_SOURCES);
export type HeartRateSourceKind = z.infer<typeof HeartRateSourceKindSchema>;

export const HeartRateInfoSchema = z.strictObject({
  source: HeartRateSourceKindSchema,
  /** Resting heart rate in beats per minute (null: unknown). */
  restingBpm: z.number().int().min(CARDIO_INPUT_BOUNDS.restingBpmMin).max(CARDIO_INPUT_BOUNDS.restingBpmMax).nullable(),
});
export type HeartRateInfo = z.infer<typeof HeartRateInfoSchema>;

/** One live heart-rate reading from a heart-rate source (device port; never stored or sent by M03). */
export const HeartRateSampleSchema = z.strictObject({
  bpm: z.number().int().min(25).max(250),
  atMs: z.number().int().min(0),
});
export type HeartRateSample = z.infer<typeof HeartRateSampleSchema>;

export const HrZoneSchema = z.strictObject({
  intensity: CardioIntensitySchema,
  /** Heart-rate range (heart-rate reserve method); null when zones are by perceived exertion only. */
  minBpm: z.number().int().min(25).max(250).nullable(),
  maxBpm: z.number().int().min(25).max(250).nullable(),
  /** Perceived exertion (0–10), always given, capped by the SafetyProfile (S1). */
  rpeMin: z.number().min(0).max(10),
  rpeMax: z.number().min(0).max(10),
  talkTest: TalkTestSchema,
});
export type HrZone = z.infer<typeof HrZoneSchema>;

export const HR_ZONE_METHODS = ['heart_rate_reserve', 'perceived_exertion'] as const;

export const HrZoneSetSchema = z.strictObject({
  method: z.enum(HR_ZONE_METHODS),
  /** Estimated maximum heart rate (208 − 0.7 × age, Tanaka et al. 2001); null without a heart-rate method. */
  hrMaxBpm: z.number().int().min(60).max(250).nullable(),
  restingBpm: z.number().int().min(CARDIO_INPUT_BOUNDS.restingBpmMin).max(CARDIO_INPUT_BOUNDS.restingBpmMax).nullable(),
  /** Light, moderate, vigorous — in that order. */
  zones: z.array(HrZoneSchema).length(3),
  reasonCodes: z.array(ReasonCodeSchema).min(1),
});
export type HrZoneSet = z.infer<typeof HrZoneSetSchema>;

// ------------------------------------------------------------ the plan

/** The work/rest structure of an interval protocol (null for steady-state and AMRAP). */
export const IntervalProtocolSchema = z.strictObject({
  workSeconds: z.number().int().min(1).max(600),
  restSeconds: z.number().int().min(0).max(600),
  rounds: z.number().int().min(1).max(60),
  blocks: z.number().int().min(1).max(6),
  blockRestSeconds: z.number().int().min(0).max(600),
});
export type IntervalProtocol = z.infer<typeof IntervalProtocolSchema>;

export const CARDIO_SEGMENT_KINDS = ['warm_up', 'work', 'recover', 'block_rest', 'steady', 'emom_minute', 'amrap', 'cool_down'] as const;
export const CardioSegmentKindSchema = z.enum(CARDIO_SEGMENT_KINDS);
export type CardioSegmentKind = z.infer<typeof CardioSegmentKindSchema>;

/** One step of the timeline the device runs (offsets in whole seconds from the start of the block). */
export const CardioSegmentSchema = z.strictObject({
  index: z.number().int().min(0),
  kind: CardioSegmentKindSchema,
  startSeconds: z.number().int().min(0),
  durationSeconds: z.number().int().min(1).max(10_800),
  intensity: CardioIntensitySchema,
  /** The movement for this step (null: easy movement of the user's choice). */
  exerciseId: SlugSchema.nullable(),
  /** EMOM / AMRAP: reps of each movement (null: work for the time). */
  reps: z.number().int().min(1).max(100).nullable(),
  /** Interval round (1-based) and rounds in the block; null outside rounds. */
  round: z.number().int().min(1).nullable(),
  rounds: z.number().int().min(1).nullable(),
});
export type CardioSegment = z.infer<typeof CardioSegmentSchema>;

export const CardioMovementSchema = z.strictObject({
  exerciseId: SlugSchema,
  impact: ImpactLevelSchema,
  reasonCodes: z.array(ReasonCodeSchema).min(1),
});
export type CardioMovement = z.infer<typeof CardioMovementSchema>;

export const CardioPlanSchema = z
  .strictObject({
    protocol: CardioProtocolSchema,
    /** A whole cardio session (the timeline starts with the plan's warm-up) or a finisher after the strength work. */
    placement: z.enum(['session', 'finisher']),
    /** High-intensity interval training (S1-gated; the first one needs the L3 intensity notice). */
    hiit: z.boolean(),
    interval: IntervalProtocolSchema.nullable(),
    /** The impact ceiling the movements respect (SafetyProfile, joint flags, body weight). */
    impactCeiling: ImpactLevelSchema,
    /** The movements or machines used (empty: easy movement of the user’s choice, e.g. walking). */
    movements: z.array(CardioMovementSchema).max(6),
    /** The effort the main block aims for. */
    targetIntensity: CardioIntensitySchema,
    zones: HrZoneSetSchema,
    timeline: z.array(CardioSegmentSchema).min(1).max(400),
    totalSeconds: z.number().int().min(1),
    /** Seconds of the timeline at moderate and at vigorous effort (the weekly aerobic target counts them). */
    planned: z.strictObject({ moderateSeconds: z.number().int().min(0), vigorousSeconds: z.number().int().min(0) }),
    reasonCodes: z.array(ReasonCodeSchema).min(1),
  })
  .refine((p) => p.timeline.every((s, i) => s.index === i && s.startSeconds === (i === 0 ? 0 : p.timeline[i - 1]!.startSeconds + p.timeline[i - 1]!.durationSeconds)), { message: 'the timeline is contiguous and in order' })
  .refine((p) => p.timeline.at(-1)!.startSeconds + p.timeline.at(-1)!.durationSeconds === p.totalSeconds, { message: 'totalSeconds is the end of the timeline' })
  .refine((p) => !p.hiit || p.timeline.some((s) => s.intensity === 'vigorous'), { message: 'a HIIT plan has vigorous work' })
  .refine((p) => p.hiit || p.timeline.every((s) => s.intensity !== 'vigorous'), { message: 'only a HIIT plan has vigorous work' });
export type CardioPlan = z.infer<typeof CardioPlanSchema>;

/** What the user asks for when choosing a cardio session (mode 'cardio'). */
export const CardioRequestSchema = z.strictObject({
  protocol: CardioProtocolSchema,
  /** A preferred movement or machine (e.g. rowing_machine_steady); the engine keeps it only if it is allowed here. */
  exerciseId: SlugSchema.nullable().optional(),
  /** 'custom' only: the work/rest structure and the effort of the work intervals. */
  custom: z
    .strictObject({
      workSeconds: z.number().int().min(CARDIO_INPUT_BOUNDS.customWorkSecondsMin).max(CARDIO_INPUT_BOUNDS.customWorkSecondsMax),
      restSeconds: z.number().int().min(0).max(CARDIO_INPUT_BOUNDS.customRestSecondsMax),
      rounds: z.number().int().min(1).max(CARDIO_INPUT_BOUNDS.customRoundsMax),
      intensity: z.enum(['moderate', 'vigorous']),
    })
    .optional(),
});
export type CardioRequest = z.infer<typeof CardioRequestSchema>;

// ------------------------------------------------------------ the week

/** The weekly aerobic target (WHO 2020, as cited by the spec): moderate-equivalent minutes, vigorous minutes counting double. */
export const AerobicMinutesLedgerSchema = z.strictObject({
  weekStart: IsoDateSchema,
  weekEnd: IsoDateSchema,
  moderateMinutes: z.number().min(0),
  vigorousMinutes: z.number().min(0),
  /** moderate + 2 × vigorous. */
  equivalentMinutes: z.number().min(0),
  targetMin: z.number().min(0),
  targetMax: z.number().min(0),
  status: z.enum(['below', 'within', 'above']),
  /** Cardio blocks counted this week. */
  sessions: z.number().int().min(0),
  reasonCodes: z.array(ReasonCodeSchema).min(1),
});
export type AerobicMinutesLedger = z.infer<typeof AerobicMinutesLedgerSchema>;
