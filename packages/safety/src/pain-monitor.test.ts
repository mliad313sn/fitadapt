import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  PAIN_CONFIG,
  S2_RED_PAIN_SCORE,
  classifyPainReport,
  intensityLockStatus,
  jointFlagsFromPain,
  painTrafficLight,
  physioRecommendations,
  type PainReport,
  type PainReportPhase,
} from './index.js';

const NOW = Date.parse('2026-10-01T08:00:00.000Z');
const DAY = 86_400_000;
const at = (ms: number) => new Date(ms).toISOString();
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

describe('M05 pain traffic light (goal condition 2)', () => {
  it('0–3 green, 4–5 amber, ≥ 6 red; the thresholds are the spec’s and the amber score is unvalidated config', () => {
    expect(PAIN_CONFIG.amberPainScore.value).toBe(4);
    expect(PAIN_CONFIG.amberPainScore.validated).toBe(false);
    expect(S2_RED_PAIN_SCORE).toBe(6);
    for (const score of [0, 1, 2, 3]) expect(classifyPainReport({ score })).toBe('green');
    for (const score of [4, 5]) expect(classifyPainReport({ score })).toBe('amber');
    for (const score of [6, 7, 8, 9, 10]) expect(classifyPainReport({ score })).toBe('red');
    expect(jointFlagsFromPain([{ joint: 'knee', score: 3, at: at(NOW) }])).toEqual({});
    expect(jointFlagsFromPain([{ joint: 'knee', score: 4, at: at(NOW) }])).toEqual({ knee: 'amber' });
    expect(jointFlagsFromPain([{ joint: 'knee', score: 5, at: at(NOW) }])).toEqual({ knee: 'amber' });
    expect(jointFlagsFromPain([{ joint: 'knee', score: 6, at: at(NOW) }])).toEqual({ knee: 'red' });
  });

  it('not settled by the next morning is red, whatever the score; a settled morning with a low score is not', () => {
    expect(classifyPainReport({ score: 1, phase: 'next_morning', settled: false })).toBe('red');
    expect(classifyPainReport({ score: 0, phase: 'next_morning', settled: false })).toBe('red');
    expect(classifyPainReport({ score: 2, phase: 'next_morning', settled: true })).toBe('green');
    expect(classifyPainReport({ score: 5, phase: 'next_morning', settled: true })).toBe('amber');
    // `settled` outside the next-morning check has no meaning.
    expect(classifyPainReport({ score: 2, phase: 'during', settled: false })).toBe('green');
    const s = painTrafficLight([
      { joint: 'knee', score: 4, at: at(NOW), phase: 'after_session', sessionId: A },
      { joint: 'knee', score: 2, at: at(NOW + 0.5 * DAY), phase: 'next_morning', settled: false, sessionId: null },
    ]);
    expect(s.knee).toMatchObject({ flag: 'red', redReason: 'not_settled', since: at(NOW) });
  });

  it('a red joint stays red for the next session: the same session, a next-morning check or an earlier date cannot clear it', () => {
    const red: PainReport = { joint: 'knee', score: 7, at: at(NOW), phase: 'during', sessionId: A };
    // Later in the same session, or in the check after it: still red.
    expect(jointFlagsFromPain([red, { joint: 'knee', score: 1, at: at(NOW + 60_000), phase: 'during', sessionId: A }])).toEqual({ knee: 'red' });
    expect(jointFlagsFromPain([red, { joint: 'knee', score: 1, at: at(NOW + 3_600_000), phase: 'after_session', sessionId: A }])).toEqual({ knee: 'red' });
    // The next morning feels fine: still red for the next session (S2 "in the next session").
    expect(jointFlagsFromPain([red, { joint: 'knee', score: 0, at: at(NOW + DAY), phase: 'next_morning', settled: true, sessionId: null }])).toEqual({ knee: 'red' });
    // A report from another session, dated after: back to its own colour.
    expect(jointFlagsFromPain([red, { joint: 'knee', score: 2, at: at(NOW + 2 * DAY), phase: 'after_session', sessionId: B }])).toEqual({});
    expect(jointFlagsFromPain([red, { joint: 'knee', score: 5, at: at(NOW + 2 * DAY), phase: 'during', sessionId: B }])).toEqual({ knee: 'amber' });
    // Clock moved back: a clearing report dated before the red one does not clear it.
    expect(jointFlagsFromPain([red, { joint: 'knee', score: 1, at: at(NOW - DAY), phase: 'during', sessionId: B }])).toEqual({ knee: 'red' });
    // Unreadable dates never clear.
    expect(jointFlagsFromPain([red, { joint: 'knee', score: 1, at: 'garbage', phase: 'during', sessionId: B }])).toEqual({ knee: 'red' });
    expect(jointFlagsFromPain([{ ...red, at: 'garbage' }, { joint: 'knee', score: 1, at: at(NOW + DAY), phase: 'during', sessionId: B }])).toEqual({ knee: 'red' });
    // A report outside any session cannot clear a red that a session set.
    expect(jointFlagsFromPain([red, { joint: 'knee', score: 1, at: at(NOW + DAY), phase: 'during', sessionId: null }])).toEqual({ knee: 'red' });
    // Two sessions rated it red: a later report from either one does not clear it; a third session does.
    const both = [red, { joint: 'knee' as const, score: 8, at: at(NOW + DAY), sessionId: B }];
    expect(jointFlagsFromPain([...both, { joint: 'knee', score: 1, at: at(NOW + 2 * DAY), sessionId: A }])).toEqual({ knee: 'red' });
    expect(jointFlagsFromPain([...both, { joint: 'knee', score: 1, at: at(NOW + 2 * DAY), sessionId: C }])).toEqual({});
    // The latest time of the red stretch counts (a second red dated earlier does not lower the bar).
    expect(jointFlagsFromPain([red, { joint: 'knee', score: 9, at: at(NOW - 5 * DAY), sessionId: B }, { joint: 'knee', score: 1, at: at(NOW - DAY), sessionId: C }])).toEqual({ knee: 'red' });
    // Joints are independent.
    expect(jointFlagsFromPain([red, { joint: 'shoulder', score: 4, at: at(NOW), sessionId: A }])).toEqual({ knee: 'red', shoulder: 'amber' });
  });

  it('keeps when the amber/red stretch started', () => {
    const s = painTrafficLight([
      { joint: 'hip', score: 2, at: at(NOW) },
      { joint: 'hip', score: 4, at: at(NOW + DAY), sessionId: A },
      { joint: 'hip', score: 7, at: at(NOW + 2 * DAY), sessionId: B },
      { joint: 'hip', score: 5, at: at(NOW + 3 * DAY), sessionId: C },
    ]);
    expect(s.hip).toEqual({ flag: 'amber', redReason: null, since: at(NOW + DAY), lastAt: at(NOW + 3 * DAY) });
    expect(painTrafficLight([{ joint: 'hip', score: 5, at: at(NOW) }, { joint: 'hip', score: 1, at: at(NOW + DAY) }]).hip).toMatchObject({ flag: 'green', since: null });
  });
});

describe('M05 persistence: amber or red for more than two weeks → physiotherapist (goal condition 6)', () => {
  it('recommends after more than 14 days of amber/red on the same joint, not before, and not across a green report', () => {
    expect(PAIN_CONFIG.persistenceDays.value).toBe(14);
    expect(PAIN_CONFIG.persistenceDays.validated).toBe(false);
    const reports: PainReport[] = [
      { joint: 'knee', score: 4, at: at(NOW), sessionId: A },
      { joint: 'knee', score: 5, at: at(NOW + 7 * DAY), sessionId: B },
      { joint: 'knee', score: 4, at: at(NOW + 14 * DAY), sessionId: C },
    ];
    expect(physioRecommendations(reports, NOW + 14 * DAY)).toEqual([]);
    expect(physioRecommendations(reports, NOW + 14 * DAY + 1)).toEqual([{ joint: 'knee', flag: 'amber', since: at(NOW), days: 14 }]);
    expect(physioRecommendations(reports, NOW + 20 * DAY)).toEqual([{ joint: 'knee', flag: 'amber', since: at(NOW), days: 20 }]);
    // A green report in between restarts the stretch.
    const broken = [...reports.slice(0, 2), { joint: 'knee' as const, score: 1, at: at(NOW + 8 * DAY), sessionId: C }, { joint: 'knee' as const, score: 4, at: at(NOW + 9 * DAY), sessionId: C }];
    expect(physioRecommendations(broken, NOW + 20 * DAY)).toEqual([]);
    expect(physioRecommendations(broken, NOW + 24 * DAY)).toHaveLength(1);
    // Red counts too (and mixed amber → red on the same joint is one stretch).
    const red = [{ joint: 'shoulder' as const, score: 4, at: at(NOW), sessionId: A }, { joint: 'shoulder' as const, score: 7, at: at(NOW + 10 * DAY), sessionId: B }];
    expect(physioRecommendations(red, NOW + 15 * DAY)).toEqual([{ joint: 'shoulder', flag: 'red', since: at(NOW), days: 15 }]);
    // Amber on two different joints for a week each is not "the same joint".
    expect(physioRecommendations([{ joint: 'knee', score: 4, at: at(NOW), sessionId: A }, { joint: 'knee', score: 1, at: at(NOW + 8 * DAY), sessionId: B }, { joint: 'hip', score: 4, at: at(NOW + 8 * DAY), sessionId: B }], NOW + 16 * DAY)).toEqual([]);
    // An unreadable start errs toward suggesting a professional.
    expect(physioRecommendations([{ joint: 'ankle', score: 5, at: 'garbage' }], NOW)).toEqual([{ joint: 'ankle', flag: 'amber', since: 'garbage', days: 15 }]);
  });
});

// ------------------------------------------------------------------ adversarial properties

const phaseArb = fc.constantFrom<PainReportPhase | undefined>('during', 'after_session', 'next_morning', undefined);
const sessionArb = fc.constantFrom<string | null | undefined>(A, B, C, null, undefined);
const reportArb = fc.record({
  joint: fc.constantFrom('knee' as const, 'shoulder' as const),
  score: fc.integer({ min: 0, max: 10 }),
  /** Days from NOW, jumping back and forth (device clock tricks), or an unreadable date. */
  offset: fc.oneof(fc.integer({ min: -30, max: 30 }), fc.constant(Number.NaN)),
  phase: phaseArb,
  settled: fc.option(fc.boolean(), { nil: undefined }),
  sessionId: sessionArb,
});
const toReports = (raw: readonly (typeof reportArb extends fc.Arbitrary<infer T> ? T : never)[]): PainReport[] =>
  raw.map((r) => ({ joint: r.joint, score: r.score, at: Number.isNaN(r.offset) ? 'not-a-date' : at(NOW + r.offset * DAY), phase: r.phase, settled: r.settled, sessionId: r.sessionId }));

describe('S2 cannot be escaped (adversarial fast-check)', () => {
  it('a red rating is only ever cleared by a later-recorded, not-earlier-dated report below 6 from a session that did not rate it red', () => {
    fc.assert(
      fc.property(fc.array(reportArb, { maxLength: 14 }), (raw) => {
        const reports = toReports(raw);
        const flags = jointFlagsFromPain(reports);
        for (const joint of ['knee', 'shoulder'] as const) {
          const mine = reports.filter((r) => r.joint === joint);
          const lastRedIdx = mine.map((r) => classifyPainReport(r)).lastIndexOf('red');
          if (lastRedIdx < 0) {
            // Never rated red → never red; the latest report's colour.
            expect(flags[joint]).not.toBe('red');
            const last = mine.at(-1);
            expect(flags[joint] ?? 'green').toBe(last ? classifyPainReport(last) : 'green');
            continue;
          }
          // Every red rating of the latest red stretch (consecutive, until a clearing report) must be answered.
          const after = mine.slice(lastRedIdx + 1);
          const lastRed = mine[lastRedIdx]!;
          const redAt = Date.parse(lastRed.at);
          const redSession = lastRed.sessionId ?? null;
          // Necessary conditions for a report to clear the latest red rating (the model asks for more).
          const clearer = after.find((c) => {
            const cs = c.sessionId ?? null;
            return c.phase !== 'next_morning' && classifyPainReport(c) !== 'red' && !Number.isNaN(redAt) && !Number.isNaN(Date.parse(c.at)) && Date.parse(c.at) >= redAt && (cs === null ? redSession === null : cs !== redSession);
          });
          // No report after the latest red one could possibly clear it → still red (S2 holds for the next session).
          if (!clearer) expect(flags[joint]).toBe('red');
          // Next-morning checks alone never clear a red joint.
          if (after.every((c) => c.phase === 'next_morning')) expect(flags[joint]).toBe('red');
          // Reports from sessions that rated it red, or dated before the latest red, never clear it.
          const redSessions = new Set(mine.slice(0, lastRedIdx + 1).filter((r) => classifyPainReport(r) === 'red').map((r) => r.sessionId ?? null));
          if (after.every((c) => (c.sessionId ?? null) !== null && redSessions.has(c.sessionId ?? null))) expect(flags[joint]).toBe('red');
          if (after.every((c) => Number.isNaN(Date.parse(c.at)) || Date.parse(c.at) < Date.parse(mine[lastRedIdx]!.at))) expect(flags[joint]).toBe('red');
        }
      }),
      { numRuns: 20_000 },
    );
  });

  it('adding reports can only clear red through a genuine clearing report; appending a red rating always makes the joint red', () => {
    fc.assert(
      fc.property(fc.array(reportArb, { maxLength: 12 }), reportArb, (raw, extra) => {
        const reports = toReports(raw);
        const red = toReports([{ ...extra, score: Math.max(6, extra.score) }])[0]!;
        expect(jointFlagsFromPain([...reports, red])[red.joint]).toBe('red');
        const unsettled = toReports([{ ...extra, phase: 'next_morning', settled: false }])[0]!;
        expect(jointFlagsFromPain([...reports, unsettled])[unsettled.joint]).toBe('red');
      }),
      { numRuns: 5_000 },
    );
  });

  it('is deterministic and independent per joint', () => {
    fc.assert(
      fc.property(fc.array(reportArb, { maxLength: 12 }), (raw) => {
        const reports = toReports(raw);
        expect(painTrafficLight(reports)).toEqual(painTrafficLight(reports));
        const knee = jointFlagsFromPain(reports.filter((r) => r.joint === 'knee')).knee;
        expect(jointFlagsFromPain(reports).knee).toBe(knee);
      }),
      { numRuns: 2_000 },
    );
  });
});

describe('S3 lock: red flags at a check-in lock as well (adversarial)', () => {
  it('any red flag not followed by a later attestation, in order and in time, keeps intensity locked', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ kind: fc.constantFrom('red_flag', 'medical_review_attested', 'pain', 'ended'), offset: fc.oneof(fc.integer({ min: -30, max: 30 }), fc.constant(Number.NaN)) }), { maxLength: 10 }),
        (raw) => {
          const events = raw.map((e) => ({ kind: e.kind, at: Number.isNaN(e.offset) ? 'nope' : at(NOW + e.offset * DAY) }));
          const status = intensityLockStatus(events);
          const flags = events.map((e, i) => ({ ...e, i })).filter((e) => e.kind === 'red_flag');
          const attests = events.map((e, i) => ({ ...e, i })).filter((e) => e.kind === 'medical_review_attested');
          if (flags.length === 0) {
            expect(status.locked).toBe(false);
            return;
          }
          const lastAttestIdx = attests.at(-1)?.i ?? -1;
          const latestAttest = Math.max(Number.NEGATIVE_INFINITY, ...attests.map((a) => Date.parse(a.at)).filter((t) => !Number.isNaN(t)));
          const unlocked = flags.every((f) => f.i < lastAttestIdx && !Number.isNaN(Date.parse(f.at)) && Date.parse(f.at) < latestAttest);
          expect(status.locked).toBe(!unlocked);
          if (status.locked) expect(status.since).not.toBeNull();
        },
      ),
      { numRuns: 10_000 },
    );
  });
});
