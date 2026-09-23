/**
 * Safety invariants S1–S7 (docs/specs/00-product-vision.md). This module only
 * declares them; the rules are implemented by the modules that own them
 * (M01, M02, M05, M10, M11). They are not configurable: there is no switch,
 * flag or option to disable an invariant, and the registry is frozen.
 */
export const SAFETY_INVARIANT_IDS = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'] as const;
export type SafetyInvariantId = (typeof SAFETY_INVARIANT_IDS)[number];

export interface SafetyInvariant {
  readonly id: SafetyInvariantId;
  /** Internal identifier, not user-facing copy (copy lives in packages/i18n). */
  readonly key: string;
  /** Module that implements the rule. */
  readonly ownerModule: string;
}

const registry: readonly SafetyInvariant[] = [
  { id: 'S1', key: 'screening_gate', ownerModule: 'M01' },
  { id: 'S2', key: 'pain_gate', ownerModule: 'M05' },
  { id: 'S3', key: 'red_flag_stop', ownerModule: 'M05' },
  { id: 'S4', key: 'nutrition_floors', ownerModule: 'M10' },
  { id: 'S5', key: 'load_ceiling', ownerModule: 'M02' },
  { id: 'S6', key: 'ai_boundary', ownerModule: 'M11' },
  { id: 'S7', key: 'special_populations', ownerModule: 'M01' },
];

export const SAFETY_INVARIANTS: readonly SafetyInvariant[] = Object.freeze(registry.map((i) => Object.freeze({ ...i })));

export function isSafetyInvariantId(value: string): value is SafetyInvariantId {
  return (SAFETY_INVARIANT_IDS as readonly string[]).includes(value);
}
