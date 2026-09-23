import type { IsoDate, Profile, ProgramInput, ProgramRecord, SafetyProfile } from '@fitadapt/shared';
import type { StoredEquipmentProfile } from '../profile/profile-store';

/**
 * M08 on the device: the engine's program input from the M01 profile, the
 * typed SafetyProfile selector (never re-derived here) and the stored
 * equipment profiles (one place per profile). The engine decides the rest.
 */
export function programInputFrom(profile: Profile, safetyProfile: SafetyProfile, equipment: readonly StoredEquipmentProfile[], today: IsoDate, previous: ProgramRecord | null): ProgramInput {
  return {
    goals: profile.goals,
    experience: profile.experience,
    daysPerWeek: profile.schedule.daysPerWeek,
    minutesPerSession: profile.schedule.minutesPerSession,
    trainingDays: null,
    startDate: today,
    safetyProfile,
    locations: equipment.map((p) => ({ equipmentProfileId: p.id, location: p.data.location, equipment: [...p.data.equipment] })),
    defaultEquipmentProfileId: profile.activeEquipmentProfileId,
    locationByWeekday: {},
    previousGoal: previous ? previous.program.goal : null,
  };
}

/** Why a new program is made: the first one, or a changed goal (transition week). */
export function programReason(previous: ProgramRecord | null, profile: Profile): ProgramRecord['reason'] {
  if (!previous) return 'first';
  return previous.program.goal !== profile.goals.primary ? 'goal_change' : 'renewal';
}
