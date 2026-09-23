import { ReflowRecordSchema, type IsoDate, type Microcycle, type MovementPattern, type Program, type ProgramSlot, type ReflowOutcome, type ReflowRecord, type ScheduledSession } from '@fitadapt/shared';
import { stamp, type EngineContext } from '../context.js';
import { REFLOW_MAX_EXTRA_SESSIONS_PER_WEEK, programValue } from './config.js';
import { addDays, daysBetween, weekdayOf } from './dates.js';

/**
 * Calendar reflow (M08): when a session cannot happen, it is shifted to a
 * free day later in the same week, or its main work is merged into the next
 * strength session, or the week simply continues — never more than one
 * extra training day per week, never two hard sessions for the same movement
 * pattern on consecutive days, and never intervals the day before a heavy
 * lower-body session. Reflows are recorded (append-only) and replayed over
 * the program; the engine is the only one that decides them.
 */

export type EffectiveState = 'planned' | 'shifted' | 'merged_away' | 'skipped';

/** A session as it stands after the recorded reflows (what the calendar and M02 read). */
export interface EffectiveSession extends ScheduledSession {
  readonly originalDate: IsoDate;
  readonly state: EffectiveState;
  /** Main slots merged in from a session that could not happen (included in `slots`). */
  readonly mergedFrom: readonly string[];
}

export interface EffectiveWeek {
  readonly microcycle: Microcycle;
  readonly sessions: readonly EffectiveSession[];
}

const LOWER: readonly MovementPattern[] = ['squat', 'hinge', 'lunge'];
const active = (s: EffectiveSession) => s.state === 'planned' || s.state === 'shifted';

function initialWeeks(program: Program): EffectiveWeek[] {
  return program.microcycles.map((m) => ({ microcycle: m, sessions: m.sessions.map((s) => ({ ...s, originalDate: s.date, state: 'planned' as const, mergedFrom: [] })) }));
}

function weekIndexOf(weeks: readonly EffectiveWeek[], sessionId: string): number {
  return weeks.findIndex((w) => w.sessions.some((s) => s.id === sessionId));
}

function neighbours(weeks: readonly EffectiveWeek[], w: number): EffectiveSession[] {
  return [...(weeks[w - 1]?.sessions ?? []), ...(weeks[w + 1]?.sessions ?? [])].filter(active);
}

/**
 * The week rules, checked on the active sessions of a week plus the adjacent
 * weeks' sessions: one session per day, dates inside the week, at most one
 * extra training day, no shared hard pattern on consecutive days, no
 * intervals the day before a heavy lower-body session unless the program
 * itself had it there.
 */
export function weekViolations(weeks: readonly EffectiveWeek[], w: number): string[] {
  const week = weeks[w]!;
  const own = week.sessions.filter(active);
  const around = [...own, ...neighbours(weeks, w)];
  const out: string[] = [];
  const dates = own.map((s) => s.date);
  if (new Set(dates).size !== dates.length) out.push('two_sessions_one_day');
  if (own.some((s) => s.date < week.microcycle.startDate || s.date > week.microcycle.endDate)) out.push('outside_week');
  const planned = new Set(week.microcycle.sessions.map((s) => s.date));
  if (own.filter((s) => !planned.has(s.date)).length > REFLOW_MAX_EXTRA_SESSIONS_PER_WEEK) out.push('too_many_extra_sessions');
  if (own.length > week.microcycle.sessions.length) out.push('more_sessions_than_planned');
  for (const a of own) {
    for (const b of around) {
      if (a === b || Math.abs(daysBetween(a.date, b.date)) !== 1) continue;
      if (a.hardPatterns.some((p) => b.hardPatterns.includes(p))) out.push('same_pattern_consecutive_days');
      const [first, second] = a.date < b.date ? [a, b] : [b, a];
      const asProgrammed = first.originalDate === first.date && second.originalDate === second.date && first.mergedFrom.length === 0 && second.mergedFrom.length === 0;
      if (first.conditioning?.kind === 'intervals' && second.heavyLower && !asProgrammed) out.push('intervals_before_heavy_lower');
    }
  }
  return [...new Set(out)];
}

function replace(weeks: readonly EffectiveWeek[], w: number, sessions: EffectiveSession[]): EffectiveWeek[] {
  const next = [...weeks];
  next[w] = { microcycle: weeks[w]!.microcycle, sessions: [...sessions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1)) };
  return next;
}

function withSession(weeks: readonly EffectiveWeek[], w: number, id: string, change: (s: EffectiveSession) => EffectiveSession): EffectiveWeek[] {
  return replace(weeks, w, weeks[w]!.sessions.map((s) => (s.id === id ? change(s) : s)));
}

function mergedSlots(missed: EffectiveSession, into: EffectiveSession, minutesPerSession: number): ProgramSlot[] {
  const per = programValue('reflow.mergeSetsPerSlot');
  const minutesPerSet = programValue('session.minutesPerHardSet');
  let room = Math.floor((minutesPerSession - into.estimatedMinutes) / minutesPerSet);
  const out: ProgramSlot[] = [];
  for (const slot of missed.slots) {
    if (slot.role !== 'primary' || into.slots.some((s) => s.pattern === slot.pattern)) continue;
    const sets = Math.min(per, slot.hardSets, room);
    if (sets <= 0) break;
    out.push({ ...slot, role: 'secondary', hardSets: sets });
    room -= sets;
  }
  return out;
}

function applyOutcome(weeks: readonly EffectiveWeek[], program: Program, sessionId: string, outcome: ReflowOutcome): EffectiveWeek[] {
  const w = weekIndexOf(weeks, sessionId);
  const missed = weeks[w]!.sessions.find((s) => s.id === sessionId)!;
  if (outcome.kind === 'shifted') return withSession(weeks, w, sessionId, (s) => ({ ...s, date: outcome.toDate, weekday: weekdayOf(outcome.toDate), state: 'shifted' }));
  if (outcome.kind === 'skipped') return withSession(weeks, w, sessionId, (s) => ({ ...s, state: 'skipped' }));
  const into = weeks[w]!.sessions.find((s) => s.id === outcome.intoSessionId)!;
  const added = mergedSlots(missed, into, program.minutesPerSession).filter((s) => outcome.patterns.includes(s.pattern));
  const hard = [...new Set([...into.hardPatterns, ...added.map((s) => s.pattern)])] as MovementPattern[];
  const minutes = into.estimatedMinutes + added.reduce((n, s) => n + s.hardSets, 0) * programValue('session.minutesPerHardSet');
  const merged = withSession(weeks, w, into.id, (s) => ({ ...s, slots: [...s.slots, ...added], hardPatterns: hard, heavyLower: s.heavyLower || added.some((a) => LOWER.includes(a.pattern)), estimatedMinutes: minutes, mergedFrom: [...s.mergedFrom, missed.id] }));
  return withSession(merged, w, sessionId, (s) => ({ ...s, state: 'merged_away' }));
}

export type ReflowDecision =
  | { readonly status: 'ok'; readonly outcome: ReflowOutcome; readonly reasonCodes: readonly string[]; readonly weeks: readonly EffectiveWeek[] }
  | { readonly status: 'not_applicable'; readonly reasonCode: 'program.reflow.unknown_session' | 'program.reflow.already_handled' };

/**
 * What to do with a session the user cannot do, reported on `reportedOn`:
 * 1) shift it to the earliest free day from `reportedOn` to the end of its
 *    week that keeps every week rule; 2) otherwise, for a main strength
 *    session, merge its primary slots (≤ `reflow.mergeSetsPerSlot` sets each,
 *    within the session time) into the next strength session of the week that
 *    keeps the rules; 3) otherwise skip it — the week goes on.
 */
export function decideReflow(program: Program, reflows: readonly ReflowRecord[], sessionId: string, reportedOn: IsoDate): ReflowDecision {
  return decideOnWeeks(effectiveWeeks(program, reflows), program, sessionId, reportedOn);
}

function decideOnWeeks(weeks: readonly EffectiveWeek[], program: Program, sessionId: string, reportedOn: IsoDate): ReflowDecision {
  const w = weekIndexOf(weeks, sessionId);
  if (w < 0) return { status: 'not_applicable', reasonCode: 'program.reflow.unknown_session' };
  const week = weeks[w]!;
  const missed = week.sessions.find((s) => s.id === sessionId)!;
  if (!active(missed)) return { status: 'not_applicable', reasonCode: 'program.reflow.already_handled' };

  const ok = (next: EffectiveWeek[]) => weekViolations(next, w).length === 0;
  const from = reportedOn > week.microcycle.startDate ? reportedOn : week.microcycle.startDate;
  for (let d = from; d <= week.microcycle.endDate; d = addDays(d, 1)) {
    if (d === missed.date || week.sessions.some((s) => active(s) && s.date === d)) continue;
    const outcome: ReflowOutcome = { kind: 'shifted', toDate: d };
    const next = applyOutcome(weeks, program, sessionId, outcome);
    if (ok(next)) return { status: 'ok', outcome, reasonCodes: ['program.reflow.shifted'], weeks: next };
  }
  if (missed.priority === 2) {
    const targets = week.sessions.filter((s) => active(s) && s.id !== missed.id && s.priority === 2 && s.date >= reportedOn && s.date > missed.date);
    for (const into of targets) {
      const patterns = mergedSlots(missed, into, program.minutesPerSession).map((s) => s.pattern);
      if (patterns.length === 0) continue;
      const outcome: ReflowOutcome = { kind: 'merged', intoSessionId: into.id, patterns };
      const next = applyOutcome(weeks, program, sessionId, outcome);
      if (ok(next)) return { status: 'ok', outcome, reasonCodes: ['program.reflow.merged'], weeks: next };
    }
  }
  const outcome: ReflowOutcome = { kind: 'skipped' };
  const reason = reportedOn > week.microcycle.endDate ? 'program.reflow.week_over' : 'program.reflow.skipped';
  return { status: 'ok', outcome, reasonCodes: [reason], weeks: applyOutcome(weeks, program, sessionId, outcome) };
}

/** The reflow as a record to store (append-only; the server re-decides it and refuses a mismatch). */
export function reflowRecord(program: Program, reflows: readonly ReflowRecord[], sessionId: string, reportedOn: IsoDate, ctx: EngineContext): ReflowRecord | null {
  const decision = decideReflow(program, reflows, sessionId, reportedOn);
  if (decision.status !== 'ok') return null;
  const s = stamp(ctx);
  return ReflowRecordSchema.parse({ programId: program.programId, sessionId, reportedOn, outcome: decision.outcome, engineVersion: s.engineVersion, decidedAt: s.evaluatedAt, reasonCodes: decision.reasonCodes });
}

/**
 * The program's weeks after the recorded reflows of this program, in the
 * order they were decided. A record that does not match what the engine
 * decides at that point (e.g. edited) is ignored, so the calendar always
 * keeps the rules.
 */
export function effectiveWeeks(program: Program, reflows: readonly ReflowRecord[]): EffectiveWeek[] {
  let weeks: readonly EffectiveWeek[] = initialWeeks(program);
  for (const r of reflows) {
    if (r.programId !== program.programId) continue;
    const decision = decideOnWeeks(weeks, program, r.sessionId, r.reportedOn);
    if (decision.status === 'ok' && JSON.stringify(decision.outcome) === JSON.stringify(r.outcome)) weeks = decision.weeks;
  }
  return [...weeks];
}
