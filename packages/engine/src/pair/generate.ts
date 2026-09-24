import type { EquipmentId, EquipmentLoads, SessionPlan, SessionSafetyEventValue, SharedTimeline } from '@fitadapt/shared';
import type { EngineContext } from '../context.js';
import { createEngineContext } from '../context.js';
import { generateSession } from '../session/generate.js';
import type { SessionLibrary } from '../session/library.js';
import type { GenerateSessionInput } from '../session/types.js';
import { PAIR_CONFIG } from './config.js';
import { mergePlans } from './merge.js';

/** The shared place both partners train at today (the Anywhere Switcher for each of them). */
export interface SharedPlace {
  readonly equipment: readonly EquipmentId[];
  readonly equipmentLoads: EquipmentLoads | null;
  readonly equipmentProfileId: string | null;
}

export type PartnerResult =
  /** `input` is the input the plan was generated from (the shared place, the shared minutes): record it with the plan. */
  | { readonly status: 'ok'; readonly plan: SessionPlan; readonly safetyEvents: readonly SessionSafetyEventValue[]; readonly input: GenerateSessionInput }
  | { readonly status: 'unavailable'; readonly reasonCodes: readonly string[] };

export type PairSessionResult =
  | { readonly status: 'ok'; readonly a: PartnerResult & { status: 'ok' }; readonly b: PartnerResult & { status: 'ok' }; readonly timeline: SharedTimeline }
  /** One partner (or both) cannot train today: each result says why, only to its own person. */
  | { readonly status: 'unavailable'; readonly a: PartnerResult; readonly b: PartnerResult };

/** Each partner's seed is derived from the pair seed; the plans record them (deterministic). */
export const partnerSeed = (seed: number, slot: 'a' | 'b') => (slot === 'a' ? seed : (seed + 7919) % 2_147_483_647);

/**
 * A pair session: each partner's plan from the one generator (M02
 * generateSession: their own SafetyProfile, joint flags, history, capacity,
 * program, S3 lock and age — never a merged or averaged profile), both for
 * the shared place's equipment, then one shared timeline (mergePlans).
 *
 * The only things the pair changes in each input are the place (equipment,
 * loads), exactly as the Anywhere Switcher does for a person training
 * elsewhere today, and the minutes: the time both have, lowered in steps
 * until the turns fit it (the engine's own time-boxing trims each plan;
 * never below `time.minimumMinutes`). Each result carries the input its plan
 * came from, to be recorded with it. Every gate of generateSession applies to each partner on
 * their own: if one of them gets no session (S1, S3, S7, not screened…),
 * there is no pair session, and each reason stays with its own person.
 */
export function generatePairSession(inputA: GenerateSessionInput, inputB: GenerateSessionInput, place: SharedPlace, library: SessionLibrary, ctx: EngineContext): PairSessionResult {
  const at = (input: GenerateSessionInput, minutes: number): GenerateSessionInput => ({ ...input, equipment: place.equipment, equipmentLoads: place.equipmentLoads, equipmentProfileId: place.equipmentProfileId, minutesAvailable: minutes });
  const run = (raw: GenerateSessionInput, slot: 'a' | 'b', minutes: number): PartnerResult => {
    const input = at(raw, minutes);
    const result = generateSession(input, library, createEngineContext({ clock: ctx.clock, seed: partnerSeed(ctx.seed, slot) }));
    return result.status === 'ok' ? { status: 'ok', plan: result.plan, safetyEvents: result.safetyEvents, input } : { status: 'unavailable', reasonCodes: result.reasonCodes };
  };
  // The time both have. Turns make the pair session longer than either plan alone, so both are generated for
  // fewer minutes (the engine's own time-boxing: accessories first) until the shared timeline fits.
  const budget = Math.min(inputA.minutesAvailable, inputB.minutesAvailable);
  const step = PAIR_CONFIG['time.stepMinutes'].value;
  const floor = Math.min(budget, PAIR_CONFIG['time.minimumMinutes'].value);
  let best: PairSessionResult | null = null;
  for (let minutes = budget; minutes >= floor; minutes -= step) {
    const a = run(inputA, 'a', minutes);
    const b = run(inputB, 'b', minutes);
    if (a.status !== 'ok' || b.status !== 'ok') return best ?? { status: 'unavailable', a, b };
    const timeline = mergePlans(a.plan, b.plan, { items: place.equipment, graph: library.graph });
    const fits = timeline.totalSeconds <= budget * 60;
    const codes = [...timeline.reasonCodes, ...(minutes < budget ? ['pair.session.time_shared'] : []), ...(fits ? [] : ['pair.session.over_time'])];
    best = { status: 'ok', a, b, timeline: { ...timeline, reasonCodes: codes } };
    if (fits || minutes - step < floor) return best;
  }
  /* c8 ignore next */
  return best!;
}
