import type { ExerciseEdge, JointLoadProfile, SafetyProfile } from '@fitadapt/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  blockingReasons,
  createExerciseGraph,
  rankSubstitutes,
  redJointsLoaded,
  substitute,
  substitutionSafetyEvent,
  SUBSTITUTION_CONFIG,
  SUBSTITUTION_REASON_CODES,
  type GraphExercise,
} from './index.js';

// Small fictional graph; the seed library has its own property tests (packages/exercise-library).
const low: JointLoadProfile = { shoulder: 'low', elbow: 'low', wrist: 'low', lumbar: 'low', hip: 'low', knee: 'low', ankle: 'low' };
const ex = (id: string, over: Partial<GraphExercise> = {}): GraphExercise => ({
  id,
  pattern: 'horizontal_push',
  skill: 'beginner',
  impact: 'none',
  jointLoad: low,
  equipment: [],
  contraindications: [],
  ...over,
});

const exercises = [
  ex('push'),
  ex('knee_push', { jointLoad: { ...low, wrist: 'medium' } }),
  ex('band_press', { equipment: [{ anyOf: ['resistance_band'] }] }),
  ex('db_press', { equipment: [{ anyOf: ['dumbbell'] }, { anyOf: ['flat_bench', 'sturdy_chair'] }], jointLoad: { ...low, shoulder: 'high' } }),
  ex('jumpy', { impact: 'high', contraindications: ['jumping_landing'] }),
  ex('expert_move', { skill: 'expert' }),
];
const sub = (from: string, to: string, similarity: number): ExerciseEdge => ({ type: 'SUBSTITUTES', from, to, similarity, source: 'test', validated: false });
const edges: ExerciseEdge[] = [
  sub('push', 'knee_push', 0.9),
  sub('push', 'band_press', 0.8),
  sub('push', 'db_press', 0.85),
  sub('push', 'jumpy', 0.95),
  sub('push', 'expert_move', 0.99),
  { type: 'PROGRESSES_TO', from: 'knee_push', to: 'push', ladderId: 'p', source: 'test', validated: false },
];
const graph = createExerciseGraph(exercises, edges);
// M01 extended SafetyProfile; the added fields take their unrestricted values.
const open: SafetyProfile = { maxRPE: 10, allowHIIT: true, allowMaxTests: true, impactCeiling: 'high', avoidTags: [], excludedExerciseIds: [], screeningOutcome: 'cleared', unresolvedFlags: [], deficitNutritionAllowed: true, specialPopulation: 'none', automaticProgrammingAllowed: true, lowIntensityLibraryOnly: false, professionalGuidance: false, limitedJoints: [], reasonCodes: [], rulesVersion: '0.1.0' };

describe('substitution over a graph', () => {
  it('picks the highest-similarity valid option and skips too-large skill jumps', () => {
    expect(substitute(graph, 'push', [], {}, open)?.exerciseId).toBe('jumpy');
    expect(rankSubstitutes(graph, 'push', [], {}, open).map((r) => r.exerciseId)).toEqual(['jumpy', 'knee_push']);
  });

  it('respects the impact ceiling and avoided tags', () => {
    expect(substitute(graph, 'push', [], {}, { ...open, impactCeiling: 'low' })?.exerciseId).toBe('knee_push');
    expect(substitute(graph, 'push', [], {}, { ...open, avoidTags: ['jumping_landing'] })?.exerciseId).toBe('knee_push');
  });

  it('excludes candidates that load a red joint at medium/high (S2) and reports the original’s red joints', () => {
    const r = substitute(graph, 'push', new Set(['resistance_band'] as const), { wrist: 'red' }, { ...open, impactCeiling: 'none' });
    expect(r?.exerciseId).toBe('band_press');
    expect(redJointsLoaded(exercises[1]!, { wrist: 'red' })).toEqual(['wrist']);
    const blockedOriginal = substitute(graph, 'knee_push', [], { wrist: 'red' }, open);
    expect(blockedOriginal).toBeNull();
    expect(blockingReasons(exercises[1]!, [], { wrist: 'red' }, open)).toEqual([{ code: 'substitution.joint_red', joint: 'wrist' }]);
  });

  it('needs every equipment group (any item of a group)', () => {
    const base = { ...open, impactCeiling: 'none' as const };
    expect(rankSubstitutes(graph, 'push', ['dumbbell'], {}, base).map((r) => r.exerciseId)).toEqual(['knee_push']);
    expect(rankSubstitutes(graph, 'push', ['dumbbell', 'sturdy_chair'], {}, base).map((r) => r.exerciseId)).toEqual(['knee_push', 'db_press']);
  });

  it('penalises amber joints and explains when the original loaded them', () => {
    const base = { ...open, impactCeiling: 'none' as const };
    const ranked = rankSubstitutes(graph, 'push', ['resistance_band'], { wrist: 'amber' }, base);
    // knee_push (0.9) loses 0.1 for the amber wrist and ties band_press (0.8); the higher raw similarity breaks the tie.
    expect(ranked.map((r) => [r.exerciseId, r.score])).toEqual([
      ['knee_push', 0.8],
      ['band_press', 0.8],
    ]);
    const fromKnee = rankSubstitutes(createExerciseGraph(exercises, [sub('knee_push', 'band_press', 0.7)]), 'knee_push', ['resistance_band'], { wrist: 'amber' }, open);
    expect(fromKnee[0]?.reasons).toEqual([{ code: 'substitution.joint_amber', joint: 'wrist' }, { code: 'substitution.highest_similarity' }]);
  });

  it('lists why the original is blocked', () => {
    const r = substitute(graph, 'db_press', [], {}, { ...open, excludedExerciseIds: ['db_press'] });
    expect(r).toBeNull();
    expect(blockingReasons(exercises[3]!, [], { shoulder: 'red' }, { ...open, excludedExerciseIds: ['db_press'] }).map((x) => x.code)).toEqual([
      'substitution.excluded_by_user',
      'substitution.equipment_unavailable',
      'substitution.joint_red',
    ]);
    expect(blockingReasons(exercises[4]!, [], {}, { ...open, impactCeiling: 'low', avoidTags: ['jumping_landing'] }).map((x) => x.code)).toEqual([
      'substitution.impact_above_ceiling',
      'substitution.avoid_tag',
    ]);
  });

  it('builds the S2 safety event only for red-joint substitutions', () => {
    const forced = substitute(graph, 'knee_push', [], {}, open);
    expect(substitutionSafetyEvent(forced)).toBeNull();
    const g = createExerciseGraph(exercises, [sub('knee_push', 'push', 0.9)]);
    expect(substitutionSafetyEvent(substitute(g, 'knee_push', [], { wrist: 'red' }, open))).toEqual({ invariant: 'S2', reasonCode: 'substitution.joint_red', action: 'substituted' });
  });

  it('accepts an exercise object, rejects unknown exercises and dangling edges', () => {
    expect(substitute(graph, exercises[0]!, [], {}, open)?.exerciseId).toBe('jumpy');
    expect(() => substitute(graph, 'nope', [], {}, open)).toThrow(/unknown exercise nope/);
    expect(() => substitute(graph, ex('nope'), [], {}, open)).toThrow(/unknown exercise nope/);
    expect(() => createExerciseGraph(exercises, [sub('push', 'ghost', 0.5)])).toThrow(/unknown exercise/);
    expect(substitute(graph, 'expert_move', [], {}, open)).toBeNull();
  });

  it('ties break deterministically on id, whatever the edge order', () => {
    const tied = [sub('push', 'knee_push', 0.5), sub('push', 'band_press', 0.5), sub('push', 'db_press', 0.5)];
    for (const order of [tied, [...tied].reverse()]) {
      const g = createExerciseGraph(exercises, order);
      expect(rankSubstitutes(g, 'push', ['resistance_band', 'dumbbell', 'flat_bench'], {}, open).map((r) => r.exerciseId)).toEqual(['band_press', 'db_press', 'knee_push']);
    }
  });

  it('ties break deterministically on id', () => {
    const g = createExerciseGraph(exercises, [sub('push', 'knee_push', 0.5), sub('push', 'band_press', 0.5)]);
    expect(rankSubstitutes(g, 'push', ['resistance_band'], {}, open).map((r) => r.exerciseId)).toEqual(['band_press', 'knee_push']);
  });

  it('property: never returns a red-loading candidate, whatever the flags', () => {
    fc.assert(
      fc.property(fc.constantFrom('push', 'knee_push', 'db_press'), fc.constantFrom('green', 'amber', 'red'), fc.constantFrom('green', 'amber', 'red'), (id, wrist, shoulder) => {
        const r = substitute(graph, id, ['resistance_band', 'dumbbell', 'flat_bench'], { wrist, shoulder } as never, open);
        if (!r) return;
        const chosen = graph.exercises.get(r.exerciseId)!;
        if (wrist === 'red') expect(chosen.jointLoad.wrist).toBe('low');
        if (shoulder === 'red') expect(chosen.jointLoad.shoulder).toBe('low');
      }),
    );
  });

  it('config values carry a source and stay unvalidated; reason codes are listed', () => {
    for (const v of Object.values(SUBSTITUTION_CONFIG)) expect(v).toMatchObject({ validated: false });
    expect(SUBSTITUTION_REASON_CODES).toHaveLength(8);
  });
});
