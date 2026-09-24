import { en, fr, EXERCISE_TEXT_IDS } from '@fitadapt/i18n';
import { EquipmentSchema, ExerciseEdgeSchema, ExerciseSchema, MuscleSchema, MUSCLE_IDS, EQUIPMENT_IDS } from '@fitadapt/shared';
import { describe, expect, it } from 'vitest';
import { BW_SOURCE, EQUIPMENT, EQUIPMENT_PRESETS, MUSCLES, SEED_EXERCISES, seedLibrary, SIMILARITY_CONFIG, validateGraph } from './index.js';

/** Goal condition (2): ≥ 120 exercises, FR/EN wording, schema-valid, all unvalidated and pending review. */
describe('M06 seed', () => {
  const lib = seedLibrary();

  it('has at least 120 exercises, each valid against the Exercise schema', () => {
    expect(SEED_EXERCISES.length).toBeGreaterThanOrEqual(120);
    for (const e of SEED_EXERCISES) expect(ExerciseSchema.safeParse(e).success, e.id).toBe(true);
    expect(new Set(SEED_EXERCISES.map((e) => e.id)).size).toBe(SEED_EXERCISES.length);
  });

  it('every entry is validated:false, reviewStatus pending, with the physio-review flag unset', () => {
    for (const e of SEED_EXERCISES) {
      expect({ id: e.id, validated: e.validated, reviewStatus: e.reviewStatus, physio: e.review.physio, coach: e.review.coach }).toEqual({
        id: e.id,
        validated: false,
        reviewStatus: 'pending',
        physio: null,
        coach: null,
      });
      expect(e.validatedBy).toBeUndefined();
      expect(e.signOff).toBeUndefined();
    }
  });

  it('every exercise has an FR and EN name, at least one cue and one common mistake', () => {
    for (const e of SEED_EXERCISES) {
      expect(e.cueKeys.length, e.id).toBeGreaterThanOrEqual(1);
      expect(e.mistakeKeys.length, e.id).toBeGreaterThanOrEqual(1);
      for (const key of [e.nameKey, ...e.cueKeys, ...e.mistakeKeys]) {
        const k = key as keyof typeof en;
        expect(en[k]?.trim().length ?? 0, `${key} en`).toBeGreaterThan(0);
        expect(fr[k]?.trim().length ?? 0, `${key} fr`).toBeGreaterThan(0);
        expect(fr[k], key).not.toBe(en[k]);
      }
    }
    expect([...EXERCISE_TEXT_IDS].sort()).toEqual(SEED_EXERCISES.map((e) => e.id).sort());
  });

  it('every %-bodyweight coefficient is a config value with a real source and validated:false', () => {
    const sources = new Set(Object.values(BW_SOURCE));
    for (const e of SEED_EXERCISES) {
      if (e.loadType !== 'bodyweight') {
        expect(e.bodyweightLoad, e.id).toBeNull();
        continue;
      }
      expect(e.bodyweightLoad?.validated, e.id).toBe(false);
      expect(sources.has(e.bodyweightLoad?.source as never), e.id).toBe(true);
      expect(e.bodyweightLoad?.value).toBeGreaterThan(0);
      expect(e.bodyweightLoad?.value).toBeLessThanOrEqual(1);
    }
    // The push-up values quoted in docs/specs/M02 from Ebben et al. (2011); the low incline (bench or chair seat) sits
    // between Ebben's 30.5 cm and 61 cm values (A3/A5 pre-review #80: 0.41 was the 61 cm box).
    const byId = lib.byId;
    expect([byId.get('knee_push_up'), byId.get('push_up'), byId.get('decline_push_up'), byId.get('incline_push_up_low')].map((e) => [e?.bodyweightLoad?.value, e?.bodyweightLoad?.source])).toEqual([
      [0.49, BW_SOURCE.ebben],
      [0.64, BW_SOURCE.ebben],
      [0.74, BW_SOURCE.ebben],
      [0.48, BW_SOURCE.ebben_interpolated],
    ]);
    // A1/A2 pre-review: a deep wall sit loads the knee heavily (a red or amber knee never gets it by default).
    expect(byId.get('wall_sit')?.jointLoad.knee).toBe('high');
  });

  it('every similarity weight is validated:false with a source, and the weights sum to 1', () => {
    for (const v of Object.values(SIMILARITY_CONFIG)) {
      expect(v.validated).toBe(false);
      expect(v.source.length).toBeGreaterThan(0);
    }
    const c = SIMILARITY_CONFIG;
    expect(c.weightPattern.value + c.weightPrimaryMuscles.value + c.weightAllMuscles.value + c.weightLaterality.value + c.weightSkill.value).toBeCloseTo(1, 10);
  });

  it('muscles, equipment and edges validate against their schemas', () => {
    expect(MUSCLES.map((m) => m.id)).toEqual([...MUSCLE_IDS]);
    expect(EQUIPMENT.map((e) => e.id)).toEqual([...EQUIPMENT_IDS]);
    for (const m of MUSCLES) expect(MuscleSchema.safeParse(m).success).toBe(true);
    for (const e of EQUIPMENT) expect(EquipmentSchema.safeParse(e).success).toBe(true);
    for (const e of lib.edges) expect(ExerciseEdgeSchema.safeParse(e).success).toBe(true);
    for (const e of lib.edges) expect(e.validated).toBe(false);
    for (const m of MUSCLES) expect(en[m.nameKey as keyof typeof en]).toBeTruthy();
    for (const e of EQUIPMENT) expect(fr[e.nameKey as keyof typeof fr]).toBeTruthy();
  });

  it('equipment presets only use known ids; bodyweight-only needs nothing', () => {
    expect(EQUIPMENT_PRESETS.bodyweight_only).toEqual([]);
    for (const ids of Object.values(EQUIPMENT_PRESETS)) for (const id of ids) expect(EQUIPMENT_IDS).toContain(id);
    // P1 at home (docs/specs/00-product-vision.md): pull-up bar, bands, dumbbells.
    expect(EQUIPMENT_PRESETS.home_basic).toEqual(expect.arrayContaining(['pull_up_bar', 'resistance_band', 'dumbbell']));
    // P6: park + rings.
    expect(EQUIPMENT_PRESETS.park).toEqual(expect.arrayContaining(['pull_up_bar', 'parallel_bars', 'gymnastic_rings']));
  });

  it('the whole graph passes the integrity rules', () => {
    expect(validateGraph(lib.exercises, lib.edges)).toEqual([]);
    expect(lib.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('exercise names avoid third-party trademarks (L6/L7)', () => {
    const marks = /\b(trx|superman|crossfit|pilates|zumba|bosu|peloton|concept ?2|kettlebells? by)\b/i;
    for (const e of SEED_EXERCISES) {
      expect(en[e.nameKey as keyof typeof en], e.id).not.toMatch(marks);
      expect(fr[e.nameKey as keyof typeof fr], e.id).not.toMatch(marks);
    }
  });

  it('ships no media: placeholders only', () => {
    for (const e of SEED_EXERCISES) expect(e.mediaAssetIds).toEqual([]);
  });
});
