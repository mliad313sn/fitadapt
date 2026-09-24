import { FairScoreSchema, type ExecutionLog, type FairScore, type FairScoreStatus, type ParticipantSlot, type PlannedSet, type ScoredSet, type SessionPlan } from '@fitadapt/shared';
import { PAIR_CONFIG } from './config.js';

export interface FairScoreInput {
  readonly participant: ParticipantSlot;
  /** The person's own M02 plan (their prescription is their baseline). */
  readonly plan: SessionPlan;
  /** What they logged in this session (append-only; a later entry for the same set replaces an earlier one). */
  readonly sets: readonly ScoredSet[];
  /** Their own execution logs of this session (pain, red flag, ended): what stops the score. */
  readonly events: readonly ExecutionLog[];
  /** %-bodyweight of a bodyweight variant (M06, validated:false), for a swapped variant. */
  readonly bodyweightLoad?: (exerciseId: string) => number | null;
}

/** The expected volume of a set: the bottom of its rep range, or its hold in seconds. */
export const expectedUnits = (set: PlannedSet): number => (set.target.kind === 'reps' ? set.target.min : set.target.seconds);

const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Fair Challenge Score (M09): points relative to each person's own
 * baseline — completed volume × variant/load coefficient ÷ the person's own
 * expected volume, in %. Absolute load and body weight never enter it, so
 * two people of very different capacity doing the same relative effort get
 * the same score.
 *
 * - Expected volume: the bottom of each prescribed rep range (or the hold),
 *   summed over the whole plan; a skipped set counts 0 of it.
 * - A set's credit is capped at its expected volume (`score.setCreditCap`):
 *   extra reps or a heavier load than prescribed earn nothing (no pressure to
 *   grind, L4).
 * - Load coefficient: done load ÷ prescribed load, capped at 1. Variant
 *   coefficient after a swap: %-bodyweight of the done variant ÷ the
 *   prescribed one, capped at 1.
 * - Never rewards training through pain: from the first pain report of the
 *   session nothing more is counted (paused_pain); a red flag ends it
 *   (safety_stop); stopping is allowed at any time (stopped).
 */
export function fairScore(input: FairScoreInput): FairScore {
  const { plan } = input;
  const cap = PAIR_CONFIG['score.setCreditCap'].value;
  const own = input.events.filter((e) => 'planId' in e && e.planId === plan.planId);
  const at = (e: ExecutionLog) => Date.parse(e.at);
  const redFlag = own.find((e) => e.kind === 'red_flag');
  const pain = own.filter((e) => e.kind === 'pain' && (e.phase === undefined || e.phase === 'during')).sort((x, y) => at(x) - at(y))[0];
  const ended = own.find((e) => e.kind === 'ended');
  // Sets logged at or after the first pain report (or a red flag) are not counted.
  const stopAt = Math.min(pain ? at(pain) : Infinity, redFlag ? at(redFlag) : Infinity);

  const latest = new Map<string, ScoredSet>();
  for (const s of input.sets) latest.set(`${s.exerciseIndex}:${s.set.index}`, s);

  let expected = 0;
  let completed = 0;
  let capped = false;
  let loadCoefficient = false;
  let variantCoefficient = false;
  plan.exercises.forEach((ex, e) => {
    for (const set of ex.sets) {
      const units = expectedUnits(set);
      expected += units;
      const logged = latest.get(`${e}:${set.index}`);
      if (!logged || logged.set.status !== 'done' || Date.parse(logged.loggedAt) >= stopAt) continue;
      const done = (set.target.kind === 'reps' ? logged.set.reps : logged.set.seconds) ?? 0;
      const limit = units * cap;
      if (done > limit) capped = true;
      let coefficient = 1;
      if (set.loadKg !== null && set.loadKg > 0 && logged.set.loadKg !== null) {
        coefficient = Math.min(1, logged.set.loadKg / set.loadKg);
        if (coefficient < 1) loadCoefficient = true;
      }
      if (logged.exerciseId !== ex.exerciseId) {
        const doneBw = input.bodyweightLoad?.(logged.exerciseId) ?? null;
        const plannedBw = input.bodyweightLoad?.(ex.exerciseId) ?? null;
        const ratio = doneBw !== null && plannedBw !== null && plannedBw > 0 ? Math.min(1, doneBw / plannedBw) : PAIR_CONFIG['score.unknownVariantCoefficient'].value;
        coefficient *= ratio;
        variantCoefficient = true;
      }
      completed += Math.min(done, limit) * coefficient;
    }
  });

  const status: FairScoreStatus = redFlag ? 'safety_stop' : pain ? 'paused_pain' : ended?.kind === 'ended' && ended.reason === 'completed' ? 'complete' : ended ? 'stopped' : 'scoring';
  const points = expected > 0 ? Math.min(100, round1((100 * completed) / expected)) : 0;
  const reasonCodes = [
    'pair.score.relative',
    `pair.score.${status}`,
    ...(capped ? ['pair.score.capped_at_plan'] : []),
    ...(loadCoefficient ? ['pair.score.load_coefficient'] : []),
    ...(variantCoefficient ? ['pair.score.variant_coefficient'] : []),
  ];
  return FairScoreSchema.parse({ participant: input.participant, planId: plan.planId, points, completedUnits: round1(completed), expectedUnits: expected, status, reasonCodes }) as FairScore;
}

/**
 * The two scores are shown side by side only when both partners completed
 * their plan. Stopping early, a pain pause or a safety stop ends the
 * comparison for both without saying why (L4: nothing pressures anyone to
 * go on through pain or fatigue). There is no winner field: each score is a
 * share of that person's own plan.
 */
export function challengeComparable(a: FairScore, b: FairScore): boolean {
  return a.status === 'complete' && b.status === 'complete';
}
