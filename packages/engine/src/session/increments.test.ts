import { EquipmentLoadsSchema, type EquipmentId, type LoadImplement } from '@fitadapt/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { INCREMENT_CONFIG } from '../config/session.js';
import { SESSION_LIBRARY } from '../__fixtures__/session.js';
import { EMPTY_EQUIPMENT_LOADS, achievableAtLeast, achievableAtMost, defaultEquipmentLoads, implementFor, loadItemFor, stepAbove } from './increments.js';

const ex = (id: string) => SESSION_LIBRARY.graph.exercises.get(id)!;
const gymLoads = defaultEquipmentLoads('gym');
const everything = new Set<EquipmentId>(['barbell', 'squat_rack', 'flat_bench', 'dumbbell', 'kettlebell', 'lat_pulldown', 'leg_press', 'cable_station', 'weight_plate', 'resistance_band']);

describe('increment rounding (goal condition 4: plates, dumbbell pairs, machine stacks)', () => {
  it('barbell with plates in pairs: bar + multiples of 2 × the smallest plate, always rounded down', () => {
    const plates: LoadImplement = { kind: 'barbell', barKg: 20, stepKg: 2.5 };
    expect(achievableAtMost(101.9, plates)).toBe(100);
    expect(achievableAtMost(102.5, plates)).toBe(102.5);
    expect(achievableAtMost(19.9, plates)).toBeNull(); // lighter than the bar: no barbell load
    expect(achievableAtLeast(101, plates)).toBe(102.5);
    expect(achievableAtLeast(10, plates)).toBe(20);
    expect(stepAbove(100, plates)).toBe(2.5);
    // Microplates (P5): 0.25 kg plates → 0.5 kg steps.
    const micro = implementFor(ex('barbell_back_squat'), 'external', everything, { ...gymLoads, platePairsKg: [20, 10, 5, 2.5, 1.25, 0.5, 0.25] }, 2.5)!.implement!;
    expect(micro).toEqual({ kind: 'barbell', barKg: 20, stepKg: 0.5 });
    expect(achievableAtMost(133.9, micro)).toBe(133.5);
    // Odd plate sets use their greatest common step: 5 and 7.5 kg plates → 2 × 2.5 kg.
    expect(implementFor(ex('barbell_row'), 'external', everything, { ...gymLoads, platePairsKg: [7.5, 5] }, 2.5)!.implement).toEqual({ kind: 'barbell', barKg: 20, stepKg: 5 });
  });

  it('dumbbell pairs: only the weights the user has, per dumbbell', () => {
    const pairs: LoadImplement = { kind: 'dumbbell', loadsKg: [6, 8, 10, 12.5] };
    expect(achievableAtMost(11.9, pairs)).toBe(10);
    expect(achievableAtMost(5.9, pairs)).toBeNull();
    expect(achievableAtLeast(10.5, pairs)).toBe(12.5);
    expect(achievableAtLeast(13, pairs)).toBeNull(); // the rack tops out
    expect(stepAbove(10, pairs)).toBe(2.5);
    expect(stepAbove(12.5, pairs)).toBeNull();
    // P1: one pair of 10 kg dumbbells.
    const p1 = implementFor(ex('goblet_squat'), 'external', new Set(['dumbbell']), { ...EMPTY_EQUIPMENT_LOADS, dumbbellsKg: [10] }, 2.5)!.implement!;
    expect(p1).toEqual({ kind: 'dumbbell', loadsKg: [10] });
    expect(achievableAtMost(9.5, p1)).toBeNull();
    expect(achievableAtLeast(10.2, p1)).toBeNull();
  });

  it('machine stacks: first step + multiples of the step, up to the top of the stack', () => {
    const stack: LoadImplement = { kind: 'stack', minKg: 5, stepKg: 5, maxKg: 100 };
    expect(achievableAtMost(47, stack)).toBe(45);
    expect(achievableAtMost(4, stack)).toBeNull();
    expect(achievableAtMost(140, stack)).toBe(100);
    expect(achievableAtLeast(46, stack)).toBe(50);
    expect(achievableAtLeast(101, stack)).toBeNull();
    expect(achievableAtLeast(1, stack)).toBe(5);
    expect(implementFor(ex('lat_pulldown'), 'machine', everything, gymLoads, 2.5)!.implement).toEqual({ kind: 'stack', ...gymLoads.stack! });
  });

  it('kettlebells and single plates are lists too; the legacy mode is any multiple of a step', () => {
    expect(achievableAtMost(17, { kind: 'kettlebell', loadsKg: [8, 12, 16, 20] })).toBe(16);
    expect(achievableAtMost(3, { kind: 'plate', loadsKg: [1.25, 2.5, 5] })).toBe(2.5);
    const legacy: LoadImplement = { kind: 'increment', stepKg: 2.5 };
    expect(achievableAtMost(133.9, legacy)).toBe(132.5);
    expect(achievableAtMost(1, legacy)).toBeNull();
    expect(achievableAtLeast(131, legacy)).toBe(132.5);
    expect(achievableAtLeast(0, legacy)).toBe(2.5);
  });

  it('which item loads an exercise: barbell before dumbbells before kettlebells before stacks', () => {
    expect(loadItemFor(ex('goblet_squat'), new Set(['dumbbell', 'kettlebell']))).toBe('dumbbell');
    expect(loadItemFor(ex('goblet_squat'), new Set(['kettlebell']))).toBe('kettlebell');
    expect(implementFor(ex('goblet_squat'), 'external', new Set(['kettlebell']), gymLoads, 2.5)!.implement).toMatchObject({ kind: 'kettlebell' });
    expect(loadItemFor(ex('air_squat'), everything)).toBeNull();
  });

  it('unknown loads are never invented: the user chooses; bodyweight and bands take no external load', () => {
    expect(implementFor(ex('air_squat'), 'bodyweight', everything, gymLoads, 2.5)).toBeNull();
    expect(implementFor(ex('seated_band_row'), 'band', everything, gymLoads, 2.5)).toBeNull();
    expect(implementFor(ex('goblet_squat'), 'external', new Set(['dumbbell']), EMPTY_EQUIPMENT_LOADS, 2.5)).toEqual({ implement: null });
    expect(implementFor(ex('barbell_back_squat'), 'external', everything, EMPTY_EQUIPMENT_LOADS, 2.5)).toEqual({ implement: null });
    expect(implementFor(ex('lat_pulldown'), 'machine', everything, EMPTY_EQUIPMENT_LOADS, 2.5)).toEqual({ implement: null });
    expect(implementFor(ex('assisted_pull_up_machine'), 'machine', new Set(['assisted_pull_up_machine']), gymLoads, 2.5)).toEqual({ implement: null });
    expect(implementFor(ex('goblet_squat'), 'external', new Set(['kettlebell']), EMPTY_EQUIPMENT_LOADS, 2.5)).toEqual({ implement: null });
    // Legacy (M07): no loads given → any multiple of the step.
    expect(implementFor(ex('goblet_squat'), 'external', new Set(['dumbbell']), null, 1)).toEqual({ implement: { kind: 'increment', stepKg: 1 } });
  });

  it('defaults: a commercial gym from config (validated:false); nothing elsewhere', () => {
    expect(EquipmentLoadsSchema.parse(gymLoads)).toEqual(gymLoads);
    expect(gymLoads).toMatchObject({ barKg: 20, stack: { minKg: 5, stepKg: 5, maxKg: 120 } });
    expect(gymLoads.dumbbellsKg[0]).toBe(2);
    expect(gymLoads.dumbbellsKg.at(-1)).toBe(50);
    expect(Math.min(...gymLoads.platePairsKg)).toBe(1.25);
    for (const place of ['home', 'park', 'travel', null] as const) expect(defaultEquipmentLoads(place)).toEqual(EMPTY_EQUIPMENT_LOADS);
    expect(Object.values(INCREMENT_CONFIG).every((v) => v.validated === false && v.source.length > 0)).toBe(true);
  });

  it('property: rounding down never exceeds the target and rounding up never falls below it', () => {
    const impl = fc.oneof(
      fc.record({ kind: fc.constant('barbell' as const), barKg: fc.constantFrom(15, 20), stepKg: fc.constantFrom(0.5, 1, 2.5, 5) }),
      fc.record({ kind: fc.constant('dumbbell' as const), loadsKg: fc.uniqueArray(fc.integer({ min: 1, max: 120 }).map((x) => x / 2), { minLength: 1, maxLength: 20 }) }),
      fc.record({ kind: fc.constant('stack' as const), minKg: fc.constantFrom(0, 2.5, 5), stepKg: fc.constantFrom(2.5, 5, 7), maxKg: fc.constantFrom(50, 100, 150) }),
      fc.record({ kind: fc.constant('increment' as const), stepKg: fc.constantFrom(0.5, 1, 2.5) }),
    );
    fc.assert(
      fc.property(impl, fc.double({ min: 0, max: 250, noNaN: true }), (i, target) => {
        const down = achievableAtMost(target, i as LoadImplement);
        const up = achievableAtLeast(target, i as LoadImplement);
        if (down !== null && down > target + 1e-9) return false;
        if (up !== null && up < target - 1e-9) return false;
        return down === null || achievableAtMost(down, i as LoadImplement) === down;
      }),
      { numRuns: 3000 },
    );
  });
});
