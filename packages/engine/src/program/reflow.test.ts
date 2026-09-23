import { GOAL_IDS, ReflowRecordSchema, WEEKDAYS, type Program, type ProgramInput, type Weekday } from '@fitadapt/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { profileFrom } from '../__fixtures__/library.js';
import { PROGRAM_LIBRARY, programInput } from '../__fixtures__/program.js';
import { fixedClock } from '../clock.js';
import { createEngineContext } from '../context.js';
import { REFLOW_MAX_EXTRA_SESSIONS_PER_WEEK } from './config.js';
import { addDays, daysBetween } from './dates.js';
import { generateProgram } from './generate.js';
import { programDay } from './queries.js';
import { decideReflow, effectiveWeeks, reflowRecord, weekViolations, type EffectiveWeek } from './reflow.js';

const NOW = Date.parse('2026-09-24T08:00:00.000Z');
const ctx = (seed = 5) => createEngineContext({ clock: fixedClock(NOW), seed });
function program(input: ProgramInput): Program {
  const r = generateProgram(input, PROGRAM_LIBRARY, ctx());
  if (r.status !== 'ok') throw new Error(r.reasonCodes.join(','));
  return r.program;
}

/**
 * Independent check of the reflow rules (goal condition 3), not the engine's
 * own validator: after a reflow, week `w` has no more sessions than planned,
 * at most one session on a day that was not a planned training day, one
 * session per day inside the week, no two hard sessions for the same pattern
 * on consecutive days (also against the neighbouring weeks), and no intervals
 * the day before a heavy lower-body session that the program did not already
 * have there.
 */
function expectValidWeek(weeks: readonly EffectiveWeek[], w: number, label: string) {
  const week = weeks[w]!;
  const live = (x: EffectiveWeek | undefined) => (x?.sessions ?? []).filter((s) => s.state === 'planned' || s.state === 'shifted');
  const own = live(week);
  const plannedDates = new Set(week.microcycle.sessions.map((s) => s.date));
  expect(own.length, label).toBeLessThanOrEqual(week.microcycle.sessions.length);
  expect(own.filter((s) => !plannedDates.has(s.date)).length, label).toBeLessThanOrEqual(REFLOW_MAX_EXTRA_SESSIONS_PER_WEEK);
  expect(new Set(own.map((s) => s.date)).size, label).toBe(own.length);
  for (const s of own) {
    expect(s.date >= week.microcycle.startDate && s.date <= week.microcycle.endDate, label).toBe(true);
  }
  const around = [...own, ...live(weeks[w - 1]), ...live(weeks[w + 1])];
  for (const a of own) {
    for (const b of around) {
      if (a === b || Math.abs(daysBetween(a.date, b.date)) !== 1) continue;
      const shared = a.hardPatterns.filter((p) => b.hardPatterns.includes(p));
      expect(shared, `${label}: ${a.id}@${a.date} and ${b.id}@${b.date}`).toEqual([]);
      const [first, second] = a.date < b.date ? [a, b] : [b, a];
      const unchanged = first.date === first.originalDate && second.date === second.originalDate && first.mergedFrom.length + second.mergedFrom.length === 0;
      if (!unchanged) expect(first.conditioning?.kind === 'intervals' && second.heavyLower, label).toBe(false);
    }
  }
}

const P3 = programInput({ goal: 'muscle_gain', experience: 'intermediate', days: 3, minutes: 45 });

describe('reflow (goal condition 3): missing any single session', () => {
  const programs: [string, ProgramInput][] = [
    ['P3 hypertrophy 3×45', P3],
    ['fat loss 4×60', programInput({ goal: 'fat_loss', days: 4, minutes: 60 })],
    ['hybrid 5×75', programInput({ goal: 'strength', days: 5, minutes: 75, experience: 'advanced' })],
    ['push/pull/legs 6×90', programInput({ goal: 'muscle_gain', days: 6, minutes: 90, experience: 'beginner' })],
    ['endurance 6×45', programInput({ goal: 'endurance', days: 6, minutes: 45 })],
    ['health 5×30', programInput({ goal: 'general_health', days: 5, minutes: 30, experience: 'returning' })],
    ['calisthenics 5×60', programInput({ goal: 'calisthenics_skills', days: 5, minutes: 60, experience: 'advanced' })],
    ['one day', programInput({ goal: 'strength', days: 1 })],
  ];
  for (const [name, input] of programs) {
    it(`${name}: every session of every week, reported on the day or later, gives a valid week`, () => {
      const p = program(input);
      let decisions = 0;
      for (const week of p.microcycles) {
        const w = week.week - 1;
        for (const s of week.sessions) {
          for (const lag of [0, 1, 2, 7]) {
            const reportedOn = addDays(s.date, lag);
            const d = decideReflow(p, [], s.id, reportedOn);
            expect(d.status).toBe('ok');
            if (d.status !== 'ok') continue;
            decisions++;
            expectValidWeek(d.weeks, w, `${name} ${s.id} +${lag}`);
            expect(weekViolations(d.weeks, w)).toEqual([]);
            const moved = d.weeks[w]!.sessions.find((x) => x.id === s.id)!;
            if (d.outcome.kind === 'shifted') {
              expect(moved.state).toBe('shifted');
              expect(moved.date >= reportedOn).toBe(true);
              expect(moved.date).not.toBe(s.date);
            } else if (d.outcome.kind === 'merged') {
              expect(moved.state).toBe('merged_away');
              const into = d.weeks[w]!.sessions.find((x) => x.id === (d.outcome as { intoSessionId: string }).intoSessionId)!;
              expect(into.mergedFrom).toEqual([s.id]);
              expect(into.estimatedMinutes).toBeLessThanOrEqual(p.minutesPerSession);
            } else {
              expect(moved.state).toBe('skipped');
            }
            if (lag === 7) expect(d.reasonCodes).toEqual([addDays(s.date, 7) > week.endDate ? 'program.reflow.week_over' : 'program.reflow.skipped']);
          }
        }
      }
      expect(decisions).toBeGreaterThan(0);
    });
  }

  it('P3 often misses Fridays: Friday moves to Saturday, never to Sunday before Monday’s full body', () => {
    const p = program(P3);
    expect(p.trainingDays).toEqual(['mon', 'wed', 'fri']);
    const friday = p.microcycles[0]!.sessions.find((s) => s.weekday === 'fri')!;
    const d = decideReflow(p, [], friday.id, friday.date);
    expect(d).toMatchObject({ status: 'ok', outcome: { kind: 'shifted', toDate: addDays(friday.date, 1) }, reasonCodes: ['program.reflow.shifted'] });
    // Reported on Sunday: Sunday is the day before next Monday's full-body session (same patterns) → no shift; nothing later in the week → the week goes on.
    const late = decideReflow(p, [], friday.id, addDays(friday.date, 2));
    expect(late).toMatchObject({ status: 'ok', outcome: { kind: 'skipped' }, reasonCodes: ['program.reflow.skipped'] });
  });

  it('merges the main work into the next strength session when no free day keeps the rules', () => {
    const p = program(programInput({ goal: 'muscle_gain', days: 6, minutes: 90, experience: 'beginner' }));
    const week = p.microcycles[0]!;
    const wed = week.sessions.find((s) => s.weekday === 'wed')!;
    const d = decideReflow(p, [], wed.id, wed.date);
    expect(d.status === 'ok' && d.outcome.kind).toBe('merged');
    if (d.status !== 'ok' || d.outcome.kind !== 'merged') return;
    const into = d.weeks[0]!.sessions.find((s) => s.id === (d.outcome as { intoSessionId: string }).intoSessionId)!;
    expect(into.date > wed.date).toBe(true);
    for (const pattern of d.outcome.patterns) expect(into.slots.some((s) => s.pattern === pattern && s.role === 'secondary')).toBe(true);
    expect(d.reasonCodes).toEqual(['program.reflow.merged']);
    // M02 reads the merged session on its day.
    const record = reflowRecord(p, [], wed.id, wed.date, ctx())!;
    expect(programDay(p, [record], into.date)!.sessions[0]!.mergedFrom).toEqual([wed.id]);
    expect(programDay(p, [record], wed.date)!.sessions).toEqual([]);
  });

  it('a missed conditioning session is moved if a day is free, otherwise the week goes on', () => {
    const p = program(programInput({ goal: 'endurance', days: 6, minutes: 45 }));
    const cond = p.microcycles[0]!.sessions.filter((s) => s.focus === 'conditioning');
    const decisions = cond.map((s) => decideReflow(p, [], s.id, s.date));
    expect(decisions.every((d) => d.status === 'ok' && d.outcome.kind !== 'merged')).toBe(true);
  });

  it('property: up to three misses in one week, in any order, keep every week valid', () => {
    const days = fc.integer({ min: 1, max: 6 });
    fc.assert(
      fc.property(fc.constantFrom(...GOAL_IDS), days, fc.constantFrom(30, 45, 60, 90), fc.integer({ min: 0, max: 11 }), fc.array(fc.nat(), { minLength: 1, maxLength: 3 }), fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 3, maxLength: 3 }), (goal, n, minutes, weekPick, picks, lags) => {
        const p = program(programInput({ goal, days: n, minutes }));
        const week = p.microcycles[weekPick % p.microcycles.length]!;
        const w = week.week - 1;
        const records: ReturnType<typeof reflowRecord>[] = [];
        picks.forEach((pick, k) => {
          const weeks = effectiveWeeks(p, records as never);
          const live = weeks[w]!.sessions.filter((s) => s.state === 'planned' || s.state === 'shifted');
          if (live.length === 0) return;
          const target = live[pick % live.length]!;
          const reportedOn = addDays(target.date, lags[k]!);
          const record = reflowRecord(p, records as never, target.id, reportedOn, ctx(k));
          expect(record).not.toBeNull();
          records.push(record);
          expectValidWeek(effectiveWeeks(p, records as never), w, `${goal} ${n}d miss ${k + 1}`);
        });
      }),
      { numRuns: 150 },
    );
  });
});

describe('reflow records', () => {
  it('are schema-valid, deterministic, replayed in order, and ignored when tampered with or from another program', () => {
    const p = program(P3);
    const fri = p.microcycles[1]!.sessions.find((s) => s.weekday === 'fri')!;
    const record = reflowRecord(p, [], fri.id, fri.date, ctx())!;
    expect(ReflowRecordSchema.parse(record)).toEqual(record);
    expect(record).toMatchObject({ programId: p.programId, sessionId: fri.id, reportedOn: fri.date, outcome: { kind: 'shifted', toDate: addDays(fri.date, 1) }, decidedAt: '2026-09-24T08:00:00.000Z' });
    expect(reflowRecord(p, [], fri.id, fri.date, ctx())).toEqual(record);
    const moved = effectiveWeeks(p, [record])[1]!.sessions.find((s) => s.id === fri.id)!;
    expect(moved).toMatchObject({ state: 'shifted', date: addDays(fri.date, 1), weekday: 'sat', originalDate: fri.date });
    // Already handled: a second report of the same session is refused (the shifted one can still be reported).
    expect(decideReflow(p, [record], fri.id, addDays(fri.date, 1)).status).toBe('ok');
    const skip = reflowRecord(p, [], fri.id, addDays(fri.date, 2), ctx())!;
    expect(decideReflow(p, [skip], fri.id, addDays(fri.date, 2))).toEqual({ status: 'not_applicable', reasonCode: 'program.reflow.already_handled' });
    expect(decideReflow(p, [], 'w99.s1', fri.date)).toEqual({ status: 'not_applicable', reasonCode: 'program.reflow.unknown_session' });
    expect(reflowRecord(p, [], 'w99.s1', fri.date, ctx())).toBeNull();
    // A record whose outcome the engine would not decide, or from another program, is ignored.
    const tampered = { ...record, outcome: { kind: 'shifted' as const, toDate: addDays(fri.date, 2) } };
    expect(effectiveWeeks(p, [tampered])[1]!.sessions.find((s) => s.id === fri.id)!.state).toBe('planned');
    expect(effectiveWeeks(p, [{ ...record, programId: '99999999-9999-4999-8999-999999999999' }])[1]!.sessions.find((s) => s.id === fri.id)!.state).toBe('planned');
  });

  it('works for chosen training days too, and the engine validator reports each broken rule', () => {
    const chosen: Weekday[] = ['tue', 'thu', 'sat'];
    const p = program({ ...P3, trainingDays: chosen });
    const weeks = effectiveWeeks(p, []);
    expect(weekViolations(weeks, 0)).toEqual([]);
    const s = weeks[0]!.sessions;
    const broken: EffectiveWeek[] = [...weeks];
    broken[0] = {
      microcycle: weeks[0]!.microcycle,
      sessions: [
        { ...s[0]!, date: s[1]!.date, state: 'shifted', conditioning: { kind: 'intervals', placement: 'finisher', minutes: 10 } },
        s[1]!,
        { ...s[2]!, date: addDays(weeks[0]!.microcycle.endDate, 1), state: 'shifted' },
        { ...s[2]!, id: 'w01.s9', date: addDays(s[1]!.date, 1), state: 'shifted' },
      ],
    };
    expect(weekViolations(broken, 0).sort()).toEqual(['intervals_before_heavy_lower', 'more_sessions_than_planned', 'outside_week', 'same_pattern_consecutive_days', 'too_many_extra_sessions', 'two_sessions_one_day']);
    expect(WEEKDAYS.indexOf(chosen[0]!)).toBe(1);
    expect(profileFrom().screeningOutcome).toBe('cleared');
  });
});
