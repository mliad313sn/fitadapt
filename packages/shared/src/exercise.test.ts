import { describe, expect, it } from 'vitest';
import {
  ContentVersionSchema,
  CustomExerciseSchema,
  EquipmentSchema,
  ExerciseEdgeSchema,
  ExerciseSchema,
  JointFlagsSchema,
  MediaAssetSchema,
  MuscleSchema,
  PublishedMediaAssetSchema,
  SafetyProfileSchema,
  impactRank,
  skillRank,
  type Exercise,
} from './index.js';

// Fictional fixture, not seed content.
const base: Exercise = {
  id: 'sample_move',
  contentVersion: 1,
  nameKey: 'exercise.sample_move.name',
  cueKeys: ['exercise.sample_move.cue.1'],
  mistakeKeys: ['exercise.sample_move.mistake.1'],
  pattern: 'squat',
  primaryMuscles: ['quads'],
  secondaryMuscles: ['glutes'],
  equipment: [{ anyOf: ['dumbbell', 'kettlebell'] }],
  jointLoad: { shoulder: 'low', elbow: 'low', wrist: 'low', lumbar: 'medium', hip: 'medium', knee: 'medium', ankle: 'low' },
  impact: 'none',
  skill: 'beginner',
  unilateral: false,
  loadType: 'external',
  bodyweightLoad: null,
  contraindications: [],
  tags: [],
  mediaAssetIds: [],
  source: 'test fixture',
  validated: false,
  reviewStatus: 'pending',
  review: { physio: null, coach: null },
};
const mark = { seat: 'A2', signOff: 'docs/governance/sign-offs/x.md', reviewedAt: '2027-01-01T00:00:00.000Z' };

describe('M06 schemas', () => {
  it('accepts a well-formed exercise', () => {
    expect(ExerciseSchema.parse(base)).toEqual(base);
  });

  it('requires all seven joints in the joint-load profile', () => {
    const { ankle: _ankle, ...partial } = base.jointLoad;
    expect(ExerciseSchema.safeParse({ ...base, jointLoad: partial }).success).toBe(false);
    expect(ExerciseSchema.safeParse({ ...base, jointLoad: { ...base.jointLoad, neck: 'low' } }).success).toBe(false);
  });

  it('refuses validated:true without validatedBy, signOff and the physio-review flag', () => {
    expect(ExerciseSchema.safeParse({ ...base, validated: true }).success).toBe(false);
    expect(ExerciseSchema.safeParse({ ...base, validated: true, validatedBy: 'A2', signOff: 'x.md' }).success).toBe(false);
    expect(ExerciseSchema.safeParse({ ...base, validated: true, validatedBy: 'A2', signOff: 'x.md', review: { physio: mark, coach: null } }).success).toBe(true);
  });

  it('approved content needs both reviews', () => {
    expect(ExerciseSchema.safeParse({ ...base, reviewStatus: 'approved', review: { physio: mark, coach: null } }).success).toBe(false);
    expect(ExerciseSchema.safeParse({ ...base, reviewStatus: 'approved', review: { physio: mark, coach: { ...mark, seat: 'A3' } } }).success).toBe(true);
  });

  it('bodyweight coefficient only and always for bodyweight moves', () => {
    const bw = { value: 0.6, unit: 'fraction_of_body_mass', source: 'estimate', validated: false };
    expect(ExerciseSchema.safeParse({ ...base, loadType: 'bodyweight' }).success).toBe(false);
    expect(ExerciseSchema.safeParse({ ...base, loadType: 'bodyweight', bodyweightLoad: bw }).success).toBe(true);
    expect(ExerciseSchema.safeParse({ ...base, bodyweightLoad: bw }).success).toBe(false);
    expect(ExerciseSchema.safeParse({ ...base, loadType: 'bodyweight', bodyweightLoad: { ...bw, validated: true } }).success).toBe(false);
  });

  it('text keys must belong to the exercise; a muscle cannot be primary and secondary', () => {
    expect(ExerciseSchema.safeParse({ ...base, cueKeys: ['exercise.other.cue.1'] }).success).toBe(false);
    expect(ExerciseSchema.safeParse({ ...base, secondaryMuscles: ['quads'] }).success).toBe(false);
    expect(ExerciseSchema.safeParse({ ...base, id: 'Bad Id' }).success).toBe(false);
  });

  it('typed edges', () => {
    const e = { source: 's', validated: false };
    expect(ExerciseEdgeSchema.safeParse({ type: 'PROGRESSES_TO', from: 'a1', to: 'b1', ladderId: 'l1', ...e }).success).toBe(true);
    expect(ExerciseEdgeSchema.safeParse({ type: 'REGRESSES_TO', from: 'b1', to: 'a1', ladderId: 'l1', ...e }).success).toBe(true);
    expect(ExerciseEdgeSchema.safeParse({ type: 'SUBSTITUTES', from: 'a1', to: 'b1', similarity: 0.7, ...e }).success).toBe(true);
    expect(ExerciseEdgeSchema.safeParse({ type: 'SUBSTITUTES', from: 'a1', to: 'b1', similarity: 1.2, ...e }).success).toBe(false);
    expect(ExerciseEdgeSchema.safeParse({ type: 'REQUIRES', from: 'a1', to: 'dumbbell', group: 0, ...e }).success).toBe(true);
    expect(ExerciseEdgeSchema.safeParse({ type: 'REQUIRES', from: 'a1', to: 'spaceship', group: 0, ...e }).success).toBe(false);
    expect(ExerciseEdgeSchema.safeParse({ type: 'PROGRESSES_TO', from: 'a1', to: 'a1', ladderId: 'l1', ...e }).success).toBe(false);
    expect(ExerciseEdgeSchema.safeParse({ type: 'SUBSTITUTES', from: 'a1', to: 'b1', similarity: 0.7, source: 's', validated: true }).success).toBe(false);
  });

  it('muscle, equipment, custom exercise, media, content version, safety inputs', () => {
    expect(MuscleSchema.safeParse({ id: 'quads', region: 'lower', nameKey: 'library.muscle.quads' }).success).toBe(true);
    expect(EquipmentSchema.safeParse({ id: 'dumbbell', category: 'free_weight', nameKey: 'library.equipment.dumbbell', locations: ['home'], loadable: true, portable: true }).success).toBe(true);
    expect(EquipmentSchema.safeParse({ id: 'dumbbell', category: 'free_weight', nameKey: 'library.equipment.dumbbell', locations: [], loadable: true, portable: true }).success).toBe(false);
    expect(CustomExerciseSchema.safeParse({ id: '00000000-0000-4000-8000-000000000001', name: 'My move', pattern: 'core', primaryMuscles: ['abs'], equipment: [], createdAt: '2026-09-23T10:00:00.000Z' }).success).toBe(true);
    const media = { id: 'm1', exerciseId: null, kind: 'diagram', path: 'a/b.svg', bytes: 10, lowBandwidth: false, packs: [], licence: null, source: null, rightsHolder: null, status: 'draft' };
    expect(MediaAssetSchema.safeParse(media).success).toBe(true);
    expect(PublishedMediaAssetSchema.safeParse({ ...media, status: 'published' }).success).toBe(false);
    expect(PublishedMediaAssetSchema.safeParse({ ...media, licence: 'CC0-1.0', source: 's', rightsHolder: 'r', status: 'published' }).success).toBe(true);
    expect(ContentVersionSchema.safeParse({ contentId: 'exercise.a1', entityType: 'exercise', version: 1, contentHash: 'a'.repeat(64), createdAt: '2026-09-23T10:00:00.000Z', status: 'draft', approvals: [] }).success).toBe(true);
    expect(JointFlagsSchema.safeParse({ knee: 'red' }).success).toBe(true);
    expect(JointFlagsSchema.safeParse({ knee: 'purple' }).success).toBe(false);
    // M01 extended the schema (docs/status/M01.md): the M06 fields plus the screening fields are all required.
    const m01Fields = { screeningOutcome: 'consult_professional', unresolvedFlags: ['chest_discomfort'], deficitNutritionAllowed: true, specialPopulation: 'none', automaticProgrammingAllowed: true, lowIntensityLibraryOnly: false, professionalGuidance: true, limitedJoints: [], reasonCodes: ['safety_profile.s1.unresolved_flag'], rulesVersion: '0.1.0' };
    expect(SafetyProfileSchema.safeParse({ ...m01Fields, maxRPE: 7, allowHIIT: false, allowMaxTests: false, impactCeiling: 'low', avoidTags: ['inversion'], excludedExerciseIds: [] }).success).toBe(true);
    expect(SafetyProfileSchema.safeParse({ maxRPE: 7, allowHIIT: false, allowMaxTests: false, impactCeiling: 'low', avoidTags: ['inversion'], excludedExerciseIds: [] }).success).toBe(false);
    expect(impactRank('none')).toBeLessThan(impactRank('high'));
    expect(skillRank('entry')).toBe(0);
    expect(skillRank('expert')).toBe(4);
  });
});
