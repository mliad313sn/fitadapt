import type { SafetyInvariantId } from './invariants.js';

export interface SafetyViolation {
  readonly invariant: SafetyInvariantId;
  /** Stable reason code; FR/EN explanations live in packages/i18n. */
  readonly reasonCode: string;
}

/** A pure check: returns a violation, or null when the input is safe. */
export type SafetyCheck<I> = (input: I) => SafetyViolation | null;

export interface SafetyDecision {
  readonly allowed: boolean;
  readonly violations: readonly SafetyViolation[];
}

/**
 * Runs every check and blocks on any violation. It fails closed: a check that
 * throws counts as a violation of its invariant, so a bug can never let an
 * unsafe input through.
 */
export function evaluateSafety<I>(
  checks: ReadonlyArray<{ invariant: SafetyInvariantId; check: SafetyCheck<I> }>,
  input: I,
): SafetyDecision {
  const violations: SafetyViolation[] = [];
  for (const { invariant, check } of checks) {
    try {
      const result = check(input);
      if (result !== null) violations.push(result);
    } catch {
      violations.push({ invariant, reasonCode: 'safety.check_failed' });
    }
  }
  return Object.freeze({ allowed: violations.length === 0, violations: Object.freeze(violations) });
}
