import { describe, expect, it } from 'vitest';
import {
  BiometricsSchema,
  EMPTY_BIOMETRICS,
  EquipmentProfileSchema,
  GoalsSchema,
  PROFILE_INPUT_BOUNDS,
  ProfileSchema,
  ScheduleSchema,
  ScreeningRecordSchema,
  ScreeningResponsesSchema,
  unvalidatedKeys,
} from './index.js';

const profile = {
  schemaVersion: 1,
  goals: { primary: 'fat_loss', secondary: 'general_health' },
  experience: 'none',
  schedule: { daysPerWeek: 3, minutesPerSession: 40, preferredTimes: ['evening'], remindersEnabled: true },
  birthDate: { year: 1988, month: 3, day: 14 },
  biometrics: EMPTY_BIOMETRICS,
  limitations: [{ region: 'knee' }],
  excludedExerciseIds: ['burpee'],
  motivation: 'Keep up with my kids',
  activeEquipmentProfileId: null,
  onboardingCompletedAt: null,
};

describe('M01 profile contracts', () => {
  it('accepts a complete profile whose biometrics are all deferred', () => {
    expect(ProfileSchema.safeParse(profile).success).toBe(true);
  });

  it('rejects a secondary goal equal to the primary goal', () => {
    expect(GoalsSchema.safeParse({ primary: 'strength', secondary: 'strength' }).success).toBe(false);
    expect(GoalsSchema.safeParse({ primary: 'strength', secondary: null }).success).toBe(true);
  });

  it('only accepts offered session lengths and 1–7 days', () => {
    expect(ScheduleSchema.safeParse({ ...profile.schedule, minutesPerSession: 37 }).success).toBe(false);
    expect(ScheduleSchema.safeParse({ ...profile.schedule, daysPerWeek: 0 }).success).toBe(false);
    expect(ScheduleSchema.safeParse({ ...profile.schedule, daysPerWeek: 8 }).success).toBe(false);
  });

  it('keeps biometrics within plausibility bounds, and every one optional', () => {
    expect(BiometricsSchema.safeParse({ heightCm: 178, weightKg: 120, bodyFatPercent: null }).success).toBe(true);
    expect(BiometricsSchema.safeParse({ heightCm: 20, weightKg: null, bodyFatPercent: null }).success).toBe(false);
    expect(BiometricsSchema.safeParse({ heightCm: null, weightKg: 1000, bodyFatPercent: null }).success).toBe(false);
    expect(BiometricsSchema.safeParse({ heightCm: null, weightKg: null, bodyFatPercent: 90 }).success).toBe(false);
  });

  it('caps the motivation anchor at one line', () => {
    expect(ProfileSchema.safeParse({ ...profile, motivation: 'x'.repeat(121) }).success).toBe(false);
  });

  it('refuses duplicate equipment in a profile', () => {
    expect(EquipmentProfileSchema.safeParse({ location: 'home', equipment: ['dumbbell', 'dumbbell'] }).success).toBe(false);
    expect(EquipmentProfileSchema.safeParse({ location: 'park', equipment: ['pull_up_bar'] }).success).toBe(true);
  });

  it('screening records carry responses and the derived SafetyProfile', () => {
    const responses = { answers: { chest_discomfort: 'no' }, clearanceAttested: false, birthDate: profile.birthDate, answeredOn: { year: 2026, month: 9, day: 23 }, limitations: [], excludedExerciseIds: [] };
    expect(ScreeningResponsesSchema.safeParse(responses).success).toBe(true);
    expect(ScreeningResponsesSchema.safeParse({ ...responses, answers: { chest_discomfort: 'maybe' } }).success).toBe(false);
    expect(ScreeningRecordSchema.safeParse({ reason: 'onboarding', responses, safetyProfile: {}, completedAt: '2026-09-23T10:00:00.000Z' }).success).toBe(false);
  });

  it('every input bound awaits validation', () => {
    expect(unvalidatedKeys(PROFILE_INPUT_BOUNDS)).toHaveLength(Object.keys(PROFILE_INPUT_BOUNDS).length);
  });
});
