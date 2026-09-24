import type {
  CalendarDateValue,
  CapacityModel,
  CardioRequest,
  HeartRateInfo,
  DeloadEvent,
  EquipmentId,
  EquipmentLoads,
  ExperienceLevel,
  IntensityLock,
  JointFlags,
  ProgramSessionContext,
  SafetyProfile,
  SessionHistoryEntry,
  SessionPlan,
} from '@fitadapt/shared';

export interface RecentLoad {
  readonly exerciseId: string;
  readonly loadKg: number;
  readonly prescribedAt: string;
}

/**
 * Input of generateSession() — validated by GenerateSessionInputSchema
 * (packages/shared/src/session.ts) at the engine's boundary. Readonly here so
 * callers can pass frozen presets.
 */
export interface GenerateSessionInput {
  readonly safetyProfile: SafetyProfile;
  /** Equipment of the place the user trains at today. */
  readonly equipment: readonly EquipmentId[];
  /** The loads that place offers (null/absent: M07 legacy rounding to `loadIncrementKg`). */
  readonly equipmentLoads?: EquipmentLoads | null;
  readonly equipmentProfileId?: string | null;
  readonly minutesAvailable: number;
  /** M05 pain traffic light (S2). Required (SAF-3): no flags is `{}`. */
  readonly jointFlags: JointFlags;
  /** M07 capacity model: the first session, then starting rungs and e1RMs. */
  readonly capacity?: CapacityModel | null;
  /** M08 session of the day (programSessionContext); absent → the first session from the capacity model. */
  readonly programSession?: ProgramSessionContext | null;
  /** Past sessions, oldest first (buildSessionHistory; boundSessionInput keeps the newest 60). Required (SAF-3): none is `[]`. */
  readonly history: readonly SessionHistoryEntry[];
  /** Loads prescribed recently (S5; M07 input). Required (SAF-3): none is `[]`. */
  readonly recentLoads: readonly RecentLoad[];
  readonly loadIncrementKg?: number;
  readonly bodyweightKg?: number | null;
  /** S7 re-check (M17 age gate). Required (SAF-3): null only when the account has no date of birth. */
  readonly birthDate: CalendarDateValue | null;
  /** SAF-12: the user's local calendar date (device time zone); null → the day before the clock's UTC date (fail closed). */
  readonly localDate: CalendarDateValue | null;
  readonly experience?: ExperienceLevel | null;
  /** S3 lock (packages/safety intensityLockStatus). Required (SAF-3): unlocked is `{ locked: false, since: null }`. */
  readonly intensityLock: IntensityLock;
  readonly readiness?: 'normal' | 'reduced';
  /** M05 triggered deload (recovery deloadStatus) → volume −40–50 %, no progression. */
  readonly deload?: DeloadEvent | null;
  /** M05: 'mobility_balance' → a standalone mobility and balance session. */
  readonly mode?: 'training' | 'mobility_balance' | 'cardio';
  /** M03: the cardio session the user chose (mode 'cardio'). */
  readonly cardio?: CardioRequest | null;
  /** M03: resting heart rate and its source (heart-rate-reserve zones); absent → effort and talk test. */
  readonly heartRate?: HeartRateInfo | null;
  /** M03: height for the BMI ≥ 35 low-impact default (with bodyweightKg). */
  readonly heightCm?: number | null;
  /** M03: opted up from the low-impact default (never above the SafetyProfile ceiling, never on a red joint). */
  readonly impactOptIn?: boolean;
}

export interface SessionSafetyEvent {
  readonly invariant: 'S1' | 'S2' | 'S3' | 'S5' | 'S7';
  readonly reasonCode: string;
  readonly action: 'blocked' | 'substituted' | 'session_ended' | 'intensity_locked' | 'capped';
  readonly engineVersion: string;
}

export type GenerateSessionResult =
  | { readonly status: 'ok'; readonly plan: SessionPlan; readonly safetyEvents: readonly SessionSafetyEvent[] }
  | { readonly status: 'unavailable'; readonly reasonCodes: readonly string[] };
