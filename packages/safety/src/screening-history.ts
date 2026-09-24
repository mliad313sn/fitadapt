import {
  CONTRAINDICATION_TAGS,
  IMPACT_LEVELS,
  JOINTS,
  SCREENING_QUESTION_IDS,
  SafetyProfileSchema,
  orderChain,
  type ChainOrder,
  type SafetyProfile,
  type ScreeningRecord,
} from '@fitadapt/shared';
import { evaluateScreening, notScreenedSafetyProfile } from './screening.js';

/**
 * Which screening counts (S1, S4, S7), on the device and on the server alike
 * (ADR-023). Never "the newest timestamp": a device clock can go backwards
 * and two screenings can share an instant, which made an OLD, looser
 * screening the "latest" (PO finding: a re-screen answering "advised against
 * calorie restriction" still showed a calorie target).
 *
 * - The screenings are ordered by their `supersedes` chain (record ids of the
 *   screenings each one replaced); screenings stored before the chain are
 *   ordered by `completedAt` among themselves, equal instants ambiguous.
 * - One head: its answers, re-derived with the bundled rules.
 * - Several heads (two devices offline, equal legacy instants, corrupt
 *   links): FAIL CLOSED — the strictest combination of every head's
 *   profile, so the result is never looser than any candidate.
 */
export interface ScreeningEntry {
  /** The sync record id (what `supersedes` names). */
  readonly id: string;
  readonly data: ScreeningRecord;
}

export function orderScreenings<T extends ScreeningEntry>(screenings: readonly T[]): ChainOrder<T> {
  return orderChain(screenings, (s) => ({ id: s.id, supersedes: s.data.supersedes, at: s.data.completedAt }));
}

const OUTCOME_STRICTNESS: readonly SafetyProfile['screeningOutcome'][] = ['cleared', 'cleared_with_restrictions', 'consult_professional', 'not_screened', 'blocked'];
const strictness = (o: SafetyProfile['screeningOutcome']) => OUTCOME_STRICTNESS.indexOf(o);
const inOrder = <T>(all: readonly T[], chosen: Iterable<T>) => {
  const set = new Set(chosen);
  return all.filter((x) => set.has(x));
};

/** Reason code of a profile combined from several candidate screenings (FR/EN in packages/i18n). */
export const AMBIGUOUS_SCREENING_REASON = 'safety_profile.ambiguous_latest' as const;

/**
 * The strictest combination of several SafetyProfiles: every cap at its
 * lowest, every permission only if all allow it, every restriction of any.
 * Never looser than any input (property-tested). The result does not depend
 * on the order of the inputs, except for the order of the reason codes.
 */
export function strictestSafetyProfile(profiles: readonly SafetyProfile[]): SafetyProfile {
  if (profiles.length === 0) return notScreenedSafetyProfile();
  if (profiles.length === 1) return profiles[0]!;
  const all = <K extends keyof SafetyProfile>(k: K) => profiles.map((p) => p[k]);
  const outcome = profiles.map((p) => p.screeningOutcome).reduce((a, b) => (strictness(b) > strictness(a) ? b : a));
  const impact = profiles.map((p) => p.impactCeiling).reduce((a, b) => (IMPACT_LEVELS.indexOf(b) < IMPACT_LEVELS.indexOf(a) ? b : a));
  const reasons = [...new Set([...profiles.flatMap((p) => p.reasonCodes), AMBIGUOUS_SCREENING_REASON])];
  return SafetyProfileSchema.parse({
    maxRPE: Math.min(...all('maxRPE')),
    allowHIIT: all('allowHIIT').every(Boolean),
    allowMaxTests: all('allowMaxTests').every(Boolean),
    impactCeiling: impact,
    avoidTags: inOrder(CONTRAINDICATION_TAGS, profiles.flatMap((p) => p.avoidTags)),
    excludedExerciseIds: [...new Set(profiles.flatMap((p) => p.excludedExerciseIds))].sort(),
    screeningOutcome: outcome,
    unresolvedFlags: inOrder(SCREENING_QUESTION_IDS, profiles.flatMap((p) => p.unresolvedFlags)),
    deficitNutritionAllowed: all('deficitNutritionAllowed').every(Boolean),
    specialPopulation: profiles.some((p) => p.specialPopulation !== 'none') ? 'pregnancy_postpartum' : 'none',
    automaticProgrammingAllowed: all('automaticProgrammingAllowed').every(Boolean),
    lowIntensityLibraryOnly: all('lowIntensityLibraryOnly').some(Boolean),
    professionalGuidance: all('professionalGuidance').some(Boolean),
    limitedJoints: inOrder(JOINTS, profiles.flatMap((p) => p.limitedJoints)),
    // FIX-B (CS-7): heart-rate zones only if every candidate allows them (absent = not allowed).
    heartRateZonesAllowed: profiles.every((p) => p.heartRateZonesAllowed === true),
    reasonCodes: reasons,
    rulesVersion: [...all('rulesVersion')].sort()[0],
  });
}

/** True when `a` allows nothing that `b` forbids (every S1/S4/S7 field of `a` is at least as strict). */
export function isAtLeastAsStrict(a: SafetyProfile, b: SafetyProfile): boolean {
  const covers = <T>(big: readonly T[], small: readonly T[]) => small.every((x) => big.includes(x));
  return (
    a.maxRPE <= b.maxRPE &&
    (!a.allowHIIT || b.allowHIIT) &&
    (!a.allowMaxTests || b.allowMaxTests) &&
    IMPACT_LEVELS.indexOf(a.impactCeiling) <= IMPACT_LEVELS.indexOf(b.impactCeiling) &&
    covers(a.avoidTags, b.avoidTags) &&
    covers(a.excludedExerciseIds, b.excludedExerciseIds) &&
    strictness(a.screeningOutcome) >= strictness(b.screeningOutcome) &&
    covers(a.unresolvedFlags, b.unresolvedFlags) &&
    (!a.deficitNutritionAllowed || b.deficitNutritionAllowed) &&
    (a.specialPopulation !== 'none' || b.specialPopulation === 'none') &&
    (!a.automaticProgrammingAllowed || b.automaticProgrammingAllowed) &&
    (a.lowIntensityLibraryOnly || !b.lowIntensityLibraryOnly) &&
    (a.professionalGuidance || !b.professionalGuidance) &&
    covers(a.limitedJoints, b.limitedJoints) &&
    (a.heartRateZonesAllowed !== true || b.heartRateZonesAllowed === true)
  );
}

/** Reason code when the server rejected the device's latest screening (FR/EN in packages/i18n `reason.*`). */
export const REJECTED_SCREENING_REASON = 'safety_profile.not_screened.rejected' as const;

export interface ScreeningHistoryOptions {
  /**
   * FIX-B (with FIX-E): the device knows its latest screening was rejected by the server (sync removed it, so
   * the history only holds the previous, accepted one, which may be looser). Fail closed: the result is at least
   * as strict as "not screened" (S1 caps, no automatic programming, no assessment, no deficit features) until the
   * user screens again. Wired from the sync client's rejected mutations at merge.
   */
  readonly screeningRejected?: boolean;
}

/**
 * The SafetyProfile a history of screenings gives (no health-consent check:
 * callers apply it first). None → "not screened". A rejected latest screening
 * never lets an older, looser one count (options.screeningRejected).
 */
export function safetyProfileFromScreenings(screenings: readonly ScreeningEntry[], options: ScreeningHistoryOptions = {}): SafetyProfile {
  const { heads } = orderScreenings(screenings);
  if (heads.length === 0) return notScreenedSafetyProfile(options.screeningRejected ? REJECTED_SCREENING_REASON : 'safety_profile.not_screened.incomplete');
  const profile = strictestSafetyProfile(heads.map((h) => evaluateScreening(h.data.responses)));
  if (!options.screeningRejected) return profile;
  const combined = strictestSafetyProfile([profile, notScreenedSafetyProfile(REJECTED_SCREENING_REASON)]);
  // Not an ambiguity between screenings: say why (the rejection), keeping every reason of the older screening.
  return { ...combined, reasonCodes: combined.reasonCodes.filter((c) => c !== AMBIGUOUS_SCREENING_REASON) };
}

/**
 * When the user was last screened, for the 12-month re-screen (M01). Several
 * heads: the EARLIEST of them (the re-screen falls due soonest).
 */
export function lastScreenedAt(screenings: readonly ScreeningEntry[]): string | null {
  const { heads } = orderScreenings(screenings);
  if (heads.length === 0) return null;
  return heads.map((h) => h.data.completedAt).reduce((a, b) => (Date.parse(b) < Date.parse(a) ? b : a));
}

/** The record ids a new screening supersedes: every current head (so a fork is resolved by the next screening). */
export function screeningHeads(screenings: readonly ScreeningEntry[]): string[] {
  return orderScreenings(screenings).heads.map((h) => h.id);
}
