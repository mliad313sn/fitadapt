import type { PairEvent, PairSharingScope } from '@fitadapt/shared';

/**
 * M09 Fair Pair privacy projection (ADR-021): what one partner may learn
 * about the other. The same rules on the device (single-device partner view,
 * what a device sends) and on the server (what it relays), so a modified
 * client cannot widen them.
 *
 * - `scopes === null`: the person has not granted (or has withdrawn) the M17
 *   `partner_sharing` consent — nothing at all is shared.
 * - With the consent: their display name, turns and set positions.
 * - 'performance': exercise names, reps, seconds, loads, reps in reserve.
 * - 'bodyweight': their body weight (off by default; hidden otherwise).
 * - 'challenge': their Fair Challenge score.
 * Pain reports, red flags and safety stops, screening answers and the
 * SafetyProfile are never shared under any scope.
 */
export type PartnerScopes = readonly PairSharingScope[] | null;

const has = (scopes: PartnerScopes, scope: PairSharingScope) => scopes !== null && scopes.includes(scope);

/** An event as the partner may receive it, or null when nothing of it may be shared. */
export function projectPairEvent(event: PairEvent, scopes: PartnerScopes): PairEvent | null {
  if (scopes === null) return null;
  switch (event.type) {
    case 'plan':
      return {
        type: 'plan',
        outline: {
          planId: event.outline.planId,
          exercises: event.outline.exercises.map((e) => ({
            slot: e.slot,
            exerciseId: has(scopes, 'performance') ? e.exerciseId : null,
            sets: e.sets.map((s) => ({ workSeconds: s.workSeconds, restSeconds: s.restSeconds, loadKg: has(scopes, 'performance') ? s.loadKg : null })),
          })),
        },
      };
    case 'turn':
      return { ...event, performance: has(scopes, 'performance') ? event.performance : null };
    case 'left':
      return { type: 'left' };
    case 'score':
      return has(scopes, 'challenge') ? event : null;
    case 'bodyweight':
      return has(scopes, 'bodyweight') ? event : null;
  }
}

/** What a participant's card shows to their partner (single device): only what that participant chose to share. */
export interface PartnerFacts {
  readonly displayName: string;
  readonly bodyweightKg: number | null;
  readonly exerciseId: string | null;
  readonly loadKg: number | null;
  readonly score: number | null;
}

export interface PartnerView {
  readonly displayName: string | null;
  readonly bodyweightKg: number | null;
  readonly exerciseId: string | null;
  readonly loadKg: number | null;
  readonly score: number | null;
}

export function partnerView(facts: PartnerFacts, scopes: PartnerScopes): PartnerView {
  if (scopes === null) return { displayName: null, bodyweightKg: null, exerciseId: null, loadKg: null, score: null };
  return {
    displayName: facts.displayName,
    bodyweightKg: has(scopes, 'bodyweight') ? facts.bodyweightKg : null,
    exerciseId: has(scopes, 'performance') ? facts.exerciseId : null,
    loadKg: has(scopes, 'performance') ? facts.loadKg : null,
    score: has(scopes, 'challenge') ? facts.score : null,
  };
}

/** The Fair Challenge is on only when both partners chose it (off by default). */
export const challengeOn = (a: PartnerScopes, b: PartnerScopes): boolean => has(a, 'challenge') && has(b, 'challenge');
