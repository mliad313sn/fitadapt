import { impactRank, JOINTS, type CoolDown, type EquipmentId, type EquipmentLoads, type JointFlags, type MovementPattern, type PlannedExercise, type SafetyProfile, type WarmupDrill, type WarmupPlan } from '@fitadapt/shared';
import { sessionValue } from '../config/session.js';
import { blockingReasons, type GraphExercise } from '../substitution.js';
import { achievableAtMost, implementFor } from '../session/increments.js';
import { tagsOf, type SessionLibrary } from '../session/library.js';
import { recoveryValue } from './config.js';

/**
 * M05 warm-up generator (Karim: "warm-ups over ~8 minutes get skipped").
 * Given the minutes the session keeps for it (5–8, SESSION_CONFIG warmUp.*;
 * time-boxing never cuts below 5), the warm-up is:
 * 1. 2–3 minutes of easy general movement (a low-impact warm-up exercise);
 * 2. ramp-up sets before the first heavy lift: ~40/60/80 % of its working
 *    load (the lightest set left out in a short warm-up), rounded DOWN to
 *    the equipment, never at or above the working load; an unreachable light
 *    load becomes "no added weight";
 * 3. specific mobility for the day's movement patterns in the time left:
 *    drills the library lists for each pattern (M06 content), covering as
 *    many of the day's patterns as fit, primary patterns first.
 * The blocks add up exactly to the warm-up minutes. Every drill is allowed
 * for the person (equipment, SafetyProfile, S2) and gentle: no high joint
 * load, and nothing loading an amber or red joint beyond "low".
 */

export interface WarmupContext {
  readonly library: SessionLibrary;
  readonly equipment: ReadonlySet<EquipmentId>;
  readonly loads: EquipmentLoads | null;
  readonly legacyStep: number;
  readonly jointFlags: JointFlags;
  readonly profile: SafetyProfile;
}

/** Drills the library offers for a pattern (M06 content), or, without that list, its warm-up/mobility exercises of that pattern. */
function drillsFor(ctx: WarmupContext, pattern: MovementPattern): readonly string[] {
  const listed = ctx.library.warmUpDrills?.(pattern);
  if (listed) return listed;
  const out: string[] = [];
  for (const ex of ctx.library.graph.exercises.values()) {
    const tags = tagsOf(ctx.library, ex.id);
    if (ex.pattern === pattern && !tags.includes('conditioning') && (tags.includes('warm_up') || tags.includes('mobility'))) out.push(ex.id);
  }
  return out.sort();
}

/** Allowed for this person, and gentle enough for a warm-up, a cool-down or a mobility session. */
export function gentle(ctx: WarmupContext, ex: GraphExercise | undefined): ex is GraphExercise {
  if (!ex || blockingReasons(ex, ctx.equipment, ctx.jointFlags, ctx.profile).length > 0) return false;
  return JOINTS.every((j) => ex.jointLoad[j] !== 'high' && (ctx.jointFlags[j] === undefined || ctx.jointFlags[j] === 'green' || ex.jointLoad[j] === 'low'));
}

/** The day's movement patterns, primaries first, in plan order; a conditioning-only plan warms up for locomotion. */
export function dayPatterns(exercises: readonly PlannedExercise[]): MovementPattern[] {
  const rank = { primary: 0, secondary: 1, accessory: 2 } as const;
  const ordered = exercises.map((e, i) => ({ e, i })).sort((a, b) => rank[a.e.role] - rank[b.e.role] || a.i - b.i);
  const out: MovementPattern[] = [];
  for (const { e } of ordered) if (!out.includes(e.slot)) out.push(e.slot);
  return out.length > 0 ? out : ['locomotion'];
}

/**
 * Greedy cover: each pick serves the most still-uncovered patterns (ties: the first pattern's list order), then
 * second drills. Exercises of the session itself are not repeated as drills; `onlyTag` keeps only drills with that
 * tag (the cool-down uses mobility drills only).
 */
function pickDrills(ctx: WarmupContext, exercises: readonly PlannedExercise[], count: number, onlyTag: 'mobility' | null): { exerciseId: string; forPatterns: MovementPattern[] }[] {
  const patterns = dayPatterns(exercises);
  const inSession = new Set(exercises.map((e) => e.exerciseId));
  const usable = (id: string) => !inSession.has(id) && gentle(ctx, ctx.library.graph.exercises.get(id)) && (onlyTag === null || tagsOf(ctx.library, id).includes(onlyTag));
  const lists = new Map(patterns.map((p) => [p, drillsFor(ctx, p).filter(usable)] as const));
  const serves = (id: string) => patterns.filter((p) => lists.get(p)!.includes(id));
  const order: string[] = [];
  for (const p of patterns) for (const id of lists.get(p)!) if (!order.includes(id)) order.push(id);
  const chosen: { exerciseId: string; forPatterns: MovementPattern[] }[] = [];
  const covered = new Set<MovementPattern>();
  while (chosen.length < count) {
    let best: string | null = null;
    let bestNew = -1;
    let bestAll = -1;
    for (const id of order) {
      if (chosen.some((c) => c.exerciseId === id)) continue;
      const s = serves(id);
      const fresh = s.filter((p) => !covered.has(p)).length;
      if (fresh > bestNew || (fresh === bestNew && s.length > bestAll)) {
        best = id;
        bestNew = fresh;
        bestAll = s.length;
      }
    }
    if (best === null) break;
    const forPatterns = serves(best);
    for (const p of forPatterns) covered.add(p);
    chosen.push({ exerciseId: best, forPatterns });
  }
  return chosen;
}

function generalExercise(ctx: WarmupContext): string | null {
  const options = [...ctx.library.graph.exercises.values()].filter((ex) => {
    const tags = tagsOf(ctx.library, ex.id);
    return tags.includes('warm_up') && tags.includes('conditioning') && gentle(ctx, ex);
  });
  options.sort((a, b) => impactRank(a.impact) - impactRank(b.impact) || (a.id < b.id ? -1 : 1));
  return options[0]?.id ?? null;
}

function rampUp(ctx: WarmupContext, exercises: readonly PlannedExercise[], minutes: number): WarmupPlan['rampUp'] {
  const index = exercises.findIndex((e) => (e.sets[0]?.loadKg ?? 0) > 0);
  if (index < 0) return null;
  const e = exercises[index]!;
  const working = Math.min(...e.sets.map((s) => s.loadKg ?? Number.POSITIVE_INFINITY));
  const ex = ctx.library.graph.exercises.get(e.exerciseId);
  const impl = ex ? (implementFor(ex, ctx.library.loadType(ex.id), ctx.equipment, ctx.loads, ctx.legacyStep)?.implement ?? null) : null;
  const steps: [number, number][] = [
    [recoveryValue('rampUp.percent1'), recoveryValue('rampUp.reps1')],
    [recoveryValue('rampUp.percent2'), recoveryValue('rampUp.reps2')],
    [recoveryValue('rampUp.percent3'), recoveryValue('rampUp.reps3')],
  ];
  const used = minutes >= recoveryValue('rampUp.threeSetsFromMinutes') ? steps : steps.slice(1);
  const sets: { percent: number; loadKg: number; reps: number }[] = [];
  for (const [percent, reps] of used) {
    const raw = (working * percent) / 100;
    // Rounded down to what the equipment can make; nothing light enough → the movement with no added weight.
    const load = impl ? (achievableAtMost(raw, impl) ?? 0) : Math.floor(raw * 2) / 2;
    const safe = load < working ? load : 0;
    if (sets.length > 0 && sets[sets.length - 1]!.loadKg >= safe) continue;
    sets.push({ percent, loadKg: safe, reps });
  }
  const seconds = sets.reduce((sum, s) => sum + s.reps * sessionValue('time.secondsPerRep') + recoveryValue('rampUp.restSeconds'), 0);
  return { exerciseIndex: index, exerciseId: e.exerciseId, workingLoadKg: working, sets, seconds, reasonCodes: ['warmup.ramp_up'] };
}

/** The warm-up for a plan's exercises, filling exactly `minutes`. */
export function buildWarmUp(ctx: WarmupContext, exercises: readonly PlannedExercise[], minutes: number): WarmupPlan {
  const total = Math.round(minutes * 60);
  const long = minutes >= recoveryValue('warmUp.longFromMinutes');
  let general = Math.min(total, long ? recoveryValue('warmUp.generalSecondsLong') : recoveryValue('warmUp.generalSecondsShort'));
  let ramp = rampUp(ctx, exercises, minutes);
  if (ramp && general + ramp.seconds > total) ramp = null;
  const budget = total - general - (ramp?.seconds ?? 0);
  const patterns = dayPatterns(exercises);
  const maxK = Math.floor(budget / recoveryValue('warmUp.drillMinSeconds'));
  const wanted = Math.max(patterns.length, Math.ceil(budget / recoveryValue('warmUp.drillMaxSeconds')));
  const picks = pickDrills(ctx, exercises, Math.min(maxK, wanted), null);
  const mobility: WarmupDrill[] = [];
  if (picks.length > 0) {
    const each = Math.min(recoveryValue('warmUp.drillMaxSeconds') * 5, Math.floor(budget / picks.length));
    for (const p of picks) mobility.push({ exerciseId: p.exerciseId, forPatterns: p.forPatterns, seconds: each, reasonCodes: ['warmup.mobility.for_patterns'] });
  }
  // Whatever the drills do not use goes to the general part, so the blocks add up to the warm-up minutes.
  general += budget - mobility.reduce((s, d) => s + d.seconds, 0);
  const generalId = generalExercise(ctx);
  return {
    general: { exerciseId: generalId, seconds: general, reasonCodes: [generalId ? 'warmup.general' : 'warmup.general.any_easy'] },
    mobility,
    rampUp: ramp,
    seconds: general + (ramp?.seconds ?? 0) + mobility.reduce((s, d) => s + d.seconds, 0),
  };
}

/**
 * Cool-down (M05 Scope): easy mobility for the patterns trained, only with
 * time left in the session (≥ coolDown.minSeconds, up to coolDown.maxMinutes);
 * mobility-tagged (stretch-type) drills only. Null when there is no time or no drill.
 */
export function buildCoolDown(ctx: WarmupContext, exercises: readonly PlannedExercise[], secondsLeft: number): CoolDown | null {
  if (secondsLeft < recoveryValue('coolDown.minSeconds')) return null;
  const minutes = Math.min(recoveryValue('coolDown.maxMinutes'), Math.floor(secondsLeft / 60));
  const each = recoveryValue('coolDown.drillSeconds');
  const picks = pickDrills(ctx, exercises, Math.floor((minutes * 60) / each), 'mobility');
  if (picks.length === 0) return null;
  return {
    minutes: (picks.length * each) / 60,
    drills: picks.map((p) => ({ exerciseId: p.exerciseId, forPatterns: p.forPatterns, seconds: each, reasonCodes: ['cooldown.mobility'] })),
    reasonCodes: ['cooldown.after_session'],
  };
}

/**
 * M05 "alternative grips and variants": an exercise that loads an amber
 * joint at a medium or high level keeps its place (amber is a caution, S2
 * is red) but says how to make it kinder to that joint — a neutral grip for
 * the shoulder, elbow and wrist, a comfortable, shorter range of motion for
 * the lower back, hip, knee and ankle. Guidance only; wording awaits A2.
 */
export function amberHints(ctx: WarmupContext, exercises: readonly PlannedExercise[]): PlannedExercise[] {
  return exercises.map((e) => {
    const ex = ctx.library.graph.exercises.get(e.exerciseId);
    const joints = ex ? JOINTS.filter((j) => ctx.jointFlags[j] === 'amber' && ex.jointLoad[j] !== 'low') : [];
    if (joints.length === 0) return e;
    return { ...e, reasonCodes: [...new Set([...e.reasonCodes, ...joints.map((j) => `session.amber.${j}`)])] };
  });
}
