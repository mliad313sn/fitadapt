import { blockingReasons, hasEquipment, substitutionSafetyEvent } from '@fitadapt/engine';
import { en, fr } from '@fitadapt/i18n';
import {
  CONTRAINDICATION_TAGS,
  EQUIPMENT_IDS,
  IMPACT_LEVELS,
  JOINTS,
  JOINT_FLAGS,
  impactRank,
  skillRank,
  type EquipmentId,
  type JointFlags,
  type SafetyProfile,
} from '@fitadapt/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EQUIPMENT_PRESETS, rankSubstitutes, seedLibrary, substitute, UNRESTRICTED_SAFETY_PROFILE } from './index.js';

/** Goal condition (4): substitute(exercise, equipment, jointFlags, safetyProfile). */
const lib = seedLibrary();
const ids = lib.exercises.map((e) => e.id);

const arbEquipment = fc.oneof(
  fc.constantFrom(...Object.values(EQUIPMENT_PRESETS).map((p) => [...p])),
  fc.subarray([...EQUIPMENT_IDS] as EquipmentId[]),
);
const arbFlags: fc.Arbitrary<JointFlags> = fc.dictionary(fc.constantFrom(...JOINTS), fc.constantFrom(...JOINT_FLAGS)) as fc.Arbitrary<JointFlags>;
const arbProfile: fc.Arbitrary<SafetyProfile> = fc.record({
  maxRPE: fc.integer({ min: 5, max: 10 }),
  allowHIIT: fc.boolean(),
  allowMaxTests: fc.boolean(),
  impactCeiling: fc.constantFrom(...IMPACT_LEVELS),
  avoidTags: fc.subarray([...CONTRAINDICATION_TAGS]),
  excludedExerciseIds: fc.subarray(ids, { maxLength: 5 }),
  // M01 extended SafetyProfile; the substitution filters do not read these fields.
  screeningOutcome: fc.constant('cleared' as const),
  unresolvedFlags: fc.constant([]),
  deficitNutritionAllowed: fc.constant(true),
  specialPopulation: fc.constant('none' as const),
  automaticProgrammingAllowed: fc.constant(true),
  lowIntensityLibraryOnly: fc.constant(false),
  professionalGuidance: fc.constant(false),
  limitedJoints: fc.constant([]),
  reasonCodes: fc.constant([]),
  rulesVersion: fc.constant('0.1.0'),
});

describe('substitute', () => {
  it('never returns an exercise loading a red joint at medium/high, needing missing equipment, above the impact ceiling or with an avoided tag', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ids), arbEquipment, arbFlags, arbProfile, (id, equipment, flags, profile) => {
        const result = substitute(id, equipment, flags, profile);
        if (result === null) return;
        const chosen = lib.byId.get(result.exerciseId)!;
        expect(chosen.id).not.toBe(id);
        for (const joint of JOINTS) if (flags[joint] === 'red') expect(chosen.jointLoad[joint], `${chosen.id} ${joint}`).toBe('low');
        expect(hasEquipment(chosen, new Set(equipment))).toBe(true);
        expect(chosen.equipment.every((g) => g.anyOf.some((x) => equipment.includes(x)))).toBe(true);
        expect(impactRank(chosen.impact)).toBeLessThanOrEqual(impactRank(profile.impactCeiling));
        expect(chosen.contraindications.some((t) => profile.avoidTags.includes(t))).toBe(false);
        expect(profile.excludedExerciseIds).not.toContain(chosen.id);
      }),
      { numRuns: 3000, seed: 20260923 },
    );
  });

  it('returns the highest-similarity valid option (brute force over every SUBSTITUTES edge)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ids), arbEquipment, arbFlags, arbProfile, (id, equipment, flags, profile) => {
        const original = lib.byId.get(id)!;
        const valid = lib.edges
          .filter((e) => e.type === 'SUBSTITUTES' && e.from === id)
          .map((e) => ({ e, x: lib.byId.get(e.to)! }))
          .filter(({ x }) => skillRank(x.skill) <= skillRank(original.skill) + 1 && blockingReasons(x, equipment, flags, profile).length === 0)
          .map(({ e, x }) => ({ id: x.id, similarity: e.type === 'SUBSTITUTES' ? e.similarity : 0, amber: JOINTS.filter((j) => flags[j] === 'amber' && x.jointLoad[j] !== 'low').length }));
        const result = substitute(id, equipment, flags, profile);
        if (valid.length === 0) {
          expect(result).toBeNull();
          return;
        }
        const best = Math.max(...valid.map((v) => Math.round((v.similarity - 0.1 * v.amber) * 1000) / 1000));
        expect(result?.score).toBe(best);
        if (!Object.values(flags).includes('amber')) expect(result?.similarity).toBe(Math.max(...valid.map((v) => v.similarity)));
      }),
      { numRuns: 1500, seed: 7 },
    );
  });

  it('S2: a red wrist swaps a push-up for a low-wrist option and yields an S2 safety event', () => {
    const result = substitute('push_up', EQUIPMENT_PRESETS.home_basic, { wrist: 'red' }, UNRESTRICTED_SAFETY_PROFILE);
    expect(result).not.toBeNull();
    expect(lib.byId.get(result!.exerciseId)!.jointLoad.wrist).toBe('low');
    expect(result!.reasons).toEqual(expect.arrayContaining([{ code: 'substitution.joint_red', joint: 'wrist' }, { code: 'substitution.highest_similarity' }]));
    expect(substitutionSafetyEvent(result)).toEqual({ invariant: 'S2', reasonCode: 'substitution.joint_red', action: 'substituted' });
  });

  it('a red knee never yields a knee-loading substitute for a jump squat: with the seed there is none, so the slot is dropped', () => {
    const result = substitute('squat_jump', EQUIPMENT_PRESETS.full_gym, { knee: 'red' }, UNRESTRICTED_SAFETY_PROFILE);
    // Every squat-pattern option loads the knee at medium or high; the S2 filter leaves nothing rather than a knee-loading option.
    expect(result).toBeNull();
  });

  it('P1 at home with an amber knee history: a goblet squat alternative loads the knee less when possible', () => {
    const ranked = rankSubstitutes('goblet_squat', EQUIPMENT_PRESETS.home_basic, { knee: 'amber' }, UNRESTRICTED_SAFETY_PROFILE);
    expect(ranked.length).toBeGreaterThan(0);
    for (let i = 1; i < ranked.length; i++) expect(ranked[i - 1]!.score).toBeGreaterThanOrEqual(ranked[i]!.score);
  });

  it('P4: impact ceiling "low" and a hypothetical avoid list keep substitutes low-impact', () => {
    const profile: SafetyProfile = { ...UNRESTRICTED_SAFETY_PROFILE, impactCeiling: 'low', avoidTags: ['jumping_landing', 'floor_transfer'] };
    const result = substitute('jumping_jack', [], {}, profile);
    expect(result).not.toBeNull();
    const chosen = lib.byId.get(result!.exerciseId)!;
    expect(impactRank(chosen.impact)).toBeLessThanOrEqual(impactRank('low'));
    expect(result!.reasons.map((r) => r.code)).toEqual(expect.arrayContaining(['substitution.impact_above_ceiling', 'substitution.avoid_tag']));
  });

  it('returns null when nothing is valid, and reports it', () => {
    const allRed: JointFlags = Object.fromEntries(JOINTS.map((j) => [j, 'red'])) as JointFlags;
    expect(substitute('pull_up', [], allRed, UNRESTRICTED_SAFETY_PROFILE)).toBeNull();
    expect(substitutionSafetyEvent(null)).toBeNull();
    expect(() => substitute('no_such_exercise', [], {}, UNRESTRICTED_SAFETY_PROFILE)).toThrow(/unknown exercise/);
  });

  it('every substitution reason code has FR and EN wording', () => {
    for (const code of ['highest_similarity', 'equipment_unavailable', 'joint_red', 'joint_amber', 'impact_above_ceiling', 'avoid_tag', 'excluded_by_user', 'none_available']) {
      const key = `engine.reason.substitution.${code}` as keyof typeof en;
      expect(en[key]).toBeTruthy();
      expect(fr[key]).toBeTruthy();
    }
  });

  it('p95 query time is under 20 ms on the seed', () => {
    const rng = fc.sample(fc.tuple(fc.constantFrom(...ids), arbEquipment, arbFlags, arbProfile), { numRuns: 2000, seed: 42 });
    const times: number[] = [];
    for (const [id, equipment, flags, profile] of rng) {
      const t0 = performance.now();
      substitute(id, equipment, flags, profile);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)]!;
    expect(p95).toBeLessThan(20);
    // Reported in docs/status/M06.md.
    process.stdout.write(`substitute p95 over ${times.length} queries: ${p95.toFixed(3)} ms (max ${times.at(-1)!.toFixed(3)} ms)\n`);
  });
});
