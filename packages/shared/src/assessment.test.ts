import { describe, expect, it } from 'vitest';
import { AssessmentResultSchema, AssessmentTestResultSchema, ReasonCodeSchema } from './index.js';

describe('M07 contracts', () => {
  it('reason codes are dotted, lower-case codes', () => {
    for (const ok of ['assessment.mapping.in_range', 'session.slot_dropped.core', 'a.b']) expect(ReasonCodeSchema.safeParse(ok).success, ok).toBe(true);
    for (const bad of ['nodot', 'Assessment.x', 'a..b', 'a.b.', '.a.b', '']) expect(ReasonCodeSchema.safeParse(bad).success, bad).toBe(false);
  });

  it('an assessment never records a stop closer to failure than RIR 2', () => {
    const base = { protocolId: 'home', protocolVersion: 1, startedAt: '2026-09-23T10:00:00.000Z', completedAt: '2026-09-23T10:10:00.000Z', tests: [{ status: 'skipped', testId: 'push_reps', reason: 'user_choice' }] };
    expect(AssessmentResultSchema.safeParse({ ...base, stopRir: 2 }).success).toBe(true);
    expect(AssessmentResultSchema.safeParse({ ...base, stopRir: 1 }).success).toBe(false);
    expect(AssessmentResultSchema.safeParse({ ...base, stopRir: 0 }).success).toBe(false);
  });

  it('bounds typed results (typing errors, not performance norms)', () => {
    const done = { status: 'done', testId: 'push_reps', exerciseId: 'push_up', reps: 12, seconds: null, loadKg: null, rir: null };
    expect(AssessmentTestResultSchema.safeParse(done).success).toBe(true);
    expect(AssessmentTestResultSchema.safeParse({ ...done, reps: -1 }).success).toBe(false);
    expect(AssessmentTestResultSchema.safeParse({ ...done, reps: 1.5 }).success).toBe(false);
    expect(AssessmentTestResultSchema.safeParse({ ...done, loadKg: 501 }).success).toBe(false);
    expect(AssessmentTestResultSchema.safeParse({ status: 'skipped', testId: 'push_reps', reason: 'bored' }).success).toBe(false);
  });
});
