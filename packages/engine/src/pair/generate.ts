import type { EquipmentId, EquipmentLoads, SessionPlan, SessionSafetyEventValue, SharedTimeline } from '@fitadapt/shared';
import type { EngineContext } from '../context.js';
import { createEngineContext } from '../context.js';
import { generateSession } from '../session/generate.js';
import type { SessionLibrary } from '../session/library.js';
import type { GenerateSessionInput } from '../session/types.js';
import { mergePlans } from './merge.js';

/** The shared place both partners train at today (the Anywhere Switcher for each of them). */
export interface SharedPlace {
  readonly equipment: readonly EquipmentId[];
  readonly equipmentLoads: EquipmentLoads | null;
  readonly equipmentProfileId: string | null;
}

export type PartnerResult =
  | { readonly status: 'ok'; readonly plan: SessionPlan; readonly safetyEvents: readonly SessionSafetyEventValue[] }
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
 * The only thing the pair changes in each input is the place (equipment,
 * loads), exactly as the Anywhere Switcher does for a person training
 * elsewhere today. Every gate of generateSession applies to each partner on
 * their own: if one of them gets no session (S1, S3, S7, not screened…),
 * there is no pair session, and each reason stays with its own person.
 */
export function generatePairSession(inputA: GenerateSessionInput, inputB: GenerateSessionInput, place: SharedPlace, library: SessionLibrary, ctx: EngineContext): PairSessionResult {
  const at = (input: GenerateSessionInput): GenerateSessionInput => ({ ...input, equipment: place.equipment, equipmentLoads: place.equipmentLoads, equipmentProfileId: place.equipmentProfileId });
  const run = (input: GenerateSessionInput, slot: 'a' | 'b'): PartnerResult => {
    const result = generateSession(at(input), library, createEngineContext({ clock: ctx.clock, seed: partnerSeed(ctx.seed, slot) }));
    return result.status === 'ok' ? { status: 'ok', plan: result.plan, safetyEvents: result.safetyEvents } : { status: 'unavailable', reasonCodes: result.reasonCodes };
  };
  const a = run(inputA, 'a');
  const b = run(inputB, 'b');
  if (a.status !== 'ok' || b.status !== 'ok') return { status: 'unavailable', a, b };
  return { status: 'ok', a, b, timeline: mergePlans(a.plan, b.plan, { items: place.equipment, graph: library.graph }) };
}
