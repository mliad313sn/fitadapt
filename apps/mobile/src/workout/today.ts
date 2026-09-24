import { defaultEquipmentLoads, programDay, programSessionContext, type GenerateSessionInput } from '@fitadapt/engine';
import type { CapacityModel, CardioRequest, HeartRateInfo, IntensityLock, IsoDate, JointFlags, Profile, ProgramRecord, ReflowRecord, SafetyProfile, SessionHistoryEntry } from '@fitadapt/shared';
import type { StoredEquipmentProfile } from '../profile/profile-store';

/**
 * M02 on the device: the engine's input for today's session, from the
 * stored records only (profile, SafetyProfile selector, places, program and
 * reflows, capacity model, history, pain flags, S3 lock, M05 readiness and
 * session mode; the triggered deload is added at generation time). The engine decides
 * everything else; this only gathers facts. A place the user picks for today
 * (Anywhere Switcher) replaces the program's place; minutes the user picks
 * replace the profile's session length (time-boxing).
 */
export interface TodayFacts {
  readonly profile: Profile;
  readonly safetyProfile: SafetyProfile;
  readonly places: readonly StoredEquipmentProfile[];
  readonly program: ProgramRecord | null;
  readonly reflows: readonly ReflowRecord[];
  readonly capacity: CapacityModel | null;
  readonly history: readonly SessionHistoryEntry[];
  readonly jointFlags: JointFlags;
  readonly intensityLock: IntensityLock;
  readonly today: IsoDate;
  /** The place picked for today, if any. */
  readonly placeId: string | null;
  readonly minutes: number | null;
  /** M05: today's readiness (a low check → 'reduced'; no check → no adjustment). */
  readonly readiness?: 'normal' | 'reduced';
  /** M05: a standalone mobility and balance session instead of today's training; M03: a cardio session. */
  readonly mode?: 'training' | 'mobility_balance' | 'cardio';
  /** M03: the cardio session chosen (mode 'cardio'). */
  readonly cardio?: CardioRequest;
  /** M03: resting heart rate from the heart-rate port (null: effort and talk test only). */
  readonly heartRate?: HeartRateInfo | null;
  /** M03: the user opted up from the low-impact default. */
  readonly impactOptIn?: boolean;
}

export type TodayInput =
  | { readonly status: 'ready'; readonly input: GenerateSessionInput; readonly placeId: string | null; readonly fromProgram: boolean }
  | { readonly status: 'rest_day' }
  | { readonly status: 'no_place' };

export function todayInput(f: TodayFacts): TodayInput {
  const mobility = f.mode === 'mobility_balance';
  const cardio = f.mode === 'cardio';
  // A standalone session (mobility or cardio) replaces today's program session.
  const day = f.program && !mobility && !cardio ? programDay(f.program.program, f.reflows, f.today) : null;
  const session = day?.sessions[0] ?? null;
  // A program exists for today's week but nothing is planned today: a rest day (no session is invented).
  if (day && !session) return { status: 'rest_day' };
  const place = f.places.find((p) => p.id === f.placeId) ?? f.places.find((p) => p.id === session?.equipmentProfileId) ?? f.places.find((p) => p.id === f.profile.activeEquipmentProfileId) ?? f.places[0];
  if (!place) return { status: 'no_place' };
  const input: GenerateSessionInput = {
    safetyProfile: f.safetyProfile,
    equipment: [...place.data.equipment],
    equipmentLoads: place.data.loads ?? defaultEquipmentLoads(place.data.location),
    equipmentProfileId: place.id,
    minutesAvailable: f.minutes ?? f.profile.schedule.minutesPerSession,
    jointFlags: f.jointFlags,
    capacity: f.capacity,
    programSession: day && session ? programSessionContext(day, session) : null,
    history: [...f.history],
    bodyweightKg: f.profile.biometrics.weightKg,
    // M03: height for the BMI ≥ 35 low-impact default; heart-rate facts for the zones.
    heightCm: f.profile.biometrics.heightCm,
    ...(f.heartRate ? { heartRate: f.heartRate } : {}),
    ...(f.impactOptIn ? { impactOptIn: true } : {}),
    birthDate: f.profile.birthDate,
    experience: f.profile.experience,
    intensityLock: f.intensityLock,
    ...(f.readiness && !mobility ? { readiness: f.readiness } : {}),
    ...(mobility ? { mode: 'mobility_balance' as const } : {}),
    ...(cardio ? { mode: 'cardio' as const, cardio: f.cardio ?? { protocol: 'steady' as const } } : {}),
  };
  return { status: 'ready', input, placeId: place.id, fromProgram: session !== null };
}

/** A deterministic engine seed per generation (recorded in the plan; the engine itself never reads the clock). */
export const seedFrom = (ms: number): number => Math.floor(ms / 1000) % 2_147_483_647;
