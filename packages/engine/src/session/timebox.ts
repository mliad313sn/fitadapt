import type { Conditioning, MovementPattern, PlannedExercise, SlotIntent, SlotRole } from '@fitadapt/shared';
import { sessionValue } from '../config/session.js';

/**
 * Time-boxing (M02 Scope, David: "the plan must fit the clock"). The plan
 * never takes longer than the minutes available. When it would, in this
 * order: accessory sets are trimmed first; then non-competing patterns are
 * paired as supersets; then the warm-up is shortened, never below its
 * minimum; then a conditioning finisher is shortened and dropped; then
 * secondary sets, accessory exercises, primary sets, and finally whole
 * exercises (last first) go. Every step is explained by a reason code.
 */

export interface WorkExercise {
  /** The fully prescribed exercise (all its sets). */
  readonly exercise: PlannedExercise;
  readonly pattern: MovementPattern;
  readonly role: SlotRole;
  readonly intent: SlotIntent;
  /** Sets kept so far. */
  sets: number;
  /** Superset partner index (into the work list) or null. */
  partner: number | null;
  dropped: boolean;
}

const GROUPS: Partial<Record<MovementPattern, string>> = {
  horizontal_push: 'push',
  vertical_push: 'push',
  horizontal_pull: 'pull',
  vertical_pull: 'pull',
  squat: 'lower',
  hinge: 'lower',
  lunge: 'lower',
  core: 'core',
  carry: 'core',
  isolation: 'arms',
};

/** Two patterns compete when they load the same region (arms compete with pushes and pulls). */
export function competing(a: MovementPattern, b: MovementPattern): boolean {
  const ga = GROUPS[a];
  const gb = GROUPS[b];
  if (!ga || !gb) return true;
  if (ga === gb) return true;
  const arms = new Set(['arms', 'push', 'pull']);
  return (ga === 'arms' && arms.has(gb)) || (gb === 'arms' && arms.has(ga));
}

/** Never paired: heavy strength primaries keep their full rest; balance and mobility are done on their own. */
function pairable(w: WorkExercise): boolean {
  return GROUPS[w.pattern] !== undefined && !(w.role === 'primary' && w.intent === 'strength');
}

const workSeconds = (e: PlannedExercise): number => {
  const t = e.sets[0]!.target;
  return t.kind === 'hold' ? t.seconds : t.max * sessionValue('time.secondsPerRep');
};
const restOf = (e: PlannedExercise): number => e.sets[0]!.restSeconds;

function unitSeconds(a: WorkExercise, b: WorkExercise | null): number {
  const setup = sessionValue('time.setupSecondsPerExercise');
  if (!b) return setup + a.sets * (workSeconds(a.exercise) + restOf(a.exercise));
  let total = 2 * setup;
  const rest = Math.max(restOf(a.exercise), restOf(b.exercise));
  for (let i = 0; i < Math.max(a.sets, b.sets); i++) {
    const inA = i < a.sets;
    const inB = i < b.sets;
    if (inA && inB) total += workSeconds(a.exercise) + sessionValue('time.supersetTransitionSeconds') + workSeconds(b.exercise) + rest;
    else if (inA) total += workSeconds(a.exercise) + restOf(a.exercise);
    else total += workSeconds(b.exercise) + restOf(b.exercise);
  }
  return total;
}

export function totalSeconds(work: readonly WorkExercise[], warmUpMinutes: number, conditioning: Conditioning | null): number {
  let total = warmUpMinutes * 60 + (conditioning ? conditioning.minutes * 60 : 0);
  work.forEach((w, i) => {
    if (w.dropped) return;
    if (w.partner === null) total += unitSeconds(w, null);
    else if (w.partner > i) total += unitSeconds(w, work[w.partner]!);
  });
  return total;
}

export interface FitResult {
  readonly exercises: PlannedExercise[];
  readonly warmUpMinutes: number;
  readonly conditioning: Conditioning | null;
  readonly seconds: number;
  readonly reasonCodes: string[];
  /** Exercises trimmed or dropped, by work index, with the reason (for per-exercise explanations). */
  readonly trimmed: ReadonlyMap<number, string>;
}

/** Fits the session into `minutes`; null when even the minimum (warm-up minimum + one set of one exercise) does not fit. */
export function fitToTime(input: readonly WorkExercise[], warmUpMinutes: number, conditioning: Conditioning | null, minutes: number): FitResult | null {
  const work: WorkExercise[] = input.map((w) => ({ ...w }));
  let warmUp = warmUpMinutes;
  let cond = conditioning;
  const codes: string[] = [];
  const trimmed = new Map<number, string>();
  const budget = minutes * 60;
  const over = () => totalSeconds(work, warmUp, cond) > budget;
  const note = (code: string) => {
    if (!codes.includes(code)) codes.push(code);
  };
  const live = () => work.map((w, i) => [w, i] as const).filter(([w]) => !w.dropped);
  const fromLast = (pred: (w: WorkExercise) => boolean) => [...live()].reverse().find(([w]) => pred(w));
  const drop = (i: number, code: string) => {
    const w = work[i]!;
    w.dropped = true;
    if (w.partner !== null) work[w.partner]!.partner = null;
    w.partner = null;
    trimmed.set(i, code);
    note(code);
  };
  const trimSet = (role: SlotRole, code: string): boolean => {
    const found = fromLast((w) => w.role === role && w.sets > 1);
    if (!found) return false;
    found[0].sets -= 1;
    trimmed.set(found[1], code);
    note(code);
    return true;
  };

  // 1. Accessory sets.
  while (over() && trimSet('accessory', 'session.time.accessory_sets_trimmed'));
  // 2. Supersets of non-competing patterns (accessories first, then secondaries, then non-strength primaries).
  const rank: Record<SlotRole, number> = { accessory: 0, secondary: 1, primary: 2 };
  while (over()) {
    let best: [number, number, number] | null = null;
    const ls = live();
    for (let x = 0; x < ls.length; x++) {
      for (let y = x + 1; y < ls.length; y++) {
        const [a, i] = ls[x]!;
        const [b, j] = ls[y]!;
        if (a.partner !== null || b.partner !== null || !pairable(a) || !pairable(b) || competing(a.pattern, b.pattern)) continue;
        const score = rank[a.role] + rank[b.role];
        if (!best || score < best[0]) best = [score, i, j];
      }
    }
    if (!best) break;
    work[best[1]]!.partner = best[2];
    work[best[2]]!.partner = best[1];
    note('session.time.superset');
  }
  // 3. Warm-up, never below its minimum.
  if (over() && warmUp > sessionValue('warmUp.minimumMinutes')) {
    warmUp = sessionValue('warmUp.minimumMinutes');
    note('session.time.warmup_shortened');
  }
  // 4. Conditioning finisher: shorter, then out. A whole-session conditioning block only shrinks.
  if (over() && cond) {
    const excess = Math.ceil((totalSeconds(work, warmUp, cond) - budget) / 60);
    const floor = cond.placement === 'finisher' ? sessionValue('conditioning.minimumFinisherMinutes') : 1;
    const shorter = Math.max(floor, cond.minutes - excess);
    if (shorter < cond.minutes) {
      cond = { ...cond, minutes: shorter };
      note('session.time.conditioning_shortened');
    }
    if (over() && cond.placement === 'finisher') {
      cond = null;
      note('session.time.finisher_dropped');
    }
  }
  // 5–8. Secondary sets, accessory exercises, primary sets, then whole exercises (last first; the first exercise stays).
  while (over() && trimSet('secondary', 'session.time.secondary_sets_trimmed'));
  while (over()) {
    const found = fromLast((w) => w.role === 'accessory');
    if (!found) break;
    drop(found[1], 'session.time.accessory_dropped');
  }
  while (over() && trimSet('primary', 'session.time.primary_sets_trimmed'));
  while (over() && live().length > 1) drop(live().at(-1)![1], 'session.time.exercise_dropped');
  if (over() || (live().length === 0 && !cond)) return null;

  // Materialise: kept sets, superset rests, letters, partner right after its first exercise.
  const exercises: PlannedExercise[] = [];
  const done = new Set<number>();
  let letter = 0;
  for (const [w, i] of live()) {
    if (done.has(i)) continue;
    done.add(i);
    if (w.partner === null) {
      exercises.push({ ...w.exercise, supersetGroup: null, sets: w.exercise.sets.slice(0, w.sets) });
      continue;
    }
    const p = work[w.partner]!;
    done.add(w.partner);
    const group = String.fromCharCode(65 + letter++);
    const rest = Math.max(restOf(w.exercise), restOf(p.exercise));
    const pairTransition = sessionValue('time.supersetTransitionSeconds');
    exercises.push({ ...w.exercise, supersetGroup: group, sets: w.exercise.sets.slice(0, w.sets).map((s, k) => (k < p.sets ? { ...s, restSeconds: pairTransition, reasonCodes: [...s.reasonCodes, 'session.time.superset'] } : s)) });
    exercises.push({ ...p.exercise, supersetGroup: group, sets: p.exercise.sets.slice(0, p.sets).map((s, k) => (k < w.sets ? { ...s, restSeconds: rest, reasonCodes: [...s.reasonCodes, 'session.time.superset'] } : s)) });
  }
  return { exercises, warmUpMinutes: warmUp, conditioning: cond, seconds: totalSeconds(work, warmUp, cond), reasonCodes: codes, trimmed };
}

/**
 * The duration of a program-session plan, recomputed from the plan alone
 * (warm-up, each exercise's setup, every set's work and rest, conditioning):
 * the same model fitToTime uses, so anyone (tests, the server) can check
 * that a plan fits its minutes.
 */
export function planSeconds(plan: { readonly warmUp: { readonly minutes: number }; readonly conditioning: Conditioning | null; readonly exercises: readonly PlannedExercise[] }): number {
  let total = plan.warmUp.minutes * 60 + (plan.conditioning ? plan.conditioning.minutes * 60 : 0);
  for (const e of plan.exercises) {
    total += sessionValue('time.setupSecondsPerExercise');
    for (const s of e.sets) total += (s.target.kind === 'hold' ? s.target.seconds : s.target.max * sessionValue('time.secondsPerRep')) + s.restSeconds;
  }
  return total;
}
