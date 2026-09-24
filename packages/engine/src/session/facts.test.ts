import { describe, expect, it } from 'vitest';
import { FULL_GYM, SAFE_FACTS, profileFrom } from '../__fixtures__/library.js';
import { GYM_CAPACITY } from '../__fixtures__/recovery.js';
import { SESSION_LIBRARY } from '../__fixtures__/session.js';
import { fixedClock } from '../clock.js';
import { createEngineContext } from '../context.js';
import { ageGateDate, generateSession } from './generate.js';
import type { GenerateSessionInput } from './types.js';

const input = (over: Partial<GenerateSessionInput> = {}): GenerateSessionInput => ({ ...SAFE_FACTS, capacity: GYM_CAPACITY, safetyProfile: profileFrom(), equipment: FULL_GYM, minutesAvailable: 60, ...over });
const gen = (i: unknown, ms: number) => generateSession(i as GenerateSessionInput, SESSION_LIBRARY, createEngineContext({ clock: fixedClock(ms), seed: 2 }));

describe('SAF-3: the engine boundary fails closed when a safety fact is missing', () => {
  it('a missing S3 lock, joint flags, history, recent loads, date of birth or local date is a parse error, never "safe"', () => {
    const now = Date.parse('2026-09-24T08:00:00.000Z');
    expect(gen(input(), now).status).toBe('ok');
    for (const key of Object.keys(SAFE_FACTS)) {
      const { [key as keyof typeof SAFE_FACTS]: _omit, ...missing } = input();
      expect(() => gen(missing, now), key).toThrow();
    }
  });

  it('the explicit facts are enforced: locked → no session; a red knee → no knee-loading squat', () => {
    const now = Date.parse('2026-09-24T08:00:00.000Z');
    expect(gen(input({ intensityLock: { locked: true, since: '2026-09-23T08:00:00.000Z' } }), now)).toEqual({ status: 'unavailable', reasonCodes: ['session.unavailable.s3_intensity_locked'] });
    const red = gen(input({ jointFlags: { knee: 'red' } }), now);
    expect(red.status === 'ok' && red.plan.exercises.some((e) => e.exerciseId === 'barbell_back_squat')).toBe(false);
  });
});

describe('SAF-12: the S7 age gate uses the user’s local date (the earlier of local and UTC)', () => {
  const sixteenOn = { year: 2010, month: 9, day: 24 };
  // 2026-09-24 02:00 UTC is still 2026-09-23 16:00 in UTC−10.
  const utcBirthday = Date.parse('2026-09-24T02:00:00.000Z');

  it('west of UTC: blocked until the local birthday, even though the UTC date is already the birthday', () => {
    expect(gen(input({ birthDate: sixteenOn, localDate: { year: 2026, month: 9, day: 23 } }), utcBirthday)).toEqual({ status: 'unavailable', reasonCodes: ['session.unavailable.s7_age'] });
    expect(gen(input({ birthDate: sixteenOn, localDate: { year: 2026, month: 9, day: 24 } }), utcBirthday).status).toBe('ok');
  });

  it('east of UTC: the earlier UTC date counts (strict), and an unknown local date assumes the day before (fail closed)', () => {
    // 2026-09-23 20:00 UTC is 2026-09-24 in UTC+8: still blocked (the UTC date is the 23rd).
    expect(gen(input({ birthDate: sixteenOn, localDate: { year: 2026, month: 9, day: 24 } }), Date.parse('2026-09-23T20:00:00.000Z'))).toEqual({ status: 'unavailable', reasonCodes: ['session.unavailable.s7_age'] });
    expect(gen(input({ birthDate: sixteenOn, localDate: null }), utcBirthday)).toEqual({ status: 'unavailable', reasonCodes: ['session.unavailable.s7_age'] });
    expect(gen(input({ birthDate: sixteenOn, localDate: null }), Date.parse('2026-09-25T02:00:00.000Z')).status).toBe('ok');
  });

  it('a local date more than a day from the engine clock, or not a real date, is refused (clock mismatch)', () => {
    const now = Date.parse('2026-09-24T08:00:00.000Z');
    for (const localDate of [{ year: 2026, month: 9, day: 26 }, { year: 2026, month: 9, day: 22 }, { year: 2027, month: 9, day: 24 }, { year: 2026, month: 2, day: 30 }]) {
      expect(gen(input({ localDate }), now)).toEqual({ status: 'unavailable', reasonCodes: ['session.unavailable.clock_mismatch'] });
    }
    expect(ageGateDate({ year: 2026, month: 9, day: 25 }, now)).toEqual({ year: 2026, month: 9, day: 24 });
    expect(ageGateDate({ year: 2026, month: 9, day: 23 }, now)).toEqual({ year: 2026, month: 9, day: 23 });
    expect(ageGateDate(null, now)).toEqual({ year: 2026, month: 9, day: 23 });
  });
});
