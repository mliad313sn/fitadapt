import { createEngineContext, cueSchedule, fixedClock, type CardioCue } from '@fitadapt/engine';
import { generateSession } from '@fitadapt/exercise-library';
import { evaluateScreening } from '@fitadapt/safety';
import { SCREENING_QUESTION_IDS, type CardioPlan, type SessionHistoryEntry } from '@fitadapt/shared';
import { IntervalRunner, type Timers } from '../src/cardio/interval-runner';

/**
 * M03 goal condition 2 (first half): the interval timer runs on the device
 * against the wall clock; a fake-timer test proves its drift stays under
 * 100 ms over 20 minutes, with a realistically late JS timer (every callback
 * 0–80 ms late, and a 400 ms stall now and then). A naive tick counter on
 * the same timers drifts by seconds, which shows the test has teeth.
 */
const T0 = Date.parse('2026-10-12T07:00:00.000Z');
const DAY = 86_400_000;

function tabataBlock(): CardioPlan {
  const profile = evaluateScreening({
    answers: Object.fromEntries(SCREENING_QUESTION_IDS.map((q) => [q, 'no'])),
    clearanceAttested: false,
    birthDate: { year: 1990, month: 1, day: 1 },
    answeredOn: { year: 2026, month: 9, day: 1 },
    limitations: [],
    excludedExerciseIds: [],
  });
  const history: SessionHistoryEntry[] = [15, 12, 10, 8, 5, 3].map((d, i) => {
    const at = new Date(T0 - d * DAY).toISOString();
    // Interval sessions run to the end: past the first-exposure ramp (A3/A5 #66), so the full 3-block Tabata applies.
    return { planId: `00000000-0000-4000-8000-00000000000${i + 1}`, prescribedAt: at, startedAt: at, countsForProgression: false, exercises: [], cardioSeconds: 1200, hiitCompleted: true as const };
  });
  // 25 minutes: a 5-minute warm-up, then 20 minutes of Tabata blocks and an easy end.
  const r = generateSession({ jointFlags: {}, recentLoads: [], birthDate: null, localDate: null, intensityLock: { locked: false, since: null }, safetyProfile: profile, equipment: [], minutesAvailable: 25, mode: 'cardio', cardio: { protocol: 'tabata' }, history, experience: 'intermediate' }, createEngineContext({ clock: fixedClock(T0), seed: 1 }));
  if (r.status !== 'ok') throw new Error(r.reasonCodes.join());
  return r.plan.cardio!;
}

/** A deterministic, late JS timer: 0–80 ms late on every callback, plus (optionally) a 400 ms stall every 11th callback. */
function lateTimers(stalls = false): Timers & { calls: number; stalls: number } {
  let seed = 42;
  const rand = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648);
  const t = {
    calls: 0,
    stalls: 0,
    setTimeout: (fn: () => void, ms: number) => {
      t.calls += 1;
      const stall = stalls && t.calls % 11 === 0;
      if (stall) t.stalls += 1;
      const late = Math.floor(rand() * 80) + (stall ? 400 : 0);
      return setTimeout(fn, ms + late);
    },
    clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  return t;
}

beforeEach(() => jest.useFakeTimers({ now: T0 }));
afterEach(() => jest.useRealTimers());

describe('the interval timer (goal condition 2: drift < 100 ms over 20 minutes)', () => {
  it('fires every cue within 100 ms of its time over a 25-minute Tabata session (20 minutes of intervals), with a late JS timer', () => {
    const cardio = tabataBlock();
    expect(cardio.totalSeconds).toBe(25 * 60);
    const cues = cueSchedule(cardio);
    const played: { cue: CardioCue; at: number }[] = [];
    let finishedAt: number | null = null;
    const timers = lateTimers();
    const runner = new IntervalRunner({ cues, totalSeconds: cardio.totalSeconds, segments: cardio.timeline, now: () => Date.now(), timers, onCue: (cue) => played.push({ cue, at: Date.now() - T0 }), onFinish: () => (finishedAt = Date.now() - T0) });
    runner.start();
    // Checkpoints every minute: the position is the wall clock, never a tick count.
    const drift: number[] = [];
    for (let minute = 1; minute <= 25; minute++) {
      jest.advanceTimersByTime(60_000);
      drift.push(Math.abs(runner.elapsedMs() - Math.min(minute * 60_000, cardio.totalSeconds * 1000)));
    }
    jest.advanceTimersByTime(2_000);
    expect(Math.max(...drift)).toBeLessThan(100);
    // Every cue played once, in order, each less than 100 ms after its time.
    expect(played.map((p) => p.cue)).toEqual(cues);
    const lateness = played.map((p) => p.at - p.cue.atSeconds * 1000);
    expect(Math.min(...lateness)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...lateness)).toBeLessThan(100);
    // The 20-minute mark (warm-up done + 20 min) and the end.
    const at20 = played.find((p) => p.cue.atSeconds >= 20 * 60)!;
    expect(at20.at - at20.cue.atSeconds * 1000).toBeLessThan(100);
    expect(finishedAt).not.toBeNull();
    expect(finishedAt! - cardio.totalSeconds * 1000).toBeLessThan(100);
    expect(runner.isFinished).toBe(true);
    // The timer really was late (the harness is not a perfect clock).
    expect(timers.calls).toBeGreaterThan(100);
  });

  it('a 400 ms stall delays only the cue it hits: the next cues are on time again (no drift accumulates)', () => {
    const cardio = tabataBlock();
    const cues = cueSchedule(cardio);
    const played: { cue: CardioCue; at: number }[] = [];
    const timers = lateTimers(true);
    const runner = new IntervalRunner({ cues, totalSeconds: cardio.totalSeconds, segments: cardio.timeline, now: () => Date.now(), timers, onCue: (cue) => played.push({ cue, at: Date.now() - T0 }) });
    runner.start();
    jest.advanceTimersByTime(cardio.totalSeconds * 1000 + 2_000);
    expect(played).toHaveLength(cues.length);
    const late = played.map((p) => p.at - p.cue.atSeconds * 1000);
    expect(timers.stalls).toBeGreaterThan(5);
    // Only the cues a stall hit (and a cue due during that stall) are late; everything else is under 100 ms.
    expect(late.filter((l) => l >= 100).length).toBeLessThanOrEqual(2 * timers.stalls);
    expect(late.filter((l) => l < 100).length).toBeGreaterThan(cues.length * 0.9);
    // And the end is on time: no drift accumulated over the 25 minutes.
    expect(late.at(-1)!).toBeLessThan(100 + 400);
    expect(Math.abs(runner.elapsedMs() - cardio.totalSeconds * 1000)).toBe(0);
  });

  it('control: a tick-counting timer on the same late timers drifts by seconds over 20 minutes', () => {
    const timers = lateTimers(true);
    let ticks = 0;
    const tick = () => {
      ticks += 1;
      timers.setTimeout(tick, 1000);
    };
    timers.setTimeout(tick, 1000);
    jest.advanceTimersByTime(20 * 60_000);
    const counted = ticks * 1000;
    expect(20 * 60_000 - counted).toBeGreaterThan(1000);
  });

  it('pause stops the clock, resume continues where it was, a skip jumps without playing the cues in between, and only lived time counts', () => {
    const cardio = tabataBlock();
    const cues = cueSchedule(cardio);
    const played: CardioCue[] = [];
    const runner = new IntervalRunner({ cues, totalSeconds: cardio.totalSeconds, segments: cardio.timeline, now: () => Date.now(), onCue: (c) => played.push(c) });
    runner.start();
    jest.advanceTimersByTime(100_000);
    runner.pause();
    expect(runner.isPaused).toBe(true);
    jest.advanceTimersByTime(60_000);
    expect(runner.elapsedMs()).toBe(100_000);
    runner.pause(); // twice is harmless
    runner.resume();
    runner.resume();
    jest.advanceTimersByTime(20_000);
    expect(runner.elapsedMs()).toBe(120_000);
    // Skip the rest of the warm-up: straight to the first work step, whose announcement plays.
    const firstWork = cardio.timeline.find((s) => s.kind === 'work')!;
    const before = played.length;
    runner.skipTo(firstWork.startSeconds);
    jest.advanceTimersByTime(0);
    expect(played.slice(before)[0]).toMatchObject({ kind: 'step', segmentIndex: firstWork.index });
    expect(played.some((c) => c.kind === 'countdown' && c.atSeconds < firstWork.startSeconds)).toBe(false);
    jest.advanceTimersByTime(20_000);
    runner.stop();
    runner.stop();
    const spent = runner.spent();
    expect(spent.find((s) => s.index === 0)!.seconds).toBe(120);
    expect(spent.find((s) => s.index === firstWork.index)!.seconds).toBe(20);
    expect(spent.reduce((s, x) => s + x.seconds, 0)).toBe(140);
    // After stop, nothing plays.
    const n = played.length;
    jest.advanceTimersByTime(600_000);
    expect(played.length).toBe(n);
    runner.resync();
    runner.skipTo(10);
    runner.pause();
    runner.resume();
    expect(played.length).toBe(n);
  });

  it('after the JS thread was suspended (app in the background without an audio session), it catches up: the running step is announced, stale countdowns are not replayed, the end still plays', () => {
    const cardio = tabataBlock();
    const cues = cueSchedule(cardio);
    const played: { cue: CardioCue; late: number }[] = [];
    // Timers that never fire while "suspended".
    let suspended = false;
    const timers: Timers = { setTimeout: (fn, ms) => setTimeout(() => (suspended ? undefined : fn()), ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
    const runner = new IntervalRunner({ cues, totalSeconds: cardio.totalSeconds, segments: cardio.timeline, now: () => Date.now(), timers, onCue: (cue, late) => played.push({ cue, late }) });
    runner.start();
    jest.advanceTimersByTime(290_000);
    suspended = true;
    jest.advanceTimersByTime(90_000);
    suspended = false;
    const before = played.length;
    runner.resync();
    const caughtUp = played.slice(before);
    // One announcement: the step running now (380 s), not the steps and countdowns missed in between.
    expect(caughtUp).toHaveLength(1);
    expect(caughtUp[0]!.cue.kind).toBe('step');
    const running = cardio.timeline.find((s) => s.startSeconds <= 380 && s.startSeconds + s.durationSeconds > 380)!;
    expect(caughtUp[0]!.cue.segmentIndex).toBe(running.index);
    jest.advanceTimersByTime(cardio.totalSeconds * 1000);
    expect(played.at(-1)!.cue.kind).toBe('finish');
    expect(played.at(-1)!.late).toBeLessThan(100);
  });
});
