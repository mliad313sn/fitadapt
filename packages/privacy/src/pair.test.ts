import { PAIR_SHARING_SCOPES, PairEventSchema, type PairEvent, type PairSharingScope } from '@fitadapt/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FEATURE_CONSENTS, isFeatureEnabled } from './features.js';
import { challengeOn, partnerView, projectPairEvent } from './pair.js';

const PLAN = '00000000-0000-4000-8000-000000000001';
const events: PairEvent[] = [
  { type: 'plan', outline: { planId: PLAN, exercises: [{ slot: 'squat', exerciseId: 'goblet_squat', sets: [{ workSeconds: 30, restSeconds: 90, loadKg: 10 }] }] } },
  { type: 'turn', exerciseIndex: 0, setIndex: 0, status: 'done', performance: { exerciseId: 'goblet_squat', reps: 10, seconds: null, loadKg: 10, rir: 2 } },
  { type: 'left' },
  { type: 'score', points: 92.5, status: 'complete' },
  { type: 'bodyweight', kg: 120 },
];
const facts = { displayName: 'Ibrahima', bodyweightKg: 120, exerciseId: 'goblet_squat', loadKg: 10, score: 96 };

describe('Fair Pair privacy projection (goal conditions 6 and 7)', () => {
  it('without the partner_sharing consent nothing at all is shared', () => {
    for (const e of events) expect(projectPairEvent(e, null)).toBeNull();
    expect(partnerView(facts, null)).toEqual({ displayName: null, bodyweightKg: null, exerciseId: null, loadKg: null, score: null });
    expect(FEATURE_CONSENTS['pair.share_with_partner']).toEqual(['partner_sharing']);
    expect(isFeatureEnabled('pair.share_with_partner', [])).toBe(false);
  });

  it('body weight is hidden from the partner unless its owner opted in', () => {
    expect(partnerView(facts, []).bodyweightKg).toBeNull();
    expect(partnerView(facts, ['performance', 'challenge']).bodyweightKg).toBeNull();
    expect(projectPairEvent({ type: 'bodyweight', kg: 120 }, ['performance', 'challenge'])).toBeNull();
    expect(partnerView(facts, ['bodyweight']).bodyweightKg).toBe(120);
    expect(projectPairEvent({ type: 'bodyweight', kg: 120 }, ['bodyweight'])).toEqual({ type: 'bodyweight', kg: 120 });
  });

  it('with the consent only: the name, turns and set positions; exercises and loads need "performance"; the score needs "challenge"', () => {
    expect(partnerView(facts, [])).toEqual({ displayName: 'Ibrahima', bodyweightKg: null, exerciseId: null, loadKg: null, score: null });
    expect(projectPairEvent(events[0]!, [])).toEqual({ type: 'plan', outline: { planId: PLAN, exercises: [{ slot: 'squat', exerciseId: null, sets: [{ workSeconds: 30, restSeconds: 90, loadKg: null }] }] } });
    expect(projectPairEvent(events[1]!, [])).toEqual({ ...events[1], performance: null });
    expect(projectPairEvent(events[1]!, ['performance'])).toEqual(events[1]);
    expect(projectPairEvent(events[3]!, ['performance'])).toBeNull();
    expect(projectPairEvent(events[3]!, ['challenge'])).toEqual(events[3]);
    expect(projectPairEvent({ type: 'left' }, [])).toEqual({ type: 'left' });
  });

  it('the Fair Challenge is off by default and on only when both chose it', () => {
    expect(challengeOn(null, null)).toBe(false);
    expect(challengeOn([], [])).toBe(false);
    expect(challengeOn(['challenge'], [])).toBe(false);
    expect(challengeOn(['challenge'], null)).toBe(false);
    expect(challengeOn(['challenge'], ['challenge', 'performance'])).toBe(true);
  });

  it('property: a projection never adds anything, is still a valid event, and never carries a field a missing scope protects', () => {
    const scopesArb = fc.option(fc.subarray([...PAIR_SHARING_SCOPES]), { nil: null }) as fc.Arbitrary<PairSharingScope[] | null>;
    fc.assert(
      fc.property(fc.constantFrom(...events), scopesArb, (event, scopes) => {
        const out = projectPairEvent(event, scopes);
        if (out === null) return;
        expect(PairEventSchema.parse(out)).toEqual(out);
        const json = JSON.stringify(out);
        if (!scopes?.includes('bodyweight')) expect(json).not.toContain('"kg"');
        if (!scopes?.includes('performance')) {
          expect(json).not.toContain('goblet_squat');
          expect(json).not.toMatch(/"reps":\d/);
        }
        if (!scopes?.includes('challenge')) expect(out.type).not.toBe('score');
        // Nothing is invented: every key of the projection exists in the event.
        expect(Object.keys(out).every((k) => k in event)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });
});
