import type { PainReport, SafetyStopEvent } from '@fitadapt/safety';
import type { HistoryExercise, ReadinessCheck, SessionHistoryEntry, SessionPlan } from '@fitadapt/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SAFE_FACTS, FULL_GYM, profileFrom } from '../__fixtures__/library.js';
import { GYM_CAPACITY, RECOVERY_LIBRARY } from '../__fixtures__/recovery.js';
import { GYM_ID, GYM_LOADS, programContext } from '../__fixtures__/session.js';
import { fixedClock } from '../clock.js';
import { createEngineContext } from '../context.js';
import { generateSession } from '../session/generate.js';
import { buildSessionHistory } from '../session/history.js';
import type { WorkExercise } from '../session/timebox.js';
import type { GenerateSessionInput } from '../session/types.js';
import { RECOVERY_CONFIG } from './config.js';
import { applyTriggeredDeload, deloadStatus, performanceDropped, type DeloadFacts } from './deload.js';

const T0 = Date.parse('2026-10-01T08:00:00.000Z');
const DAY = 86_400_000;
const at = (ms: number) => new Date(ms).toISOString();
const none: DeloadFacts = { asOfMs: T0, painReports: [], safetyStops: [], history: [], readinessChecks: [] };
const pain = (day: number, score: number, extra: Partial<PainReport> = {}): PainReport => ({ joint: 'knee', score, at: at(T0 + day * DAY), sessionId: `s${day}`, ...extra });
const check = (date: string, low: boolean): ReadinessCheck => ({ schemaVersion: 1, date, at: `${date}T07:00:00.000Z`, sleep: low ? 1 : 5, soreness: low ? 5 : 1, stress: low ? 5 : 1, energy: low ? 1 : 5, wearable: null });

function entry(day: number, perf: { id: string; load: number | null; reps: number }[], counts = true): SessionHistoryEntry {
  const exercises: HistoryExercise[] = perf.map((p) => ({
    slot: 'squat',
    role: 'primary',
    exerciseId: p.id,
    ladderId: null,
    target: { kind: 'reps', min: 6, max: 10 },
    targetRir: 2,
    prescribedLoadKg: p.load,
    performed: [1, 2, 3].map((index) => ({ index, status: 'done' as const, reps: p.reps, seconds: null, loadKg: p.load, rir: 2 })),
  }));
  return { planId: `00000000-0000-4000-8000-${String(day + 100).padStart(12, '0')}`, prescribedAt: at(T0 + day * DAY), startedAt: at(T0 + day * DAY + 60_000), countsForProgression: counts, exercises };
}

describe('M05 triggered deloads: each trigger in the spec (goal condition 3)', () => {
  it('nothing happened → no triggered deload', () => {
    expect(deloadStatus(none)).toBeNull();
  });

  it('two amber weeks: amber (or red) pain in two different weeks, 7–14 days apart', () => {
    const facts = (reports: PainReport[], asOf: number): DeloadFacts => ({ ...none, painReports: reports, asOfMs: asOf });
    expect(deloadStatus(facts([pain(0, 4), pain(8, 5)], T0 + 8 * DAY))).toEqual({ trigger: 'amber_weeks', since: at(T0 + 8 * DAY), until: at(T0 + 15 * DAY) });
    expect(deloadStatus(facts([pain(0, 7), pain(7, 4, { joint: 'shoulder' })], T0 + 9 * DAY))?.trigger).toBe('amber_weeks');
    // One week only, reports too close, or too far apart: no trigger.
    expect(deloadStatus(facts([pain(0, 4), pain(3, 5)], T0 + 5 * DAY))).toBeNull();
    expect(deloadStatus(facts([pain(0, 4), pain(20, 5)], T0 + 20 * DAY))).toBeNull();
    // Green reports do not count.
    expect(deloadStatus(facts([pain(0, 3), pain(8, 2)], T0 + 8 * DAY))).toBeNull();
    // A next-morning "not settled" counts as red.
    expect(deloadStatus(facts([pain(0, 4), pain(9, 1, { phase: 'next_morning', settled: false, sessionId: null })], T0 + 9 * DAY))?.trigger).toBe('amber_weeks');
    // It lasts 7 days, then only what happens after it counts (no re-trigger on the same data).
    expect(deloadStatus(facts([pain(0, 4), pain(8, 5)], T0 + 15 * DAY))).toBeNull();
    expect(deloadStatus(facts([pain(0, 4), pain(8, 5), pain(16, 4), pain(24, 4)], T0 + 24 * DAY))).toEqual({ trigger: 'amber_weeks', since: at(T0 + 24 * DAY), until: at(T0 + 31 * DAY) });
  });

  it('a red flag: from the flag until 7 days after the medical review is attested', () => {
    const flag: SafetyStopEvent = { kind: 'red_flag', at: at(T0) };
    const attest: SafetyStopEvent = { kind: 'medical_review_attested', at: at(T0 + 3 * DAY) };
    expect(deloadStatus({ ...none, safetyStops: [flag], asOfMs: T0 + 30 * DAY })).toEqual({ trigger: 'red_flag', since: at(T0), until: null });
    expect(deloadStatus({ ...none, safetyStops: [flag, attest], asOfMs: T0 + 5 * DAY })).toEqual({ trigger: 'red_flag', since: at(T0), until: at(T0 + 10 * DAY) });
    expect(deloadStatus({ ...none, safetyStops: [flag, attest], asOfMs: T0 + 10 * DAY })).toBeNull();
    // An attestation dated before the flag does not start the countdown (fail closed).
    expect(deloadStatus({ ...none, safetyStops: [flag, { kind: 'medical_review_attested', at: at(T0 - DAY) }], asOfMs: T0 + 30 * DAY })?.until).toBeNull();
    // Unreadable dates are ignored for triggers (the S3 lock itself fails closed).
    expect(deloadStatus({ ...none, safetyStops: [{ kind: 'red_flag', at: 'nope' }], asOfMs: T0 })).toBeNull();
  });

  it('a performance drop two sessions running (most shared exercises > 5 % below their previous best set)', () => {
    const base = entry(0, [{ id: 'barbell_back_squat', load: 100, reps: 8 }, { id: 'push_up', load: null, reps: 12 }]);
    const down1 = entry(2, [{ id: 'barbell_back_squat', load: 90, reps: 8 }, { id: 'push_up', load: null, reps: 10 }]);
    const down2 = entry(4, [{ id: 'barbell_back_squat', load: 85, reps: 8 }, { id: 'push_up', load: null, reps: 9 }]);
    const up = entry(4, [{ id: 'barbell_back_squat', load: 100, reps: 9 }, { id: 'push_up', load: null, reps: 12 }]);
    expect(performanceDropped([base, down1], 1)).toBe(true);
    expect(performanceDropped([base], 0)).toBe(false);
    expect(deloadStatus({ ...none, history: [base, down1], asOfMs: T0 + 3 * DAY })).toBeNull();
    expect(deloadStatus({ ...none, history: [base, down1, down2], asOfMs: T0 + 5 * DAY })).toEqual({ trigger: 'performance_drop', since: down2.startedAt, until: at(Date.parse(down2.startedAt) + 7 * DAY) });
    expect(deloadStatus({ ...none, history: [base, down1, up], asOfMs: T0 + 5 * DAY })).toBeNull();
    // Deload and transition sessions are not compared.
    expect(deloadStatus({ ...none, history: [base, down1, { ...down2, countsForProgression: false }], asOfMs: T0 + 5 * DAY })).toBeNull();
    // Holds compare seconds; a small dip (≤ 5 %) is not a drop.
    const hold = (day: number, seconds: number): SessionHistoryEntry => ({ ...entry(day, []), exercises: [{ slot: 'core', role: 'accessory', exerciseId: 'front_plank', ladderId: null, target: { kind: 'hold', seconds: 30 }, targetRir: 2, prescribedLoadKg: null, performed: [{ index: 1, status: 'done', reps: null, seconds, loadKg: null, rir: null }] }] });
    expect(performanceDropped([hold(0, 40), hold(2, 39)], 1)).toBe(false);
    expect(performanceDropped([hold(0, 40), hold(2, 30)], 1)).toBe(true);
    expect(performanceDropped([hold(0, 40), { ...hold(2, 30), exercises: [{ ...hold(2, 30).exercises[0]!, performed: [{ index: 1, status: 'skipped', reps: null, seconds: null, loadKg: null, rir: null }] }] }], 1)).toBe(false);
  });

  it('SAF-11: the readiness chain is resolved over every check before the cursor filter (a superseded check never counts again)', () => {
    const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    // A first deload (Oct 1–3 low) ends on Oct 10 07:00: the cursor.
    const first = [check('2026-10-01', true), check('2026-10-02', true), check('2026-10-03', true)];
    const a13 = { ...check('2026-10-13', true), checkId: id(1), supersedes: [] };
    // B replaces A (the user corrected the check) but its time is before the cursor (the clock was moved back).
    const b13 = { ...check('2026-10-13', false), checkId: id(2), supersedes: [id(1)], at: '2026-10-09T07:00:00.000Z' };
    const readinessChecks = [...first, check('2026-10-11', true), check('2026-10-12', true), a13, b13];
    expect(deloadStatus({ ...none, readinessChecks, asOfMs: Date.parse('2026-10-14T09:00:00.000Z') })).toBeNull();
    // Without the correction, A counts: three low days after the cursor.
    expect(deloadStatus({ ...none, readinessChecks: readinessChecks.slice(0, -1), asOfMs: Date.parse('2026-10-14T09:00:00.000Z') })).toMatchObject({ trigger: 'low_readiness', since: '2026-10-13T07:00:00.000Z' });
  });

  it('low readiness three days running', () => {
    const three = [check('2026-10-01', true), check('2026-10-02', true), check('2026-10-03', true)];
    expect(deloadStatus({ ...none, readinessChecks: three, asOfMs: Date.parse('2026-10-03T09:00:00.000Z') })).toEqual({ trigger: 'low_readiness', since: '2026-10-03T07:00:00.000Z', until: '2026-10-10T07:00:00.000Z' });
    // A gap day, a good day in between, or only two days: no trigger.
    expect(deloadStatus({ ...none, readinessChecks: [three[0]!, three[1]!, check('2026-10-04', true)], asOfMs: Date.parse('2026-10-04T09:00:00.000Z') })).toBeNull();
    expect(deloadStatus({ ...none, readinessChecks: [three[0]!, check('2026-10-02', false), three[2]!], asOfMs: Date.parse('2026-10-03T09:00:00.000Z') })).toBeNull();
    expect(deloadStatus({ ...none, readinessChecks: three.slice(0, 2), asOfMs: Date.parse('2026-10-03T09:00:00.000Z') })).toBeNull();
    // The latest check of a day counts (a second, better check that day breaks the run).
    expect(deloadStatus({ ...none, readinessChecks: [...three.slice(0, 2), three[2]!, { ...check('2026-10-03', false), at: '2026-10-03T08:00:00.000Z' }], asOfMs: Date.parse('2026-10-03T09:00:00.000Z') })).toBeNull();
  });

  it('the earliest trigger wins, and the clock decides whether it is still in force', () => {
    const facts: DeloadFacts = { ...none, painReports: [pain(0, 4), pain(8, 4)], safetyStops: [{ kind: 'red_flag', at: at(T0 + 2 * DAY) }, { kind: 'medical_review_attested', at: at(T0 + 3 * DAY) }] };
    expect(deloadStatus({ ...facts, asOfMs: T0 + 4 * DAY })?.trigger).toBe('red_flag');
    expect(deloadStatus({ ...facts, asOfMs: T0 + 1 * DAY })).toBeNull();
    expect(deloadStatus({ ...facts, asOfMs: T0 + 11 * DAY })).toBeNull(); // amber week 2 fell inside the red-flag deload
  });
});

// ------------------------------------------------------------------ the prescription

const MON = Date.parse('2026-09-28T08:00:00.000Z');
const gym = (over: Partial<GenerateSessionInput> = {}): GenerateSessionInput => ({ ...SAFE_FACTS,
  safetyProfile: profileFrom(),
  equipment: [...FULL_GYM, 'cable_station'],
  equipmentLoads: GYM_LOADS,
  equipmentProfileId: GYM_ID,
  minutesAvailable: 240,
  programSession: programContext(),
  capacity: GYM_CAPACITY,
  experience: 'intermediate',
  ...over,
});
const run = (input: GenerateSessionInput): SessionPlan => {
  const r = generateSession(input, RECOVERY_LIBRARY, createEngineContext({ clock: fixedClock(MON), seed: 9 }));
  if (r.status !== 'ok') throw new Error(r.reasonCodes.join());
  return r.plan;
};
const sets = (p: SessionPlan) => p.exercises.reduce((s, e) => s + e.sets.length, 0);
const trigger = { trigger: 'amber_weeks' as const, since: at(MON - DAY), until: at(MON + 6 * DAY) };

describe('M05 triggered deload in generateSession: volume −40–50 %, no progression', () => {
  it('cuts the session’s sets by 40–50 %, keeps every exercise it can, explains it, and never adds load', () => {
    const normal = run(gym());
    const deload = run(gym({ deload: trigger }));
    const reduction = 1 - sets(deload) / sets(normal);
    expect(sets(normal)).toBe(15);
    expect(reduction).toBeGreaterThanOrEqual(0.4);
    expect(reduction).toBeLessThanOrEqual(0.5);
    expect(deload.reasonCodes).toEqual(expect.arrayContaining(['session.deload.triggered.amber_weeks', 'session.deload.volume_reduced']));
    for (const e of deload.exercises) {
      const before = normal.exercises.find((x) => x.exerciseId === e.exerciseId)!;
      expect(e.sets.length).toBeLessThanOrEqual(before.sets.length);
      for (const s of e.sets) {
        expect(s.reasonCodes).toContain('session.deload.sets_reduced');
        expect(s.loadKg ?? 0).toBeLessThanOrEqual(before.sets[0]!.loadKg ?? 0);
      }
    }
    expect(deload.exercises.map((e) => e.exerciseId)).toEqual(normal.exercises.map((e) => e.exerciseId));
  });

  it('every trigger reduces the same way; in a scheduled deload week it does not stack', () => {
    for (const t of ['red_flag', 'performance_drop', 'low_readiness'] as const) {
      const p = run(gym({ deload: { ...trigger, trigger: t } }));
      expect(p.reasonCodes).toContain(`session.deload.triggered.${t}`);
      expect(sets(p)).toBe(8);
    }
    const week = run(gym({ programSession: programContext({ kind: 'deload', targetRpe: 6 }) }));
    const both = run(gym({ programSession: programContext({ kind: 'deload', targetRpe: 6 }), deload: trigger }));
    expect(sets(both)).toBe(sets(week));
    expect(both.reasonCodes).toContain('session.deload.in_deload_week');
    expect(both.reasonCodes).not.toContain('session.deload.volume_reduced');
  });

  it('a triggered-deload session does not count toward progression', () => {
    const p = run(gym({ deload: trigger }));
    const history = buildSessionHistory([{ schemaVersion: 1, input: gym({ deload: trigger }) as never, plan: p, safetyEvents: [], startedAt: at(MON + 60_000), jurisdiction: 'GB', firstWorkout: false }], [], []);
    expect(history[0]!.countsForProgression).toBe(false);
  });

  it('property: over random sessions, a triggered deload keeps ≥ 50 % of the sets, removes ≥ 40 % from 5 sets up, keeps ≥ 1 set per kept exercise and never more than before', () => {
    const patterns = ['squat', 'hinge', 'lunge', 'horizontal_push', 'vertical_push', 'horizontal_pull', 'vertical_pull', 'core', 'isolation'] as const;
    fc.assert(
      fc.property(
        fc.array(fc.record({ pattern: fc.constantFrom(...patterns), role: fc.constantFrom('primary' as const, 'secondary' as const, 'accessory' as const), sets: fc.integer({ min: 1, max: 6 }) }), { minLength: 1, maxLength: 8 }),
        (raw) => {
          const work: WorkExercise[] = raw.map((r, i) => ({
            exercise: { slot: r.pattern, role: r.role, exerciseId: `ex_${i}`, ladderId: null, supersetGroup: null, reasonCodes: ['session.exercise.from_program'], sets: Array.from({ length: r.sets }, (_, k) => ({ index: k + 1, target: { kind: 'reps', min: 8, max: 12 }, loadKg: null, targetRir: 3, restSeconds: 60, tempo: null, reasonCodes: ['session.rir.target'], reasonParams: {} })) },
            pattern: r.pattern,
            role: r.role,
            intent: 'general',
            sets: r.sets,
            partner: null,
            dropped: false,
          }));
          const before = work.reduce((s, w) => s + w.sets, 0);
          const out = applyTriggeredDeload(work);
          const after = out.reduce((s, w) => s + w.sets, 0);
          expect(after).toBeGreaterThanOrEqual(Math.min(before, Math.ceil(before * (1 - RECOVERY_CONFIG['deload.volumeReduction'].value))));
          expect(after).toBeLessThanOrEqual(Math.max(1, Math.ceil(before * 0.5)) + raw.filter((r) => r.role === 'primary').length);
          // Sets are only left while every exercise is down to one set and the rest cannot go (the first exercise and primaries stay);
          // otherwise, from 5 sets up, at least 40 % went.
          if (before >= 5 && out.some((w) => w.sets > 1)) expect(1 - after / before).toBeGreaterThanOrEqual(0.4);
          expect(1 - after / before).toBeLessThanOrEqual(0.5);
          expect(out[0]?.exercise.exerciseId).toBe(work[0]!.exercise.exerciseId);
          for (const w of out) {
            expect(w.sets).toBeGreaterThanOrEqual(1);
            expect(w.exercise.sets).toHaveLength(w.sets);
            expect(w.sets).toBeLessThanOrEqual(work.find((x) => x.exercise.exerciseId === w.exercise.exerciseId)!.sets);
          }
        },
      ),
      { numRuns: 3000 },
    );
  });
});

describe('M05 scheduled deloads (M08) are the program’s deload weeks', () => {
  it('a deload week session is marked, holds progression and adds more reserve', () => {
    const week = run(gym({ programSession: programContext({ kind: 'deload', targetRpe: 6 }) }));
    expect(week.reasonCodes).toContain('session.program.deload_week');
    expect(week.targetRir).toBe(4);
  });
});

