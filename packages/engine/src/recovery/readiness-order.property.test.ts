import type { ExecutionLog, ReadinessCheck } from '@fitadapt/shared';
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { deloadStatus } from './deload.js';
import { painReportsFrom, safetyStopsFrom } from './facts.js';
import { readinessCheckOn, readinessFromCheck, readinessHeadsOn, readinessLevelOn } from './readiness.js';

// Property runs are CPU-bound; the whole workspace runs in parallel (fresh-clone gate): no 5 s default.
vi.setConfig({ testTimeout: 120_000 });

/**
 * FIX-latest-record-ordering (ADR-023): the readiness check that counts for a
 * day follows the chain of checks, never the device clock or the arrival
 * order; ambiguity fails closed (the lowest readiness). Fictional data.
 */

const DAY = '2026-09-28';
const BASE = Date.parse(`${DAY}T07:00:00.000Z`);
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const LOW = { sleep: 1, soreness: 5, stress: 5, energy: 1 } as const;
const GOOD = { sleep: 5, soreness: 1, stress: 1, energy: 5 } as const;
const base = (answers: typeof LOW | typeof GOOD, clock: number): ReadinessCheck => ({ schemaVersion: 1, date: DAY, at: new Date(BASE + clock).toISOString(), ...answers, wearable: null });

/** One device re-checking during the day: each check names the heads of the day (what the device store does). */
function writeDay(steps: readonly { low: boolean; clock: number }[], firstId = 1, start: ReadinessCheck[] = []): ReadinessCheck[] {
  const out = [...start];
  steps.forEach((s, i) => out.push({ ...base(s.low ? LOW : GOOD, s.clock), checkId: uuid(firstId + i), supersedes: readinessHeadsOn(out, DAY) }));
  return out.slice(start.length);
}
const arbSteps = fc.array(fc.record({ low: fc.boolean(), clock: fc.integer({ min: -3, max: 3 }).map((m) => m * 60_000) }), { minLength: 1, maxLength: 6 });
const shuffle = <T>(list: readonly T[], seeds: fc.Stream<number>) => list.map((x) => ({ x, k: seeds.next().value })).sort((a, b) => a.k - b.k).map((y) => y.x);

describe('readiness: the check made last that day counts (ADR-023)', () => {
  it('linked checks, any timestamps, any order → the check written last', () => {
    fc.assert(
      fc.property(arbSteps, fc.infiniteStream(fc.nat()), (steps, seeds) => {
        const checks = writeDay(steps);
        const truth = steps.at(-1)!.low ? 'reduced' : 'normal';
        expect(readinessLevelOn(shuffle(checks, seeds), DAY)).toBe(truth);
        expect(readinessCheckOn(checks, DAY)).toBe(checks.at(-1));
      }),
      { numRuns: 1000 },
    );
  });

  it('two devices checking without knowing each other: reduced if either says so', () => {
    fc.assert(
      fc.property(arbSteps, arbSteps, fc.infiniteStream(fc.nat()), (onA, onB, seeds) => {
        const a = writeDay(onA, 1);
        const b = writeDay(onB, 100);
        const level = readinessLevelOn(shuffle([...a, ...b], seeds), DAY);
        expect(level).toBe(onA.at(-1)!.low || onB.at(-1)!.low ? 'reduced' : 'normal');
      }),
      { numRuns: 1000 },
    );
  });

  it('checks stored before links keep "the last recorded"; other days and no check are unaffected', () => {
    const legacy = [base(LOW, 0), base(GOOD, -60_000)];
    expect(readinessLevelOn(legacy, DAY)).toBe('normal');
    expect(readinessLevelOn([...legacy].reverse(), DAY)).toBe('reduced');
    expect(readinessCheckOn(legacy, '2026-09-29')).toBeNull();
    expect(readinessHeadsOn(legacy, DAY)).toEqual([]);
    // A linked check cannot name an unlinked one: both are candidates, the lower readiness counts (fail closed).
    const next = { ...base(GOOD, 60_000), checkId: uuid(9), supersedes: [] };
    expect(readinessLevelOn([...legacy.slice(0, 1), next], DAY)).toBe('reduced');
    expect(readinessFromCheck(readinessCheckOn([next, ...legacy.slice(0, 1)], DAY)!).level).toBe('reduced');
  });

  it('the low-readiness deload reads the same check per day', () => {
    const days = ['2026-09-28', '2026-09-29', '2026-09-30'];
    const checks: ReadinessCheck[] = days.flatMap((date, d) => {
      const low = { ...base(LOW, 0), date, at: `${date}T07:00:00.000Z`, checkId: uuid(10 + d), supersedes: [] };
      // A later "good" re-check dated BEFORE the low one (clock moved back), naming it: the good one counts.
      const good = { ...base(GOOD, 0), date, at: `${date}T06:00:00.000Z`, checkId: uuid(20 + d), supersedes: [uuid(10 + d)] };
      return [good, low];
    });
    expect(deloadStatus({ asOfMs: Date.parse('2026-10-01T08:00:00.000Z'), painReports: [], safetyStops: [], history: [], readinessChecks: checks })).toBeNull();
    const lows = checks.filter((c) => c.sleep === 1);
    expect(deloadStatus({ asOfMs: Date.parse('2026-10-01T08:00:00.000Z'), painReports: [], safetyStops: [], history: [], readinessChecks: lows })?.trigger).toBe('low_readiness');
  });
});

describe('facts carry the ADR-023 links to packages/safety', () => {
  it('pain reports keep their id and `after`; red flags their id; attestations what they attest', () => {
    const logs: ExecutionLog[] = [
      { kind: 'pain', planId: null, joint: 'knee', score: 7, at: '2026-09-28T07:00:00.000Z', eventId: uuid(1), after: [] },
      { kind: 'pain', planId: null, joint: 'knee', score: 2, at: '2026-09-28T08:00:00.000Z' },
      { kind: 'red_flag', planId: null, symptom: 'fainting', at: '2026-09-28T07:00:00.000Z', eventId: uuid(2) },
      { kind: 'red_flag', planId: null, symptom: 'fainting', at: '2026-09-28T07:30:00.000Z' },
      { kind: 'medical_review_attested', at: '2026-09-28T09:00:00.000Z', attests: [uuid(2)] },
      { kind: 'medical_review_attested', at: '2026-09-28T09:30:00.000Z' },
    ];
    expect(painReportsFrom(logs)).toEqual([
      { joint: 'knee', score: 7, at: '2026-09-28T07:00:00.000Z', phase: 'during', sessionId: null, id: uuid(1), after: [] },
      { joint: 'knee', score: 2, at: '2026-09-28T08:00:00.000Z', phase: 'during', sessionId: null },
    ]);
    expect(safetyStopsFrom(logs)).toEqual([
      { kind: 'red_flag', at: '2026-09-28T07:00:00.000Z', id: uuid(2) },
      { kind: 'red_flag', at: '2026-09-28T07:30:00.000Z' },
      { kind: 'medical_review_attested', at: '2026-09-28T09:00:00.000Z', attests: [uuid(2)] },
      { kind: 'medical_review_attested', at: '2026-09-28T09:30:00.000Z' },
    ]);
  });
});
