import { JOINTS, type EquipmentId, type JointFlags, type SessionPlan } from '@fitadapt/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FULL_GYM, profileFrom } from '../__fixtures__/library.js';
import { GYM_CAPACITY, RECOVERY_LIBRARY, RECOVERY_LIBRARY_NO_LISTS, WARMUP_LISTS } from '../__fixtures__/recovery.js';
import { GYM_ID, GYM_LOADS, HOME_ID, HOME_LOADS, programContext, slot } from '../__fixtures__/session.js';
import { fixedClock } from '../clock.js';
import { createEngineContext } from '../context.js';
import { generateSession } from '../session/generate.js';
import { achievableAtMost, implementFor } from '../session/increments.js';
import type { SessionLibrary } from '../session/library.js';
import { planSeconds } from '../session/timebox.js';
import type { GenerateSessionInput } from '../session/types.js';
import { RECOVERY_CONFIG } from './config.js';
import { buildCoolDown, buildWarmUp, dayPatterns } from './warmup.js';

const MON = Date.parse('2026-09-28T08:00:00.000Z');
const GYM: EquipmentId[] = [...FULL_GYM, 'cable_station'];
const HOME: EquipmentId[] = ['pull_up_bar', 'resistance_band', 'dumbbell'];
const gymInput = (over: Partial<GenerateSessionInput> = {}): GenerateSessionInput => ({
  safetyProfile: profileFrom(),
  equipment: GYM,
  equipmentLoads: GYM_LOADS,
  equipmentProfileId: GYM_ID,
  minutesAvailable: 60,
  programSession: programContext(),
  capacity: GYM_CAPACITY,
  experience: 'intermediate',
  ...over,
});
const homeInput = (over: Partial<GenerateSessionInput> = {}): GenerateSessionInput =>
  gymInput({ equipment: HOME, equipmentLoads: HOME_LOADS, equipmentProfileId: HOME_ID, capacity: null, programSession: programContext({ equipmentProfileId: HOME_ID, location: 'home' }), ...over });
const plan = (input: GenerateSessionInput, library: SessionLibrary = RECOVERY_LIBRARY): SessionPlan => {
  const r = generateSession(input, library, createEngineContext({ clock: fixedClock(MON), seed: 3 }));
  if (r.status !== 'ok') throw new Error(r.reasonCodes.join());
  return r.plan;
};

/** Checks every M05 warm-up rule on one plan; returns the plan's warm-up. */
function checkWarmUp(p: SessionPlan, input: GenerateSessionInput, library: SessionLibrary = RECOVERY_LIBRARY) {
  const w = p.warmUp.content!;
  expect(w, 'every plan says what its warm-up is').toBeDefined();
  // 5–8 minutes, and the blocks add up exactly to the minutes the plan counts.
  expect(p.warmUp.minutes).toBeGreaterThanOrEqual(5);
  expect(p.warmUp.minutes).toBeLessThanOrEqual(8);
  expect(w.seconds).toBe(p.warmUp.minutes * 60);
  expect(w.general.seconds + (w.rampUp?.seconds ?? 0) + w.mobility.reduce((s, d) => s + d.seconds, 0)).toBe(w.seconds);
  // 2–3 minutes of general movement (plus the few seconds the drills leave over).
  expect(w.general.seconds).toBeGreaterThanOrEqual(120);
  // (With no drill allowed today, easy general movement fills the warm-up instead.)
  if (w.mobility.length > 0) expect(w.general.seconds).toBeLessThanOrEqual(180 + w.mobility.length);
  // Mobility matches the day's movement patterns: every drill prepares patterns of today's exercises and is listed for them.
  const patterns = dayPatterns(p.exercises);
  for (const d of w.mobility) {
    expect(d.forPatterns.length).toBeGreaterThan(0);
    for (const pattern of d.forPatterns) {
      expect(patterns).toContain(pattern);
      if (library.warmUpDrills) expect(library.warmUpDrills(pattern)).toContain(d.exerciseId);
    }
    expect(p.exercises.map((e) => e.exerciseId)).not.toContain(d.exerciseId);
    const ex = library.graph.exercises.get(d.exerciseId)!;
    // Gentle, allowed and never loading a flagged joint beyond "low".
    for (const j of JOINTS) {
      expect(ex.jointLoad[j]).not.toBe('high');
      if (input.jointFlags?.[j] === 'red' || input.jointFlags?.[j] === 'amber') expect(ex.jointLoad[j]).toBe('low');
    }
  }
  // Ramp-up sets precede the first heavy lift: the first loaded exercise, lighter and rising, rounded down to the equipment.
  const firstLoaded = p.exercises.findIndex((e) => (e.sets[0]!.loadKg ?? 0) > 0);
  if (firstLoaded < 0) expect(w.rampUp).toBeNull();
  else {
    const r = w.rampUp!;
    expect(r.exerciseIndex).toBe(firstLoaded);
    expect(r.exerciseId).toBe(p.exercises[firstLoaded]!.exerciseId);
    expect(r.workingLoadKg).toBe(p.exercises[firstLoaded]!.sets[0]!.loadKg);
    const ex = library.graph.exercises.get(r.exerciseId)!;
    const impl = implementFor(ex, library.loadType(ex.id), new Set(input.equipment), input.equipmentLoads ?? null, 2.5)!.implement!;
    r.sets.forEach((s, i) => {
      expect(s.loadKg).toBeLessThan(r.workingLoadKg);
      if (i > 0) {
        expect(s.loadKg).toBeGreaterThan(r.sets[i - 1]!.loadKg);
        expect(s.percent).toBeGreaterThan(r.sets[i - 1]!.percent);
      }
      if (s.loadKg > 0) expect(achievableAtMost(s.loadKg, impl)).toBe(s.loadKg);
      expect(s.loadKg).toBeLessThanOrEqual((r.workingLoadKg * s.percent) / 100 + 1e-9);
    });
  }
  return w;
}

describe('M05 warm-up generator (goal condition 1)', () => {
  it('a full gym session: 8 minutes, 3 min general, 40/60/80 % ramp-up before the first heavy lift, mobility for every pattern of the day', () => {
    const input = gymInput({ minutesAvailable: 90 });
    const p = plan(input);
    const w = checkWarmUp(p, input);
    expect(p.warmUp.minutes).toBe(8);
    expect(w.general).toMatchObject({ exerciseId: 'marching_in_place', reasonCodes: ['warmup.general'] });
    expect(w.general.seconds).toBeGreaterThanOrEqual(180);
    expect(w.rampUp!.sets.map((s) => s.percent)).toEqual([40, 60, 80]);
    expect(w.rampUp!.sets.map((s) => s.reps)).toEqual([8, 5, 3]);
    expect(w.rampUp!.reasonCodes).toEqual(['warmup.ramp_up']);
    // Loads on 2.5 kg barbell steps from a 20 kg bar, at or below 40/60/80 % of the working load.
    const work = w.rampUp!.workingLoadKg;
    expect(w.rampUp!.sets.map((s) => s.loadKg)).toEqual([0.4, 0.6, 0.8].map((f) => achievableAtMost(work * f, { kind: 'barbell', barKg: 20, stepKg: 2.5 })));
    // Every pattern of the day is prepared by a drill.
    const covered = new Set(w.mobility.flatMap((d) => d.forPatterns));
    expect([...covered].sort()).toEqual(dayPatterns(p.exercises).sort());
    expect(w.mobility.every((d) => d.reasonCodes[0] === 'warmup.mobility.for_patterns')).toBe(true);
  });

  it('a short session keeps the 5-minute minimum: 2 min general, two ramp-up sets (60/80 %), mobility in the rest', () => {
    const input = gymInput({ minutesAvailable: 30 });
    const p = plan(input);
    expect(p.reasonCodes).toContain('session.time.warmup_shortened');
    const w = checkWarmUp(p, input);
    expect(p.warmUp.minutes).toBe(5);
    expect(w.general.seconds).toBeLessThan(180);
    if (w.rampUp) expect(w.rampUp.sets.map((s) => s.percent)).toEqual([60, 80]);
    expect(w.mobility.length).toBeGreaterThan(0);
  });

  it('home with one pair of 10 kg dumbbells: a light load the equipment cannot make becomes "no added weight"', () => {
    const input = homeInput({ minutesAvailable: 60 });
    checkWarmUp(plan(input), input);
    const press = { slot: 'horizontal_push' as const, role: 'primary' as const, exerciseId: 'dumbbell_floor_press', ladderId: null, supersetGroup: null, reasonCodes: ['session.exercise.from_program'], sets: [1, 2].map((index) => ({ index, target: { kind: 'reps' as const, min: 8, max: 12 }, loadKg: 10, targetRir: 3, restSeconds: 75, tempo: null, reasonCodes: ['session.load.from_e1rm'], reasonParams: {} })) };
    const w = buildWarmUp({ library: RECOVERY_LIBRARY, equipment: new Set(HOME), loads: HOME_LOADS, legacyStep: 2.5, jointFlags: {}, profile: profileFrom() }, [press], 8);
    expect(w.rampUp).toMatchObject({ exerciseIndex: 0, workingLoadKg: 10, sets: [{ percent: 40, loadKg: 0, reps: 8 }] });
    expect(w.seconds).toBe(480);
    // Legacy rounding (loads of the place unknown): half-kilo steps, still below the working load.
    const legacy = buildWarmUp({ library: RECOVERY_LIBRARY, equipment: new Set(HOME), loads: null, legacyStep: 2.5, jointFlags: {}, profile: profileFrom() }, [press], 8);
    expect(legacy.rampUp!.sets.map((s) => s.loadKg)).toEqual([2.5, 5, 7.5]);
  });

  it('bodyweight-only sessions have no ramp-up; a red or amber joint keeps every drill at a low load on it', () => {
    const input = homeInput({ equipment: ['pull_up_bar'], equipmentLoads: null, jointFlags: { knee: 'red', shoulder: 'amber' } });
    const p = plan(input);
    const w = checkWarmUp(p, input);
    expect(w.rampUp).toBeNull();
    expect(w.mobility.map((d) => d.exerciseId)).not.toContain('ankle_rock');
    expect(w.mobility.map((d) => d.exerciseId)).not.toContain('open_book');
  });

  it('without a drill list the pattern’s own warm-up and mobility exercises are used; with no drill at all the general part fills the time', () => {
    const input = gymInput({ minutesAvailable: 90 });
    const p = plan(input, RECOVERY_LIBRARY_NO_LISTS);
    checkWarmUp(p, input, RECOVERY_LIBRARY_NO_LISTS);
    const bare = buildWarmUp({ library: { ...RECOVERY_LIBRARY, warmUpDrills: () => [] }, equipment: new Set(GYM), loads: GYM_LOADS, legacyStep: 2.5, jointFlags: {}, profile: profileFrom() }, [], 5);
    expect(bare).toMatchObject({ seconds: 300, mobility: [], rampUp: null, general: { seconds: 300 } });
    // A library with no general-movement exercise: "any easy movement".
    const noGeneral = buildWarmUp({ library: { ...RECOVERY_LIBRARY, tags: () => [] }, equipment: new Set(GYM), loads: GYM_LOADS, legacyStep: 2.5, jointFlags: {}, profile: profileFrom() }, p.exercises, 8);
    expect(noGeneral.general).toMatchObject({ exerciseId: null, reasonCodes: ['warmup.general.any_easy'] });
    expect(noGeneral.seconds).toBe(480);
  });

  it('a conditioning-only day warms up for locomotion', () => {
    expect(dayPatterns([])).toEqual(['locomotion']);
  });

  it('the M07 first session says what its 5-minute warm-up is, with ramp-up before its first loaded exercise', () => {
    const input = gymInput({ programSession: null, capacity: GYM_CAPACITY, minutesAvailable: 45 });
    const p = plan(input);
    expect(p.kind).toBe('first_session');
    const w = checkWarmUp(p, input);
    expect(w.seconds).toBe(300);
  });

  it('property: every generated plan keeps the warm-up within 5–8 minutes, for the day’s patterns, with ramp-up before the first heavy lift', () => {
    const patterns = ['squat', 'hinge', 'lunge', 'horizontal_push', 'vertical_push', 'horizontal_pull', 'vertical_pull', 'core', 'isolation', 'carry', 'balance'] as const;
    fc.assert(
      fc.property(
        fc.array(fc.record({ pattern: fc.constantFrom(...patterns), role: fc.constantFrom('primary' as const, 'secondary' as const, 'accessory' as const), sets: fc.integer({ min: 1, max: 5 }) }), { minLength: 1, maxLength: 7 }),
        fc.integer({ min: 15, max: 120 }),
        fc.boolean(),
        fc.dictionary(fc.constantFrom(...JOINTS), fc.constantFrom('amber' as const, 'red' as const), { maxKeys: 3 }),
        (slots, minutes, atGym, flags) => {
          const input = (atGym ? gymInput : homeInput)({
            minutesAvailable: minutes,
            jointFlags: flags as JointFlags,
            programSession: programContext({ slots: slots.map((s) => slot(s.pattern, s.role, 'hypertrophy', s.sets)), equipmentProfileId: atGym ? GYM_ID : HOME_ID }),
          });
          const r = generateSession(input, RECOVERY_LIBRARY, createEngineContext({ clock: fixedClock(MON), seed: minutes }));
          if (r.status !== 'ok') return;
          checkWarmUp(r.plan, input);
          expect(planSeconds(r.plan)).toBeLessThanOrEqual(minutes * 60);
        },
      ),
      { numRuns: 600 },
    );
  });
});

describe('M05 cool-down', () => {
  it('only with time left, never past the minutes, mobility drills only', () => {
    const roomy = plan(gymInput({ minutesAvailable: 120 }));
    expect(roomy.coolDown).not.toBeNull();
    expect(roomy.coolDown!.minutes).toBeLessThanOrEqual(RECOVERY_CONFIG['coolDown.maxMinutes'].value);
    expect(roomy.reasonCodes).toContain('cooldown.after_session');
    for (const d of roomy.coolDown!.drills) expect(RECOVERY_LIBRARY.tags!(d.exerciseId)).toContain('mobility');
    expect(planSeconds(roomy)).toBeLessThanOrEqual(120 * 60);
    for (const minutes of [20, 30, 45, 60]) {
      const p = plan(gymInput({ minutesAvailable: minutes }));
      expect(planSeconds(p)).toBeLessThanOrEqual(minutes * 60);
      if (p.coolDown) expect(planSeconds({ ...p, coolDown: null }) + 120).toBeLessThanOrEqual(minutes * 60);
    }
    const ctx = { library: RECOVERY_LIBRARY, equipment: new Set(GYM), loads: GYM_LOADS, legacyStep: 2.5, jointFlags: {}, profile: profileFrom() };
    expect(buildCoolDown(ctx, roomy.exercises, 119)).toBeNull();
    expect(buildCoolDown({ ...ctx, library: { ...RECOVERY_LIBRARY, warmUpDrills: () => [] } }, roomy.exercises, 600)).toBeNull();
    expect(Object.keys(WARMUP_LISTS)).toHaveLength(13);
  });
});
