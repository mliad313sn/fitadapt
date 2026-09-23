import { WEEKDAYS, type GoalId, type Program, type Weekday } from '@fitadapt/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { profileFrom } from '../__fixtures__/library.js';
import { PROGRAM_LIBRARY, programInput } from '../__fixtures__/program.js';
import { fixedClock } from '../clock.js';
import { createEngineContext } from '../context.js';
import { programValue } from './config.js';
import { daysBetween } from './dates.js';
import { generateProgram } from './generate.js';
import { layoutWeek } from './schedule.js';
import { HARD_PATTERNS, SESSION_TEMPLATES, weekTemplate, type SessionTemplateKey } from './templates.js';

const ctx = () => createEngineContext({ clock: fixedClock(Date.parse('2026-09-24T08:00:00.000Z')), seed: 9 });
const all = (p: Program) => p.microcycles.flatMap((w) => w.sessions);

/** Intervals sessions that sit the day before a heavy lower-body session (across week boundaries too). */
function intervalsBeforeHeavyLower(p: Program) {
  const sessions = all(p);
  return sessions.filter((s) => s.conditioning?.kind === 'intervals' && sessions.some((o) => o.heavyLower && daysBetween(s.date, o.date) === 1));
}

/**
 * Brute force, independent of the engine's search: is there ANY assignment of
 * the week's sessions to the training days that keeps the consecutive-day
 * rule and puts the intervals on a session that is not the day before a
 * heavy lower-body day?
 */
function avoidable(keys: readonly SessionTemplateKey[], days: readonly Weekday[], finishers: boolean): boolean {
  const idx = days.map((d) => WEEKDAYS.indexOf(d)).sort((a, b) => a - b);
  const patterns = (k: SessionTemplateKey) => SESSION_TEMPLATES[k].slots.map((s) => s.pattern).filter((p) => HARD_PATTERNS.includes(p));
  const heavy = (k: SessionTemplateKey) => ['full_body', 'lower', 'legs'].includes(SESSION_TEMPLATES[k].focus);
  const gap = (a: number, b: number) => ((b - a + 7) % 7) || 7;
  const perms = (xs: number[]): number[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((r) => [x, ...r])));
  for (const perm of perms(keys.map((_, i) => i))) {
    const placed = perm.map((k, n) => ({ key: keys[k]!, day: idx[n]! }));
    const valid = placed.every((a) => placed.every((b) => a === b || gap(a.day, b.day) !== 1 || !patterns(a.key).some((p) => patterns(b.key).includes(p))));
    if (!valid) continue;
    for (const s of placed) {
      const candidate = SESSION_TEMPLATES[s.key].conditioning || (finishers && SESSION_TEMPLATES[s.key].slots.length > 0);
      if (candidate && !placed.some((o) => o !== s && heavy(o.key) && gap(s.day, o.day) === 1)) return true;
    }
  }
  return false;
}

describe('concurrent training (goal condition 4): no HIIT the day before a heavy lower-body session', () => {
  const goals: GoalId[] = ['fat_loss', 'endurance'];

  it('on the default days, no program ever places intervals the day before a heavy lower-body session', () => {
    for (const goal of goals) {
      for (const days of [1, 2, 3, 4, 5, 6]) {
        for (const minutes of [30, 45, 60, 90]) {
          const r = generateProgram(programInput({ goal, days, minutes }), PROGRAM_LIBRARY, ctx());
          if (r.status !== 'ok') throw new Error('unavailable');
          const intervals = all(r.program).filter((s) => s.conditioning?.kind === 'intervals');
          const finishers = weekTemplate(goal, days).finishers && minutes - 5 - 10 >= 20;
          if (weekTemplate(goal, days).sessions.includes('conditioning') || finishers) expect(intervals.length, `${goal} ${days}d ${minutes}`).toBeGreaterThan(0);
          expect(intervalsBeforeHeavyLower(r.program), `${goal} ${days}d ${minutes}min`).toEqual([]);
          for (const s of intervals) expect(s.reasonCodes).toContain('program.concurrent.no_intervals_before_heavy_lower');
        }
      }
    }
  });

  it('property: on any training days the user picks, intervals are never the day before a heavy lower-body session; they are kept whenever some valid week allows them', () => {
    fc.assert(
      fc.property(fc.constantFrom(...goals), fc.subarray([...WEEKDAYS], { minLength: 1, maxLength: 6 }), fc.constantFrom(45, 60, 90), (goal, trainingDays, minutes) => {
        const days = trainingDays.length;
        const r = generateProgram(programInput({ goal, days, minutes, trainingDays }), PROGRAM_LIBRARY, ctx());
        if (r.status !== 'ok') throw new Error('unavailable');
        expect(intervalsBeforeHeavyLower(r.program)).toEqual([]);
        const tpl = weekTemplate(goal, days);
        const hasIntervals = all(r.program).some((s) => s.conditioning?.kind === 'intervals');
        const possible = avoidable(tpl.sessions, r.program.trainingDays, tpl.finishers && minutes - 5 - 10 >= 20);
        // Intervals are dropped only when no valid layout of the chosen days allows them (then the week is steady, with a reason).
        expect(hasIntervals).toBe(possible);
        if (!possible && (tpl.sessions.includes('conditioning') || tpl.finishers)) expect(all(r.program).some((s) => s.reasonCodes.includes('program.concurrent.intervals_replaced'))).toBe(true);
      }),
      { numRuns: 250 },
    );
  });

  it('when no layout avoids it, the week keeps steady aerobic work instead of intervals, and says why', () => {
    // Monday to Wednesday: the full-body days cannot touch, so the conditioning day sits between them, the day before one.
    const layout = layoutWeek(['full_body_a', 'conditioning', 'full_body_b'], ['mon', 'tue', 'wed'], (k) => k === 'conditioning');
    expect(layout).toMatchObject({ intervalsBeforeHeavyLower: true });
    expect(layoutWeek(['full_body_a', 'full_body_b'], ['mon', 'tue'], null)).toBeNull();
    const r = generateProgram(programInput({ goal: 'endurance', days: 3, minutes: 60, trainingDays: ['mon', 'tue', 'wed'] }), PROGRAM_LIBRARY, ctx());
    if (r.status !== 'ok') throw new Error('unavailable');
    expect(r.program.trainingDays).toEqual(['mon', 'tue', 'wed']);
    expect(all(r.program).some((s) => s.conditioning?.kind === 'intervals')).toBe(false);
    const replaced = all(r.program).filter((s) => s.reasonCodes.includes('program.concurrent.intervals_replaced'));
    expect(replaced.length).toBeGreaterThan(0);
    expect(replaced.every((s) => s.focus === 'conditioning' && s.conditioning?.kind === 'steady')).toBe(true);
  });

  it('intervals only from week 3 (M03: two weeks of training first), never in deload weeks, and only when S1 allows HIIT', () => {
    const r = generateProgram(programInput({ goal: 'endurance', days: 4 }), PROGRAM_LIBRARY, ctx());
    if (r.status !== 'ok') throw new Error('unavailable');
    for (const w of r.program.microcycles) {
      const has = w.sessions.some((s) => s.conditioning?.kind === 'intervals');
      expect(has).toBe(w.kind === 'accumulation' && w.week >= programValue('conditioning.intervalsFromWeek'));
    }
    const flagged = generateProgram(programInput({ goal: 'endurance', days: 4, profile: profileFrom(['unusual_breathlessness']) }), PROGRAM_LIBRARY, ctx());
    if (flagged.status !== 'ok') throw new Error('unavailable');
    expect(all(flagged.program).some((s) => s.conditioning?.kind === 'intervals')).toBe(false);
  });
});
