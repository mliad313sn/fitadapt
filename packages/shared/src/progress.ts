import { z } from 'zod';
import { ReasonCodeSchema } from './assessment.js';
import { IsoDateTimeSchema, UuidSchema } from './common.js';
import { defineConfig } from './config.js';
import { SlugSchema } from './exercise.js';
import { IsoDateSchema, ProgramMuscleGroupSchema } from './program.js';

/**
 * M04 — Tracking, analytics and progress dashboard contracts
 * (docs/specs/M04-tracking-progress-dashboard.md, ADR-019, ADR-020).
 *
 * Entities: BodyMetric (body weight, optional body-fat estimate),
 * Measurement (circumferences), ProgressPhoto (metadata of an encrypted blob
 * that stays on the device), Milestone (a forecast shown as a date range with
 * a confidence, always an estimate), AdherenceStat (planned vs completed,
 * streaks that count planned rest days). The analytics are pure engine
 * functions (packages/engine `analytics`); progression logic stays in M02.
 *
 * Everything is metric internally; display units follow the user's
 * preference. Body data is optional: nothing here is required to train.
 */

/**
 * Plausibility bounds of the body inputs. They only catch typing errors (they
 * are not health thresholds) and carry no external source.
 */
export const BODY_INPUT_BOUNDS = defineConfig({
  weightKgMin: { value: 25, unit: 'kg', source: 'engineering default: input plausibility bound (M01 PROFILE_INPUT_BOUNDS, reused by M04), no external source', validated: false },
  weightKgMax: { value: 350, unit: 'kg', source: 'engineering default: input plausibility bound (M01 PROFILE_INPUT_BOUNDS, reused by M04), no external source', validated: false },
  bodyFatPercentMin: { value: 2, unit: '%', source: 'engineering default: input plausibility bound (M01 PROFILE_INPUT_BOUNDS, reused by M04), no external source', validated: false },
  bodyFatPercentMax: { value: 70, unit: '%', source: 'engineering default: input plausibility bound (M01 PROFILE_INPUT_BOUNDS, reused by M04), no external source', validated: false },
  circumferenceCmMin: { value: 10, unit: 'cm', source: 'engineering default: input plausibility bound (M04), no external source', validated: false },
  circumferenceCmMax: { value: 250, unit: 'cm', source: 'engineering default: input plausibility bound (M04), no external source', validated: false },
});
const bound = (key: keyof typeof BODY_INPUT_BOUNDS) => BODY_INPUT_BOUNDS[key].value;

// ------------------------------------------------------------ body metrics

export const BODY_METRIC_KINDS = ['weight', 'body_fat'] as const;
export const BodyMetricKindSchema = z.enum(BODY_METRIC_KINDS);
export type BodyMetricKind = z.infer<typeof BodyMetricKindSchema>;

/**
 * One body-weight or body-fat entry (collection `body_metrics`, append-only).
 * A correction is a new entry naming the one it corrects; `value: null`
 * removes the corrected entry. `measuredOn` is the user's local calendar date.
 */
export const BodyMetricSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: BodyMetricKindSchema,
    /** kg for weight, % for the body-fat estimate; null = the corrected entry is removed. */
    value: z.number().finite().nullable(),
    measuredOn: IsoDateSchema,
    at: IsoDateTimeSchema,
    correctionOf: UuidSchema.nullable(),
  })
  .refine(
    (m) =>
      m.value === null ||
      (m.kind === 'weight' ? m.value >= bound('weightKgMin') && m.value <= bound('weightKgMax') : m.value >= bound('bodyFatPercentMin') && m.value <= bound('bodyFatPercentMax')),
    { message: 'value out of the plausible range' },
  )
  .refine((m) => m.value !== null || m.correctionOf !== null, { message: 'only a correction may remove a value' });
export type BodyMetric = z.infer<typeof BodyMetricSchema>;

export const MEASUREMENT_SITES = ['neck', 'chest', 'waist', 'hips', 'upper_arm', 'thigh', 'calf'] as const;
export const MeasurementSiteSchema = z.enum(MEASUREMENT_SITES);
export type MeasurementSite = z.infer<typeof MeasurementSiteSchema>;

/** One circumference (collection `measurements`, append-only, corrections as for body metrics). */
export const MeasurementSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    site: MeasurementSiteSchema,
    valueCm: z.number().min(bound('circumferenceCmMin')).max(bound('circumferenceCmMax')).nullable(),
    measuredOn: IsoDateSchema,
    at: IsoDateTimeSchema,
    correctionOf: UuidSchema.nullable(),
  })
  .refine((m) => m.valueCm !== null || m.correctionOf !== null, { message: 'only a correction may remove a value' });
export type Measurement = z.infer<typeof MeasurementSchema>;

export const PROGRESS_COLLECTIONS = { bodyMetrics: 'body_metrics', measurements: 'measurements' } as const;

// ---------------------------------------------------------- progress photos

export const PHOTO_POSES = ['front', 'side', 'back'] as const;
export const PhotoPoseSchema = z.enum(PHOTO_POSES);
export type PhotoPose = z.infer<typeof PhotoPoseSchema>;

/**
 * ProgressPhoto: metadata of one photo. The image itself is an encrypted blob
 * on the device (AES-256-GCM, key in the OS keystore, ADR-020); the metadata
 * lives in the encrypted device database and is never synced. A backup (only
 * when the user turns it on) carries the metadata and the image inside the
 * same end-to-end-encrypted envelope.
 */
export const ProgressPhotoSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: UuidSchema,
  pose: PhotoPoseSchema,
  takenOn: IsoDateSchema,
  at: IsoDateTimeSchema,
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/heic', 'image/webp']),
  /** Size of the encrypted blob on the device. */
  byteLength: z.number().int().min(1),
  /** When the encrypted copy last reached the backup (null = not backed up). */
  backedUpAt: IsoDateTimeSchema.nullable(),
});
export type ProgressPhoto = z.infer<typeof ProgressPhotoSchema>;

/** Backup envelope format (ADR-020): version byte, 96-bit nonce, AES-256-GCM ciphertext and 128-bit tag. */
export const PHOTO_ENVELOPE_VERSION = 1;
export const PHOTO_ENVELOPE_NONCE_BYTES = 12;
export const PHOTO_ENVELOPE_TAG_BYTES = 16;
export const PHOTO_ENVELOPE_MIN_BYTES = 1 + PHOTO_ENVELOPE_NONCE_BYTES + PHOTO_ENVELOPE_TAG_BYTES + 1;

/**
 * The photo key wrapped by a key derived from the user's recovery code
 * (memory-hard KDF): the service stores it and cannot unwrap it.
 */
export const WrappedPhotoKeySchema = z.strictObject({
  schemaVersion: z.literal(1),
  kdf: z.strictObject({ name: z.literal('scrypt'), logN: z.number().int().min(10).max(22), r: z.number().int().min(1).max(32), p: z.number().int().min(1).max(16) }),
  /** base64 */
  salt: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).min(16).max(64),
  /** base64 of the envelope (version, nonce, ciphertext of the 32-byte key, tag). */
  wrappedKey: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).min(40).max(200),
});
export type WrappedPhotoKey = z.infer<typeof WrappedPhotoKeySchema>;

export const PhotoBackupEntrySchema = z.strictObject({ photoId: UuidSchema, byteLength: z.number().int().min(1), storedAt: IsoDateTimeSchema });
export type PhotoBackupEntry = z.infer<typeof PhotoBackupEntrySchema>;

// ------------------------------------------------------------- analytics

/** One point of an exercise's history: the best set of a session. */
export const ExerciseHistoryPointSchema = z.strictObject({
  date: IsoDateSchema,
  planId: UuidSchema,
  exerciseId: SlugSchema,
  /** Epley e1RM of the best loaded set (null when no loaded set of 1–12 reps was done). */
  e1rmKg: z.number().min(0).nullable(),
  /** Σ reps × load of the done sets (kg); 0 for body-weight sets. */
  volumeLoadKg: z.number().min(0),
  bestSet: z.strictObject({ reps: z.number().int().min(0).nullable(), seconds: z.number().int().min(0).nullable(), loadKg: z.number().min(0).nullable(), rir: z.number().int().min(0).nullable() }).nullable(),
  doneSets: z.number().int().min(0),
  /** Position on the exercise's ladder (0-based rung), null when it has none. */
  ladderRung: z.number().int().min(0).nullable(),
});
export type ExerciseHistoryPoint = z.infer<typeof ExerciseHistoryPointSchema>;

export const WeeklyMuscleSetsSchema = z.strictObject({
  weekStart: IsoDateSchema,
  muscle: ProgramMuscleGroupSchema,
  /** Hard sets done this week (fractional: secondary muscles count part of a set). */
  hardSets: z.number().min(0),
  rangeMin: z.number().min(0),
  rangeMax: z.number().min(0),
  status: z.enum(['below', 'within', 'above']),
});
export type WeeklyMuscleSets = z.infer<typeof WeeklyMuscleSetsSchema>;

export const TrendPointSchema = z.strictObject({ date: IsoDateSchema, value: z.number(), trend: z.number() });
export type TrendPoint = z.infer<typeof TrendPointSchema>;

export const WeeklyRateSchema = z.strictObject({
  weekEnd: IsoDateSchema,
  /** Change of the smoothed trend over the 7 days ending on weekEnd, as a % of the trend a week earlier (negative = loss). */
  percentPerWeek: z.number(),
});
export type WeeklyRate = z.infer<typeof WeeklyRateSchema>;

/**
 * M04 → M10 hand-off: sustained loss above the threshold for the required
 * number of consecutive weeks. M10 (not built) owns what follows; M04 shows a
 * supportive notice and hands the event over.
 */
export const GuardrailEventSchema = z.strictObject({
  kind: z.literal('bodyweight.sustained_loss'),
  detectedOn: IsoDateSchema,
  /** The consecutive weeks above the threshold (oldest first). */
  weeks: z.array(WeeklyRateSchema).min(1),
  thresholdPercentPerWeek: z.number().positive(),
  reasonCodes: z.array(ReasonCodeSchema).min(1),
});
export type GuardrailEvent = z.infer<typeof GuardrailEventSchema>;

export const CONFIDENCE_LEVELS = ['low', 'medium', 'high'] as const;
export const ConfidenceSchema = z.enum(CONFIDENCE_LEVELS);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const FORECAST_STATUSES = ['forecast', 'achieved', 'insufficient_data', 'no_trend', 'beyond_horizon'] as const;

/**
 * Milestone: when a target may be reached, as a date range with a
 * confidence. Never a promise (L1): `estimate` is always true and every
 * screen shows the "estimate, not a guarantee" label next to it.
 */
export const MilestoneForecastSchema = z
  .strictObject({
    milestoneId: z.string().regex(/^[a-z0-9_.:-]{1,80}$/),
    status: z.enum(FORECAST_STATUSES),
    estimate: z.literal(true),
    earliest: IsoDateSchema.nullable(),
    latest: IsoDateSchema.nullable(),
    confidence: ConfidenceSchema.nullable(),
    /** Data points the forecast used. */
    points: z.number().int().min(0),
    reasonCodes: z.array(ReasonCodeSchema).min(1),
  })
  .refine((f) => (f.status === 'forecast') === (f.earliest !== null && f.latest !== null && f.confidence !== null), { message: 'a forecast has a range and a confidence, and only a forecast does' })
  .refine((f) => f.earliest === null || f.latest === null || f.earliest <= f.latest, { message: 'earliest after latest' });
export type MilestoneForecast = z.infer<typeof MilestoneForecastSchema>;

export const AdherenceStatSchema = z.strictObject({
  from: IsoDateSchema,
  to: IsoDateSchema,
  planned: z.number().int().min(0),
  completed: z.number().int().min(0),
  /** completed / planned (null when nothing was planned). */
  rate: z.number().min(0).max(1).nullable(),
  /** Consecutive days up to `to` where each planned session was done and every rest day counts. */
  currentStreakDays: z.number().int().min(0),
  longestStreakDays: z.number().int().min(0),
  /** Sessions done on days that had none planned (never counted against the plan). */
  extra: z.number().int().min(0),
  /**
   * L4 (A4/A6 pre-review, streaks): planned days protected by a safety pause (red pain, a red-flag stop and the
   * S3 lock after it, a low readiness check, a session ended for pain). They are neither kept nor missed: the
   * streak goes on like a rest day, and training on them adds nothing (never a reward for training through a pause).
   */
  protectedDays: z.number().int().min(0),
});
export type AdherenceStat = z.infer<typeof AdherenceStatSchema>;
