import { s5LoadCeiling } from '@fitadapt/safety';
import {
  ProgressionDecisionSchema,
  ProgressionInputSchema,
  type MovementPattern,
  type PerformedSet,
  type ProgressionAction,
  type ProgressionDecision,
  type ProgressionInput,
  type SlotTarget,
} from '@fitadapt/shared';
import { assessmentValue } from '../assessment/config.js';
import { epleyE1RM, loadForReps } from '../assessment/e1rm.js';
import { sessionValue } from '../config/session.js';
import { achievableAtLeast, achievableAtMost } from './increments.js';

/**
 * Double progression with RIR autoregulation (M02 Rules, decision C3):
 *
 * Loaded exercises work inside a rep range. When every working set of the
 * last session reached the top of the range at or below the target RPE
 * (reported reserve ≥ target RIR), the load rises by the smallest step the
 * equipment allows that is at least ~2.5 % (upper body) or ~5 % (lower body),
 * and the user returns to the bottom of the range. Two consecutive sessions
 * below the bottom of the range, or a set at RPE ≥ 9.5, make the load
 * 5–10 % lighter. Otherwise the load stays and the user adds reps.
 *
 * Bodyweight exercises progress by variant: top of the range on every set for
 * two sessions → the next variant of the ladder (at the bottom of its
 * range); the same regression rules step one variant down. Holds add a few
 * seconds up to a ceiling, then move to the next variant.
 *
 * S5 is applied last: the load never exceeds 10 % above any load prescribed
 * or used for this exercise within 7 days (packages/safety s5LoadCeiling).
 * Pure: the clock is `asOf` in the input.
 */

const LOWER: readonly MovementPattern[] = ['squat', 'hinge', 'lunge', 'carry'];

const done = (performed: readonly PerformedSet[]) => performed.filter((s) => s.status === 'done');
const rpeOf = (rir: number) => assessmentValue('rpeAtZeroRir') - rir;

function sameTarget(a: SlotTarget, b: SlotTarget): boolean {
  if (a.kind === 'hold') return b.kind === 'hold' && a.seconds === b.seconds;
  return b.kind === 'reps' && a.min === b.min && a.max === b.max;
}

type Session = ProgressionInput['sessions'][number];

/** Every prescribed set done, each at the top of its target, with the reserve at or above the target (RPE at or below). Unreported reserve never counts. */
function topHit(s: Session): boolean {
  if (s.performed.length === 0 || s.performed.some((p) => p.status !== 'done')) return false;
  return s.performed.every((p) => {
    const reached = s.target.kind === 'hold' ? (p.seconds ?? 0) >= s.target.seconds : (p.reps ?? 0) >= s.target.max;
    return reached && p.rir !== null && p.rir >= s.targetRir;
  });
}

/** A set at or above the regression RPE (RIR 0 on the RIR-based scale). */
function tooHard(s: Session): boolean {
  return done(s.performed).some((p) => p.rir !== null && rpeOf(p.rir) >= sessionValue('regression.rpeThreshold'));
}

/** At least the configured share of the done sets finished below the bottom of the range (or under the hold time). */
function belowRange(s: Session): boolean {
  const sets = done(s.performed);
  if (sets.length === 0) return false;
  const below = sets.filter((p) => (s.target.kind === 'hold' ? (p.seconds ?? 0) < s.target.seconds : (p.reps ?? 0) < s.target.min)).length;
  return below / sets.length >= sessionValue('regression.belowRangeShare');
}

const lastN = <T>(xs: readonly T[], n: number) => (xs.length >= n ? xs.slice(xs.length - n) : null);
const round2 = (x: number) => Math.round(x * 100) / 100;

/** The working load the last session was done at: the prescribed load, or less if the user went lighter; the user's own load when none was prescribed. */
function baseLoad(s: Session): number | null {
  const loads = done(s.performed)
    .map((p) => p.loadKg)
    .filter((l): l is number => l !== null && l > 0);
  const used = loads.length > 0 ? Math.min(...loads) : null;
  if (s.prescribedLoadKg !== null && s.prescribedLoadKg > 0) return used === null ? s.prescribedLoadKg : Math.min(s.prescribedLoadKg, used);
  return used;
}

/** Best RIR-adjusted Epley estimate over the done sets of a session (1–12 reps; unreported reserve counts as 0, the lower estimate). */
function bestE1rm(s: Session): number | null {
  let best: number | null = null;
  for (const p of done(s.performed)) {
    if (p.loadKg === null || p.reps === null) continue;
    const e = epleyE1RM(p.loadKg, p.reps, p.rir ?? 0);
    if (e !== null && (best === null || e > best)) best = e;
  }
  return best;
}

export function evaluateProgression(raw: ProgressionInput): ProgressionDecision {
  const input = ProgressionInputSchema.parse(raw);
  const { target, targetRir, sessions, implement } = input;
  const out = (action: ProgressionAction, loadKg: number | null, reasonCodes: string[], params: Record<string, number> = {}, next: SlotTarget = target) => finish(input, action, loadKg, next, reasonCodes, params);
  const last = sessions.at(-1);
  const pairFor = (n: number) => lastN(sessions, n);

  if (!last) return out('start', null, ['session.progression.start']);

  // ---- Holds: seconds, then the next variant
  if (target.kind === 'hold') {
    const seconds = target.seconds;
    if (tooHard(last)) {
      return seconds - sessionValue('hold.stepSeconds') >= sessionValue('hold.minSeconds')
        ? out('decrease_hold', null, ['session.progression.hold_shorter_effort'], { seconds: seconds - sessionValue('hold.stepSeconds') }, { kind: 'hold', seconds: seconds - sessionValue('hold.stepSeconds') })
        : out('variant_down', null, ['session.progression.variant_down_effort']);
    }
    const belowPair = pairFor(sessionValue('regression.sessionsBelowRange'));
    if (belowPair && belowPair.every(belowRange)) {
      return seconds - sessionValue('hold.stepSeconds') >= sessionValue('hold.minSeconds')
        ? out('decrease_hold', null, ['session.progression.hold_shorter'], { seconds: seconds - sessionValue('hold.stepSeconds') }, { kind: 'hold', seconds: seconds - sessionValue('hold.stepSeconds') })
        : out('variant_down', null, ['session.progression.variant_down']);
    }
    const topPair = pairFor(sessionValue('progression.variantSessions'));
    if (topPair && topPair.every((s) => topHit(s) && sameTarget(s.target, target))) {
      const longer = seconds + sessionValue('hold.stepSeconds');
      return longer <= sessionValue('hold.maxSeconds')
        ? out('increase_hold', null, ['session.progression.hold_longer'], { seconds: longer, sessions: topPair.length }, { kind: 'hold', seconds: longer })
        : out('variant_up', null, ['session.progression.variant_up_hold'], { heldSeconds: seconds, sessions: topPair.length }, { kind: 'hold', seconds: sessionValue('hold.minSeconds') });
    }
    return out('hold', null, ['session.progression.hold_held'], { seconds });
  }

  // ---- Bodyweight: variants
  if (input.loading === 'bodyweight') {
    if (last.target.kind !== 'reps' || !sameTarget(last.target, target)) return out('hold', null, ['session.progression.range_changed'], { min: target.min, max: target.max });
    if (tooHard(last)) return out('variant_down', null, ['session.progression.variant_down_effort']);
    const belowPair = pairFor(sessionValue('regression.sessionsBelowRange'));
    if (belowPair && belowPair.every(belowRange)) return out('variant_down', null, ['session.progression.variant_down']);
    const topPair = pairFor(sessionValue('progression.variantSessions'));
    if (topPair && topPair.every((s) => topHit(s) && sameTarget(s.target, target))) return out('variant_up', null, ['session.progression.variant_up'], { reps: target.max, sessions: topPair.length });
    return out('hold', null, ['session.progression.variant_held'], { max: target.max });
  }

  // ---- Loaded (or chosen by the user): double progression
  const base = baseLoad(last);
  if (base === null) return out('start', null, ['session.progression.start']);
  if (implement === null) return out('hold', base, ['session.progression.load_held_steps_unknown'], { loadKg: base });
  const atMost = (x: number) => achievableAtMost(x, implement);

  if (last.target.kind !== 'reps' || !sameTarget(last.target, target)) {
    const e1rm = bestE1rm(last);
    const next = atMost(e1rm !== null ? loadForReps(e1rm, target.max, targetRir) : base);
    return next === null ? out('variant_down', null, ['session.progression.variant_down']) : out('rebase', next, ['session.progression.range_changed'], { min: target.min, max: target.max });
  }
  if (tooHard(last)) {
    const next = atMost(base * (1 - sessionValue('regression.loadReductionFraction')));
    return next === null ? out('variant_down', null, ['session.progression.variant_down_effort']) : out('decrease_load', next, ['session.progression.load_reduced_effort'], { deltaKg: round2(base - next) });
  }
  const belowPair = pairFor(sessionValue('regression.sessionsBelowRange'));
  if (belowPair && belowPair.every(belowRange)) {
    const next = atMost(base * (1 - sessionValue('regression.loadReductionFraction')));
    return next === null ? out('variant_down', null, ['session.progression.variant_down']) : out('decrease_load', next, ['session.progression.load_reduced'], { deltaKg: round2(base - next), min: target.min, sessions: belowPair.length });
  }
  const topSessions = pairFor(sessionValue('progression.loadSessions'));
  if (topSessions && topSessions.every((s) => topHit(s) && sameTarget(s.target, target))) {
    const fraction = LOWER.includes(input.pattern) ? sessionValue('progression.lowerIncrementFraction') : sessionValue('progression.upperIncrementFraction');
    const next = achievableAtLeast(base * (1 + fraction), implement);
    const reached = { sets: last.performed.length, reps: target.max, rir: targetRir, sessions: topSessions.length };
    if (next === null) return out('variant_up', atMost(base), ['session.progression.equipment_max'], { loadKg: base, ...reached });
    return out('increase_load', next, ['session.progression.load_increased'], { deltaKg: round2(next - base), ...reached });
  }
  const incomplete = last.performed.length === 0 || last.performed.some((p) => p.status !== 'done');
  const held = atMost(base);
  return held === null ? out('variant_down', null, ['session.progression.variant_down']) : out('hold', held, [incomplete ? 'session.progression.incomplete' : 'session.progression.load_held'], { max: target.max });
}

/** S5 last: the load never exceeds 10 % above any load of this exercise in the window; a load that cannot be made safe asks for a lighter variant. */
function finish(input: ProgressionInput, action: ProgressionAction, loadKg: number | null, target: SlotTarget, reasonCodes: string[], params: Record<string, number>): ProgressionDecision {
  let load = loadKg;
  let s5Capped = false;
  let next = action;
  let codes = [...reasonCodes];
  let nextTarget = target;
  let nextParams = params;
  // Deload and transition weeks: nothing gets harder (regressions still apply).
  if (input.allowProgression === false && (action === 'increase_load' || action === 'variant_up' || action === 'increase_hold' || action === 'rebase')) {
    const last = input.sessions.at(-1)!;
    const base = baseLoad(last);
    next = 'hold';
    load = base === null ? null : input.implement ? achievableAtMost(base, input.implement) : base;
    nextTarget = input.target;
    codes = ['session.deload.no_progression'];
    nextParams = {};
  }
  const ceiling = load === null ? null : s5LoadCeiling(input.loadReferences, Date.parse(input.asOf));
  if (load !== null && ceiling !== null && load > ceiling) {
    s5Capped = true;
    load = input.implement ? achievableAtMost(ceiling, input.implement) : achievableAtMost(ceiling, { kind: 'increment', stepKg: 0.5 });
    codes.push('session.load.s5_capped');
    if (load === null) {
      next = 'variant_down';
      codes = ['session.progression.variant_down', 'session.load.s5_capped'];
      nextParams = {};
    }
    else if (next === 'increase_load' || next === 'rebase') next = 'hold';
  }
  return ProgressionDecisionSchema.parse({ action: next, loadKg: load, target: nextTarget, s5Capped, reasonCodes: codes, reasonParams: nextParams });
}
