import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  SAFETY_INVARIANTS,
  SAFETY_INVARIANT_IDS,
  evaluateSafety,
  isSafetyInvariantId,
  type SafetyCheck,
} from './index.js';

describe('safety invariant registry', () => {
  it('declares exactly S1–S7', () => {
    expect(SAFETY_INVARIANTS.map((i) => i.id)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7']);
  });
  it('is frozen and cannot be reconfigured at runtime', () => {
    expect(Object.isFrozen(SAFETY_INVARIANTS)).toBe(true);
    expect(SAFETY_INVARIANTS.every((i) => Object.isFrozen(i))).toBe(true);
    expect(() => {
      (SAFETY_INVARIANTS as unknown as unknown[]).pop();
    }).toThrow(TypeError);
  });
  it('recognises invariant ids', () => {
    expect(SAFETY_INVARIANT_IDS.every(isSafetyInvariantId)).toBe(true);
    expect(isSafetyInvariantId('S8')).toBe(false);
  });
});

describe('evaluateSafety', () => {
  const pass: SafetyCheck<number> = () => null;
  const blockAbove = (limit: number): SafetyCheck<number> => (n) =>
    n > limit ? { invariant: 'S5', reasonCode: 'test.above_limit' } : null;

  it('allows when every check passes', () => {
    expect(evaluateSafety([{ invariant: 'S1', check: pass }], 1)).toEqual({ allowed: true, violations: [] });
  });

  it('fails closed when a check throws', () => {
    const boom: SafetyCheck<number> = () => {
      throw new Error('bug');
    };
    const decision = evaluateSafety([{ invariant: 'S3', check: boom }], 1);
    expect(decision.allowed).toBe(false);
    expect(decision.violations).toEqual([{ invariant: 'S3', reasonCode: 'safety.check_failed' }]);
  });

  it('never allows an input that any check rejects (property)', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (limit, n) => {
        const decision = evaluateSafety(
          [
            { invariant: 'S1', check: pass },
            { invariant: 'S5', check: blockAbove(limit) },
          ],
          n,
        );
        return decision.allowed === !(n > limit) && Object.isFrozen(decision);
      }),
    );
  });
});
