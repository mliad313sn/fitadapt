import { describe, expect, it } from 'vitest';
import { IsoDateSchema, ProgramSlotSchema, ReflowOutcomeSchema, ReflowRecordSchema, ScheduledDeloadSchema, MesocycleSchema } from './index.js';

describe('M08 contracts', () => {
  it('calendar dates are real YYYY-MM-DD dates', () => {
    for (const ok of ['2026-09-28', '2028-02-29', '2026-12-31']) expect(IsoDateSchema.safeParse(ok).success, ok).toBe(true);
    for (const bad of ['2026-02-29', '2026-13-01', '2026-9-28', '2026-09-31', 'monday']) expect(IsoDateSchema.safeParse(bad).success, bad).toBe(false);
  });

  it('a mesocycle lasts 4 to 6 weeks (spec)', () => {
    const m = { index: 1, intent: 'hypertrophy', startDate: '2026-09-28', endDate: '2026-11-01', weeks: 5, deloadWeek: 5 };
    expect(MesocycleSchema.safeParse(m).success).toBe(true);
    expect(MesocycleSchema.safeParse({ ...m, weeks: 3 }).success).toBe(false);
    expect(MesocycleSchema.safeParse({ ...m, weeks: 7 }).success).toBe(false);
  });

  it('slots always have hard sets; reflow outcomes are shift, merge or skip', () => {
    expect(ProgramSlotSchema.safeParse({ pattern: 'squat', role: 'primary', intent: 'strength', hardSets: 0 }).success).toBe(false);
    expect(ReflowOutcomeSchema.safeParse({ kind: 'shifted', toDate: '2026-10-03' }).success).toBe(true);
    expect(ReflowOutcomeSchema.safeParse({ kind: 'merged', intoSessionId: 'w01.s2', patterns: [] }).success).toBe(false);
    expect(ReflowOutcomeSchema.safeParse({ kind: 'postponed' }).success).toBe(false);
    const record = { programId: '11111111-1111-4111-8111-111111111111', sessionId: 'w01.s3', reportedOn: '2026-10-02', outcome: { kind: 'skipped' }, engineVersion: '0.1.0', decidedAt: '2026-10-02T18:00:00.000Z', reasonCodes: ['program.reflow.skipped'] };
    expect(ReflowRecordSchema.safeParse(record).success).toBe(true);
    expect(ReflowRecordSchema.safeParse({ ...record, sessionId: 'friday' }).success).toBe(false);
    expect(ScheduledDeloadSchema.safeParse({ week: 5, mesocycle: 1, startDate: '2026-10-26', endDate: '2026-11-01', volumeFactor: 0.5, trigger: 'scheduled' }).success).toBe(true);
  });
});
