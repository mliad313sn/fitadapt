import { evaluateScreening } from '@fitadapt/safety';
import { SCREENING_QUESTION_IDS, type ScreeningQuestionId } from '@fitadapt/shared';
import { describe, expect, it } from 'vitest';
import { UNRESTRICTED_SAFETY_PROFILE, allowedBySafetyProfile, seedLibrary } from './index.js';

const profileFor = (yes: ScreeningQuestionId[]) =>
  evaluateScreening({
    answers: Object.fromEntries(SCREENING_QUESTION_IDS.map((q) => [q, yes.includes(q) ? 'yes' : 'no'])),
    clearanceAttested: false,
    birthDate: { year: 1990, month: 1, day: 1 },
    answeredOn: { year: 2026, month: 9, day: 23 },
    limitations: [],
    excludedExerciseIds: [],
  });

describe('allowedBySafetyProfile (M01 SafetyProfile on the M06 library)', () => {
  const lib = seedLibrary();
  const pool = (p: Parameters<typeof allowedBySafetyProfile>[1]) => lib.exercises.filter((e) => allowedBySafetyProfile(e, p));

  it('offers the whole library to an unrestricted profile', () => {
    expect(pool(UNRESTRICTED_SAFETY_PROFILE)).toHaveLength(lib.exercises.length);
  });

  it('never offers an exercise above the impact ceiling or with an avoided property', () => {
    const joint = profileFor(['bone_joint_back']);
    expect(joint.impactCeiling).toBe('low');
    const allowed = pool(joint);
    expect(allowed.length).toBeLessThan(lib.exercises.length);
    expect(allowed.every((e) => e.impact === 'none' || e.impact === 'low')).toBe(true);
    expect(allowed.some((e) => e.contraindications.includes('jumping_landing'))).toBe(false);
  });

  it('pregnancy routes to the low-intensity library only (S7)', () => {
    const allowed = pool(profileFor(['pregnancy_or_recent_birth']));
    expect(allowed.length).toBeGreaterThan(0);
    for (const e of allowed) {
      expect(['none', 'low']).toContain(e.impact);
      expect(['entry', 'beginner']).toContain(e.skill);
      expect(e.tags).not.toContain('conditioning');
    }
  });

  it('respects exercises the user excluded', () => {
    expect(pool({ ...UNRESTRICTED_SAFETY_PROFILE, excludedExerciseIds: ['push_up'] }).some((e) => e.id === 'push_up')).toBe(false);
  });
});
