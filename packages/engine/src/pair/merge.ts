import {
  SharedTimelineSchema,
  type EquipmentConflict,
  type EquipmentId,
  type ParticipantSlot,
  type PlannedExercise,
  type PlannedSet,
  type SessionPlan,
  type SharedTimeline,
  type TimelineBlock,
  type TimelineStep,
} from '@fitadapt/shared';
import { SESSION_CONFIG } from '../config/session.js';
import type { ExerciseGraph } from '../substitution.js';
import { ENGINE_VERSION } from '../version.js';
import { PAIR_CONFIG, PAIR_RULES_VERSION } from './config.js';

/**
 * The shared place: the equipment both partners train with (an id listed n
 * times means n of it, e.g. two pairs of dumbbells) and the M06 graph that
 * says which implements each exercise needs (REQUIRES groups).
 */
export interface SharedEquipment {
  readonly items: readonly EquipmentId[];
  readonly graph: Pick<ExerciseGraph, 'exercises'>;
}

/** A plan needs equipment the shared place does not have: plans must be generated for the shared place (generatePairSession does). */
export class PairEquipmentError extends Error {
  constructor(readonly exerciseId: string) {
    super(`exercise ${exerciseId} needs equipment the shared place does not have`);
    this.name = 'PairEquipmentError';
  }
}

/** Seconds a set takes (the M02 time model): reps × seconds per rep (plus a slow eccentric), or the hold. */
export function workSeconds(set: PlannedSet): number {
  if (set.target.kind === 'hold') return set.target.seconds;
  const perRep = SESSION_CONFIG['time.secondsPerRep'].value + (set.tempo?.eccentricSeconds ?? 0);
  return set.target.max * perRep;
}

/** The implements an exercise occupies at the shared place: for each REQUIRES group, the first item of the group the place has. */
export function implementsOf(exerciseId: string, shared: SharedEquipment): EquipmentId[] {
  const exercise = shared.graph.exercises.get(exerciseId);
  if (!exercise) throw new PairEquipmentError(exerciseId);
  const have = new Set(shared.items);
  const used: EquipmentId[] = [];
  for (const group of exercise.equipment) {
    const pick = group.anyOf.find((id) => have.has(id));
    if (!pick) throw new PairEquipmentError(exerciseId);
    used.push(pick);
  }
  return used;
}

const countOf = (items: readonly EquipmentId[], id: EquipmentId) => items.filter((i) => i === id).length;

/** Longest common subsequence of the two plans' movement patterns: as many shared blocks as possible, each person's order kept. */
function align(a: readonly PlannedExercise[], b: readonly PlannedExercise[]): { a: number | null; b: number | null }[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i]!.slot === b[j]!.slot ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: { a: number | null; b: number | null }[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i]!.slot === b[j]!.slot) out.push({ a: i++, b: j++ });
    else if (j >= m || (i < n && dp[i + 1]![j]! >= dp[i]![j + 1]!)) out.push({ a: i++, b: null });
    else out.push({ a: null, b: j++ });
  }
  return out;
}

/** One single implement both need: staggered turns; a load change between them only when both load it. */
function conflictOf(ea: PlannedExercise, eb: PlannedExercise, shared: SharedEquipment): EquipmentConflict | null {
  const ia = implementsOf(ea.exerciseId, shared);
  const ib = new Set(implementsOf(eb.exerciseId, shared));
  const single = ia.find((id) => ib.has(id) && countOf(shared.items, id) < 2);
  if (!single) return null;
  const loaded = (e: PlannedExercise) => e.sets.some((s) => s.loadKg !== null);
  return { equipment: single, resolution: 'staggered', changeoverSeconds: loaded(ea) && loaded(eb) ? PAIR_CONFIG['equipment.changeoverSeconds'].value : 0 };
}

interface SetRef {
  readonly participant: ParticipantSlot;
  readonly exerciseIndex: number;
  readonly setIndex: number;
  readonly set: PlannedSet;
  /** The rest this person needs before their next set (at least the plan's rest target). */
  readonly rest: number;
}

/**
 * The rest a person needs after a set. In their own plan a superset spends
 * the time between two sets of one exercise on the other exercises of the
 * group, with a short rest after each; the pair timeline does each exercise's
 * sets in turn, so between two sets of the same exercise that person keeps
 * all the recovery the superset gave them: the rest target plus the other
 * group exercises' set and rest. Never shorter than the plan's own rest.
 */
function restAfter(plan: SessionPlan, exerciseIndex: number, setIndex: number): number {
  const exercise = plan.exercises[exerciseIndex]!;
  const set = exercise.sets[setIndex]!;
  if (exercise.supersetGroup === null || setIndex + 1 >= exercise.sets.length) return set.restSeconds;
  let rest = set.restSeconds;
  plan.exercises.forEach((other, i) => {
    if (i === exerciseIndex || other.supersetGroup !== exercise.supersetGroup) return;
    const same = other.sets[setIndex];
    if (same) rest += workSeconds(same) + same.restSeconds;
  });
  return rest;
}

/** Sets of a block in turn order: a, b, a, b, … (or b first) then whoever has sets left. */
function turns(block: { a: number | null; b: number | null }, planA: SessionPlan, planB: SessionPlan, first: ParticipantSlot = 'a'): SetRef[] {
  const listA = block.a === null ? [] : planA.exercises[block.a]!.sets.map((set, s) => ({ participant: 'a' as const, exerciseIndex: block.a!, setIndex: s, set, rest: restAfter(planA, block.a!, s) }));
  const listB = block.b === null ? [] : planB.exercises[block.b]!.sets.map((set, s) => ({ participant: 'b' as const, exerciseIndex: block.b!, setIndex: s, set, rest: restAfter(planB, block.b!, s) }));
  const out: SetRef[] = [];
  const [one, two] = first === 'a' ? [listA, listB] : [listB, listA];
  for (let k = 0; k < Math.max(one.length, two.length); k++) {
    if (one[k]) out.push(one[k]!);
    if (two[k]) out.push(two[k]!);
  }
  return out;
}

const minutesToSeconds = (m: number | undefined | null) => Math.round((m ?? 0) * 60);

/**
 * M09 pair planner: merges two partners' M02 plans into one shared timeline.
 *
 * - Same pattern per block: the plans are aligned on their movement
 *   patterns (longest common subsequence, each person's own exercise order
 *   kept). A pattern both have is a shared block — each partner does their
 *   own variant at their own load; a pattern only one has is a solo block.
 * - Turns ('I go / you go'): within a block the partners alternate sets, so
 *   one partner's set is the other's rest when the rest targets allow.
 * - Rest windows are honoured for both: a set never starts before the same
 *   partner's previous set ended plus its full rest target (the timeline
 *   only ever lengthens a rest, never shortens it; a superset's recovery is
 *   kept, see restAfter).
 * - One shared single implement (one barbell, one pair of dumbbells): the
 *   turns are staggered and a load change between partners gets its time.
 * - Warm-up, the conditioning block and the cool-down are done together,
 *   each person following their own content.
 *
 * It never changes a prescription (exercise, load, reps, reserve, rest) and
 * never mixes the two plans: every set of each plan appears exactly once,
 * for its own partner, in that partner's order. Pure and deterministic.
 */
export interface MergeOptions {
  /** Who takes the first turn of the first shared block (re-planning mid-block keeps the alternation). Default 'a'. */
  readonly firstTurn?: ParticipantSlot;
}

export function mergePlans(planA: SessionPlan, planB: SessionPlan, sharedEquipment: SharedEquipment, options: MergeOptions = {}): SharedTimeline {
  const handover = PAIR_CONFIG['turn.handoverSeconds'].value;
  const blocks: TimelineBlock[] = [];
  const steps: TimelineStep[] = [];
  let t = 0;
  const lastEnd: Record<ParticipantSlot, number | null> = { a: null, b: null };
  const lastRest: Record<ParticipantSlot, number> = { a: 0, b: 0 };
  let staggered = false;

  const together = (kind: 'warm_up' | 'conditioning' | 'cool_down', seconds: number, code: string) => {
    if (seconds <= 0) return;
    const index = blocks.length;
    blocks.push({ index, kind, pattern: null, a: null, b: null, exerciseA: null, exerciseB: null, conflict: null, reasonCodes: [code] });
    // Together blocks wait for both partners' rests after their last sets.
    const ready = Math.max(t, ...(['a', 'b'] as const).map((p) => (lastEnd[p] === null ? 0 : lastEnd[p]! + lastRest[p])));
    steps.push({ index: steps.length, block: index, kind: 'together', participant: null, exerciseIndex: null, setIndex: null, startSecond: ready, durationSeconds: seconds, restAfterSeconds: 0 });
    t = ready + seconds;
    lastEnd.a = t;
    lastEnd.b = t;
    lastRest.a = 0;
    lastRest.b = 0;
  };

  together('warm_up', Math.max(minutesToSeconds(planA.warmUp.minutes), minutesToSeconds(planB.warmUp.minutes)), 'pair.block.warm_up_together');

  let firstShared = true;
  for (const pair of align(planA.exercises, planB.exercises)) {
    const ea = pair.a === null ? null : planA.exercises[pair.a]!;
    const eb = pair.b === null ? null : planB.exercises[pair.b]!;
    // Every exercise must be doable at the shared place (throws otherwise).
    if (ea) implementsOf(ea.exerciseId, sharedEquipment);
    if (eb) implementsOf(eb.exerciseId, sharedEquipment);
    const conflict = ea && eb ? conflictOf(ea, eb, sharedEquipment) : null;
    const shared = ea !== null && eb !== null;
    const index = blocks.length;
    const reasonCodes = [shared ? 'pair.block.shared_pattern' : 'pair.block.solo', ...(conflict ? [conflict.changeoverSeconds > 0 ? 'pair.equipment.staggered' : 'pair.equipment.shared'] : [])];
    blocks.push({ index, kind: shared ? 'shared' : 'solo', pattern: (ea ?? eb)!.slot, a: pair.a, b: pair.b, exerciseA: ea?.exerciseId ?? null, exerciseB: eb?.exerciseId ?? null, conflict, reasonCodes });
    let lastParticipant: ParticipantSlot | null = null;
    let lastLoad: number | null = null;
    const first = shared && firstShared ? (options.firstTurn ?? 'a') : 'a';
    if (shared) firstShared = false;
    for (const ref of turns(pair, planA, planB, first)) {
      const p = ref.participant;
      let start = Math.max(t, lastEnd[p] === null ? 0 : lastEnd[p]! + lastRest[p]);
      if (lastParticipant !== null && lastParticipant !== p) {
        start = Math.max(start, t + handover);
        // One implement, two loads: the partner changes it before their turn.
        if (conflict && conflict.changeoverSeconds > 0 && ref.set.loadKg !== null && lastLoad !== null && ref.set.loadKg !== lastLoad) {
          start = Math.max(start, t + conflict.changeoverSeconds);
          staggered = true;
        }
      }
      const duration = workSeconds(ref.set);
      steps.push({ index: steps.length, block: index, kind: 'set', participant: p, exerciseIndex: ref.exerciseIndex, setIndex: ref.setIndex, startSecond: start, durationSeconds: duration, restAfterSeconds: ref.rest });
      t = start + duration;
      lastEnd[p] = t;
      lastRest[p] = ref.rest;
      lastParticipant = p;
      lastLoad = ref.set.loadKg;
    }
  }

  const cardioSeconds = (plan: SessionPlan) => plan.cardio?.totalSeconds ?? minutesToSeconds(plan.conditioning?.minutes);
  together('conditioning', Math.max(cardioSeconds(planA), cardioSeconds(planB)), 'pair.block.conditioning_together');
  together('cool_down', Math.max(minutesToSeconds(planA.coolDown?.minutes), minutesToSeconds(planB.coolDown?.minutes)), 'pair.block.cool_down_together');

  // The end of the session also leaves each partner their last rest target, like any other set.
  const timeline: SharedTimeline = {
    schemaVersion: 1,
    engineVersion: ENGINE_VERSION,
    rulesVersion: PAIR_RULES_VERSION,
    planA: planA.planId,
    planB: planB.planId,
    blocks,
    steps,
    totalSeconds: t,
    reasonCodes: ['pair.timeline.turns', 'pair.timeline.rest_kept', 'pair.timeline.own_prescriptions', ...(staggered ? ['pair.equipment.staggered'] : [])],
  };
  return SharedTimelineSchema.parse(timeline) as SharedTimeline;
}

/**
 * The same plans from where each partner is now (after swaps, pain
 * adjustments, a partner leaving): a plan cut to the sets not yet done, or
 * null when that partner has nothing left (or has left). The pair screen
 * re-merges the remaining plans; indexes stay those of the full plans.
 */
export interface PlanPosition {
  readonly plan: SessionPlan;
  /** Sets already done or skipped, per exercise index. */
  readonly done: ReadonlySet<string>;
  /** False once the partner has left (stopped, safety stop): none of their sets remain. */
  readonly active: boolean;
}

export const setKey = (exerciseIndex: number, setIndex: number) => `${exerciseIndex}:${setIndex}`;

/**
 * The timeline of what is left: each remaining step keeps the exercise and
 * set indexes of the full plans. A partner who left has no steps; the other
 * goes on alone ('pair.timeline.partner_ended').
 */
export function remainingTimeline(a: PlanPosition, b: PlanPosition, sharedEquipment: SharedEquipment, options: { readonly lastTurn?: ParticipantSlot | null } = {}): SharedTimeline {
  const cut = (pos: PlanPosition): { plan: SessionPlan; map: { e: number; s: number }[][] } => {
    const map: { e: number; s: number }[][] = [];
    const exercises: PlannedExercise[] = [];
    if (pos.active) {
      pos.plan.exercises.forEach((ex, e) => {
        const left = ex.sets.map((set, s) => ({ set, s })).filter(({ s }) => !pos.done.has(setKey(e, s)));
        if (left.length === 0) return;
        map.push(left.map(({ s }) => ({ e, s })));
        exercises.push({ ...ex, sets: left.map(({ set }) => set) });
      });
    }
    // Warm-up, conditioning and cool-down are 'together' blocks; once sets are under way only the rest is re-planned.
    const started = pos.done.size > 0;
    const plan: SessionPlan = {
      ...pos.plan,
      exercises,
      warmUp: started || !pos.active ? { ...pos.plan.warmUp, minutes: 0 } : pos.plan.warmUp,
      ...(pos.active ? {} : { cardio: null, conditioning: null, coolDown: null }),
    };
    return { plan, map };
  };
  const ca = cut(a);
  const cb = cut(b);
  // The alternation goes on: after a's set, b's turn comes first (and the reverse).
  const firstTurn: ParticipantSlot = options.lastTurn === 'a' ? 'b' : 'a';
  const timeline = mergePlans(ca.plan, cb.plan, sharedEquipment, { firstTurn });
  const steps = timeline.steps.map((step) => {
    if (step.kind !== 'set') return step;
    const m = (step.participant === 'a' ? ca : cb).map[step.exerciseIndex!]![step.setIndex!]!;
    return { ...step, exerciseIndex: m.e, setIndex: m.s };
  });
  const blocks = timeline.blocks.map((block) => ({
    ...block,
    a: block.a === null ? null : ca.map[block.a]![0]!.e,
    b: block.b === null ? null : cb.map[block.b]![0]!.e,
  }));
  const ended = !a.active || !b.active;
  return SharedTimelineSchema.parse({ ...timeline, steps, blocks, reasonCodes: ended ? [...timeline.reasonCodes, 'pair.timeline.partner_ended'] : timeline.reasonCodes }) as SharedTimeline;
}
