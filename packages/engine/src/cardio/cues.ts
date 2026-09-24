import type { CardioPlan, CardioSegment } from '@fitadapt/shared';
import { cardioValue } from './config.js';

/**
 * Eyes-free guidance (Marco: nobody looks at a screen mid-interval). The cue
 * schedule of a cardio block: what to say and which haptic to play, and when
 * (seconds from the start of the block). Audio and haptics lead; the screen
 * only repeats them. Pure and deterministic: the device's timer
 * (apps/mobile/src/cardio) plays these cues against the wall clock.
 *
 * - at the start of every step: its announcement ("Work: burpees, round 3 of
 *   8", "Recover", "Last round" …) and a haptic (strong for work, light for
 *   rest);
 * - a 3-2-1 countdown before each hard step (work, EMOM minute, AMRAP) and
 *   before the end, when the current step is long enough;
 * - "halfway" and "one minute left" in long steady or AMRAP steps;
 * - "done" at the end.
 * Speech is an i18n key (packages/i18n `cardio.cue.*`, FR and EN) with its
 * numbers; the app adds the exercise name (`exercise.<id>.name`).
 */

export type CueHaptic = 'work' | 'rest' | 'tick' | 'finish';
export type CueKind = 'step' | 'countdown' | 'halfway' | 'minute_left' | 'finish';

export interface CardioCue {
  /** Seconds from the start of the block. */
  readonly atSeconds: number;
  readonly kind: CueKind;
  /** The step this cue belongs to (the one starting, or running). */
  readonly segmentIndex: number;
  /** i18n key (packages/i18n `cardio.cue.*`). */
  readonly speech: string;
  readonly params: Readonly<Record<string, number>>;
  /** The exercise to name in the announcement (the app renders `exercise.<id>.name`), if any. */
  readonly exerciseId: string | null;
  readonly haptic: CueHaptic | null;
}

const HARD = new Set<CardioSegment['kind']>(['work', 'emom_minute', 'amrap', 'steady']);

function stepCue(s: CardioSegment, plan: CardioPlan): CardioCue {
  const base = { atSeconds: s.startSeconds, kind: 'step' as const, segmentIndex: s.index, exerciseId: s.exerciseId };
  const last = s.round !== null && s.rounds !== null && s.round === s.rounds;
  switch (s.kind) {
    case 'warm_up':
      return { ...base, speech: 'cardio.cue.warmUp', params: { minutes: Math.round(s.durationSeconds / 60) }, haptic: 'rest' };
    case 'work':
      return { ...base, speech: last ? 'cardio.cue.workLast' : s.exerciseId ? 'cardio.cue.work' : 'cardio.cue.workAny', params: { round: s.round ?? 1, rounds: s.rounds ?? 1, seconds: s.durationSeconds }, haptic: 'work' };
    case 'recover':
      return { ...base, speech: 'cardio.cue.recover', params: { seconds: s.durationSeconds }, haptic: 'rest' };
    case 'block_rest':
      return { ...base, speech: 'cardio.cue.blockRest', params: { seconds: s.durationSeconds }, haptic: 'rest' };
    case 'steady':
      return { ...base, speech: s.exerciseId ? 'cardio.cue.steady' : 'cardio.cue.steadyAny', params: { minutes: Math.round(s.durationSeconds / 60) }, haptic: 'work' };
    case 'emom_minute':
      return { ...base, speech: last ? 'cardio.cue.emomLast' : 'cardio.cue.emom', params: { reps: s.reps ?? 1, round: s.round ?? 1, rounds: s.rounds ?? 1 }, haptic: 'work' };
    case 'amrap':
      return { ...base, speech: 'cardio.cue.amrap', params: { minutes: Math.round(s.durationSeconds / 60), movements: plan.movements.length, reps: s.reps ?? 1 }, haptic: 'work' };
    default:
      return { ...base, speech: 'cardio.cue.coolDown', params: { minutes: Math.max(1, Math.round(s.durationSeconds / 60)) }, haptic: 'rest' };
  }
}

export function cueSchedule(plan: CardioPlan): CardioCue[] {
  const cues: CardioCue[] = [];
  const countdown = cardioValue('cues.countdownSeconds');
  const segs = plan.timeline;
  segs.forEach((s, i) => {
    cues.push(stepCue(s, plan));
    const end = s.startSeconds + s.durationSeconds;
    if ((s.kind === 'steady' || s.kind === 'amrap') && s.durationSeconds >= cardioValue('cues.halfwayMinSegmentSeconds')) {
      cues.push({ atSeconds: s.startSeconds + Math.floor(s.durationSeconds / 2), kind: 'halfway', segmentIndex: i, speech: 'cardio.cue.halfway', params: {}, exerciseId: null, haptic: 'tick' });
    }
    if ((s.kind === 'steady' || s.kind === 'amrap') && s.durationSeconds >= cardioValue('cues.minuteLeftMinSegmentSeconds')) {
      cues.push({ atSeconds: end - 60, kind: 'minute_left', segmentIndex: i, speech: 'cardio.cue.minuteLeft', params: {}, exerciseId: null, haptic: 'tick' });
    }
    const next = segs[i + 1];
    const before = next ? HARD.has(next.kind) : true;
    if (before && s.durationSeconds >= cardioValue('cues.countdownMinSegmentSeconds')) {
      for (let n = countdown; n >= 1; n--) cues.push({ atSeconds: end - n, kind: 'countdown', segmentIndex: i, speech: 'cardio.cue.countdown', params: { count: n }, exerciseId: null, haptic: 'tick' });
    }
  });
  cues.push({ atSeconds: plan.totalSeconds, kind: 'finish', segmentIndex: segs.length - 1, speech: 'cardio.cue.finish', params: {}, exerciseId: null, haptic: 'finish' });
  // Stable order: by time, then step announcements before the rest at the same second.
  const rank: Record<CueKind, number> = { step: 0, halfway: 1, minute_left: 2, countdown: 3, finish: 4 };
  return cues.map((c, i) => ({ c, i })).sort((a, b) => a.c.atSeconds - b.c.atSeconds || rank[a.c.kind] - rank[b.c.kind] || a.i - b.i).map((x) => x.c);
}

/** Every speech key a cue can use (the i18n test renders each in FR and EN). */
export const CARDIO_CUE_KEYS: readonly string[] = Object.freeze([
  'cardio.cue.warmUp',
  'cardio.cue.work',
  'cardio.cue.workAny',
  'cardio.cue.workLast',
  'cardio.cue.recover',
  'cardio.cue.blockRest',
  'cardio.cue.steady',
  'cardio.cue.steadyAny',
  'cardio.cue.emom',
  'cardio.cue.emomLast',
  'cardio.cue.amrap',
  'cardio.cue.coolDown',
  'cardio.cue.halfway',
  'cardio.cue.minuteLeft',
  'cardio.cue.countdown',
  'cardio.cue.finish',
]);

/** Where the block is at `elapsedSeconds`: the running step and the seconds left in it (null after the end). */
export function segmentAt(plan: CardioPlan, elapsedSeconds: number): { segment: CardioSegment; remainingSeconds: number } | null {
  if (elapsedSeconds >= plan.totalSeconds) return null;
  const t = Math.max(0, elapsedSeconds);
  for (const s of plan.timeline) if (t < s.startSeconds + s.durationSeconds) return { segment: s, remainingSeconds: s.startSeconds + s.durationSeconds - t };
  return null;
}
