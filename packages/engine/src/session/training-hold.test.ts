import { trainingHoldFlags } from '@fitadapt/safety';
import type { AssessmentResult, ScreeningQuestionId } from '@fitadapt/shared';
import { describe, expect, it } from 'vitest';
import { FIXTURE_EXERCISES, FIXTURE_LIBRARY, FULL_GYM, SAFE_FACTS, profileFrom } from '../__fixtures__/library.js';
import { PROGRAM_LIBRARY, programInput } from '../__fixtures__/program.js';
import { ASSESSMENT_PROTOCOLS, buildAssessmentPlan, buildCapacityModel } from '../assessment/index.js';
import { fixedClock } from '../clock.js';
import { createEngineContext } from '../context.js';
import { generateProgram } from '../program/generate.js';
import { generateSession } from './first-session.js';

/**
 * FIX-B (CS-1, A1/A2 pre-review M01-02/03/04/07, M07-44): a symptom flag, or
 * a professional's advice to limit activity, holds ALL training until the
 * clearance is attested — stricter than the S1 caps. The engine reads the
 * hold from its inputs only (the SafetyProfile and packages/safety's
 * screeningGateCheck); no engine rule changed. Fictional data only.
 */
const NOW = Date.parse('2026-09-24T08:00:00.000Z');
const ctx = () => createEngineContext({ clock: fixedClock(NOW), seed: 7 });
const HELD: readonly ScreeningQuestionId[] = ['chest_discomfort', 'fainting_or_dizziness', 'unusual_breathlessness', 'advised_to_limit_activity'];
const done = (testId: string, exerciseId: string, m: { reps?: number; seconds?: number; loadKg?: number; rir?: number }) => ({ status: 'done' as const, testId, exerciseId, reps: m.reps ?? null, seconds: m.seconds ?? null, loadKg: m.loadKg ?? null, rir: m.rir ?? null });
const result: AssessmentResult = {
  protocolId: 'gym',
  protocolVersion: 1,
  stopRir: 2,
  startedAt: '2026-09-23T17:00:00.000Z',
  completedAt: '2026-09-23T17:30:00.000Z',
  tests: [
    done('squat_load', 'barbell_back_squat', { loadKg: 100, reps: 8, rir: 2 }),
    done('press_load', 'barbell_bench_press', { loadKg: 60, reps: 8, rir: 2 }),
    done('pulldown_load', 'lat_pulldown', { loadKg: 50, reps: 10, rir: 2 }),
    done('row_load', 'barbell_row', { loadKg: 50, reps: 8, rir: 2 }),
    done('hinge_load', 'barbell_romanian_deadlift', { loadKg: 80, reps: 8, rir: 2 }),
    done('plank_hold', 'front_plank', { seconds: 45 }),
  ],
};
const capacity = buildCapacityModel(result, FIXTURE_LIBRARY);
const exercises = new Map(FIXTURE_EXERCISES.map((e) => [e.id, e]));
// FIX-A (SAF-1…12): the assessment's safety facts are required inputs (fail closed).
const ASSESS_FACTS = { jointFlags: {}, intensityLock: { locked: false, since: null }, birthDate: null, localDate: null, nowMs: NOW } as const;

describe('FIX-B (CS-1): a holding flag without clearance → no session, no assessment, no program', () => {
  it.each(HELD)('%s: every generator refuses; the same answers with an attested clearance are served', (flag) => {
    const held = profileFrom([flag]);
    const cleared = profileFrom([flag], { clearanceAttested: true });
    expect(trainingHoldFlags(held)).toEqual([flag]);

    for (const mode of [undefined, 'cardio', 'mobility_balance'] as const) {
      const r = generateSession({ ...SAFE_FACTS, capacity, safetyProfile: held, equipment: FULL_GYM, minutesAvailable: 45, ...(mode ? { mode } : {}) }, FIXTURE_LIBRARY, ctx());
      expect(r.status).toBe('unavailable');
    }
    expect(generateSession({ ...SAFE_FACTS, capacity, safetyProfile: cleared, equipment: FULL_GYM, minutesAvailable: 45 }, FIXTURE_LIBRARY, ctx()).status).toBe('ok');

    for (const protocol of Object.values(ASSESSMENT_PROTOCOLS)) {
      expect(buildAssessmentPlan(protocol, { ...ASSESS_FACTS, safetyProfile: held, equipment: FULL_GYM, exercises })).toMatchObject({ status: 'unavailable' });
    }
    expect(buildAssessmentPlan(ASSESSMENT_PROTOCOLS.gym, { ...ASSESS_FACTS, safetyProfile: cleared, equipment: FULL_GYM, exercises }).status).toBe('available');

    expect(generateProgram(programInput({ profile: held }), PROGRAM_LIBRARY, ctx()).status).toBe('unavailable');
    expect(generateProgram(programInput({ profile: cleared }), PROGRAM_LIBRARY, ctx()).status).toBe('ok');
  });

  it('a tampered held profile (automatic programming switched back on) is still refused by the S1 gate the generators call', () => {
    const tampered = { ...profileFrom(['chest_discomfort']), automaticProgrammingAllowed: true, maxRPE: 10, allowHIIT: true, allowMaxTests: true, screeningOutcome: 'cleared' as const };
    expect(generateSession({ ...SAFE_FACTS, capacity, safetyProfile: tampered, equipment: FULL_GYM, minutesAvailable: 45 }, FIXTURE_LIBRARY, ctx()).status).toBe('unavailable');
    expect(buildAssessmentPlan(ASSESSMENT_PROTOCOLS.gym, { ...ASSESS_FACTS, safetyProfile: tampered, equipment: FULL_GYM, exercises }).status).toBe('unavailable');
    expect(generateProgram(programInput({ profile: tampered }), PROGRAM_LIBRARY, ctx()).status).toBe('unavailable');
  });
});
