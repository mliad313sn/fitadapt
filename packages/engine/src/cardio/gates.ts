import { screeningGateCheck } from '@fitadapt/safety';
import { impactRank, type ImpactLevel, type Joint, type JointFlags, type SafetyProfile, type SessionHistoryEntry } from '@fitadapt/shared';
import { cardioValue } from './config.js';

/**
 * M03 gates (Dr. Amina and Thomas: HIIT and high-impact moves must be gated).
 *
 * HIIT (HIIT, Tabata, a vigorous custom protocol, and M08 interval blocks):
 * - S1 first: packages/safety `screeningGateCheck` with `hiit: true` — refused
 *   while a screening flag is unresolved or SafetyProfile.allowHIIT is false;
 * - then "≥ 2 weeks of consistent training are logged": the first logged
 *   session is at least `hiit.consistentWeeks` weeks old, and each of the
 *   last `hiit.consistentWeeks` 7-day windows before now holds at least
 *   `hiit.minSessionsPerWeek` logged sessions. A session counts as logged
 *   when at least one set was done or a cardio block was run.
 *   Records dated after the engine clock never count (fail closed on time).
 *
 * Impact: the default is low for knee/ankle/hip flags (M01 limited joints or
 * an M05 amber/red pain rating) or a BMI ≥ 35, until the user opts up. Opting
 * up never goes above the SafetyProfile ceiling, and never while a knee, ankle
 * or hip is red (S2).
 */

const DAY_MS = 86_400_000;
const LOWER: readonly Joint[] = ['knee', 'ankle', 'hip'];

export type HiitGateReason = 'safety.s1.hiit_not_allowed' | 'cardio.hiit.needs_consistent_training';

/** Start times of the sessions the user actually trained in (a done set or a cardio block), not after `nowMs`. */
export function loggedSessionTimes(history: readonly SessionHistoryEntry[], nowMs: number): number[] {
  return history
    .filter((h) => (h.cardioSeconds ?? 0) > 0 || h.exercises.some((e) => e.performed.some((p) => p.status === 'done')))
    .map((h) => Date.parse(h.startedAt))
    .filter((t) => Number.isFinite(t) && t <= nowMs)
    .sort((a, b) => a - b);
}

/** ≥ N weeks of consistent logged training before `nowMs`. */
export function consistentTraining(history: readonly SessionHistoryEntry[], nowMs: number): boolean {
  const weeks = cardioValue('hiit.consistentWeeks');
  const perWeek = cardioValue('hiit.minSessionsPerWeek');
  const times = loggedSessionTimes(history, nowMs);
  if (times.length === 0 || times[0]! > nowMs - weeks * 7 * DAY_MS) return false;
  for (let w = 0; w < weeks; w++) {
    const from = nowMs - (w + 1) * 7 * DAY_MS;
    const to = nowMs - w * 7 * DAY_MS;
    if (times.filter((t) => t > from && t <= to).length < perWeek) return false;
  }
  return true;
}

/** A3/A5 #66: fewer interval sessions completed than the ramp needs → the first-exposure interval caps apply. */
export function hiitFirstExposure(history: readonly SessionHistoryEntry[]): boolean {
  return history.filter((h) => h.hiitCompleted === true).length < cardioValue('hiit.rampCompletedSessions');
}

/** Null when HIIT may be prescribed; otherwise why not (S1 first). */
export function hiitGate(profile: SafetyProfile, history: readonly SessionHistoryEntry[], nowMs: number, rpe: number): HiitGateReason | null {
  const s1 = screeningGateCheck({ profile, request: { rpe, hiit: true, maximalTest: false } });
  if (s1 !== null) return 'safety.s1.hiit_not_allowed';
  if (!consistentTraining(history, nowMs)) return 'cardio.hiit.needs_consistent_training';
  return null;
}

export interface ImpactFacts {
  readonly profile: SafetyProfile;
  readonly jointFlags?: JointFlags;
  readonly bodyweightKg?: number | null;
  readonly heightCm?: number | null;
  readonly impactOptIn?: boolean;
}

export function bmiOf(bodyweightKg: number | null | undefined, heightCm: number | null | undefined): number | null {
  if (!bodyweightKg || !heightCm) return null;
  const m = heightCm / 100;
  return bodyweightKg / (m * m);
}

const lower = (a: ImpactLevel, b: ImpactLevel): ImpactLevel => (impactRank(a) <= impactRank(b) ? a : b);

/** The impact ceiling of today's conditioning movements, and why. */
export function cardioImpactCeiling(facts: ImpactFacts): { ceiling: ImpactLevel; reasonCodes: string[] } {
  const flags = facts.jointFlags ?? {};
  const reasons: string[] = [];
  const limited = LOWER.filter((j) => facts.profile.limitedJoints.includes(j));
  const flagged = LOWER.filter((j) => flags[j] === 'amber' || flags[j] === 'red');
  const red = LOWER.filter((j) => flags[j] === 'red');
  const bmi = bmiOf(facts.bodyweightKg, facts.heightCm);
  const heavy = bmi !== null && bmi >= cardioValue('impact.lowDefaultBmi');
  for (const j of limited) reasons.push(`cardio.impact.low_default.limited.${j}`);
  for (const j of flagged) if (!limited.includes(j)) reasons.push(`cardio.impact.low_default.pain.${j}`);
  if (heavy) reasons.push('cardio.impact.low_default.bmi');
  const low: ImpactLevel = 'low';
  let ceiling = facts.profile.impactCeiling;
  if (red.length > 0) {
    // S2: a red knee, ankle or hip keeps impact low whatever the user chose.
    ceiling = lower(ceiling, low);
    reasons.push(`cardio.impact.red_joint.${red[0]!}`);
  } else if (limited.length > 0 || flagged.length > 0 || heavy) {
    if (facts.impactOptIn) reasons.push('cardio.impact.opted_up');
    else ceiling = lower(ceiling, low);
  }
  if (impactRank(facts.profile.impactCeiling) < impactRank('high')) reasons.push(`cardio.impact.profile_ceiling.${facts.profile.impactCeiling}`);
  return { ceiling, reasonCodes: reasons.length > 0 ? reasons : ['cardio.impact.any'] };
}

/** True when the low-impact default applies to this person (so the app can offer "opt up"). */
export function lowImpactDefault(facts: ImpactFacts): boolean {
  const { ceiling } = cardioImpactCeiling({ ...facts, impactOptIn: false });
  return impactRank(ceiling) < impactRank(facts.profile.impactCeiling);
}


/**
 * The SafetyProfile a session's exercise choice uses (M03 "impact levels per
 * exercise; the default is set from SafetyProfile, bodyweight and joint
 * flags"): the same profile with its impact ceiling lowered to today's
 * default (knee/ankle/hip flag or BMI ≥ 35 → low until the user opts up; a red
 * knee, ankle or hip → low). Strength slots, swaps and pain replacements read
 * it as well as the cardio block, so no part of a session goes above it.
 */
export function sessionSafetyProfile(input: Omit<ImpactFacts, 'profile'> & { readonly safetyProfile: SafetyProfile }): SafetyProfile {
  const { ceiling } = cardioImpactCeiling({ ...input, profile: input.safetyProfile });
  return ceiling === input.safetyProfile.impactCeiling ? input.safetyProfile : { ...input.safetyProfile, impactCeiling: ceiling };
}
