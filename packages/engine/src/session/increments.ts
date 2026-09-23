import type { EquipmentId, EquipmentLoads, EquipmentLocation, LoadImplement, LoadType } from '@fitadapt/shared';
import { incrementValue } from '../config/session.js';
import type { GraphExercise } from '../substitution.js';

/**
 * Equipment-aware load rounding (M02, decision C3): a prescribed load is
 * always one the user's equipment can make, rounded DOWN (never up), and a
 * progression uses the smallest step that equipment allows.
 *
 * - barbell / Smith machine: bar + plates in pairs → bar + multiples of
 *   2 × the greatest common step of the plates (enough pairs of each plate
 *   are assumed);
 * - dumbbells, kettlebells, single plates: the listed weights only;
 * - weight stacks (machines, cables): first step + multiples of the step, up
 *   to the top of the stack;
 * - `increment` (M07 legacy): any multiple of a step.
 * All arithmetic is in integer hundredths of a kilogram (no float drift).
 */

const STACK: readonly EquipmentId[] = ['lat_pulldown', 'cable_station', 'leg_press', 'leg_curl_machine', 'leg_extension_machine', 'chest_press_machine'];
const PRIORITY: readonly EquipmentId[] = ['barbell', 'smith_machine', 'dumbbell', 'kettlebell', ...STACK, 'assisted_pull_up_machine', 'weight_plate'];

export const EMPTY_EQUIPMENT_LOADS: EquipmentLoads = Object.freeze({ barKg: null, platePairsKg: [], dumbbellsKg: [], kettlebellsKg: [], stack: null }) as EquipmentLoads;

const range = (min: number, step: number, max: number): number[] => {
  const out: number[] = [];
  for (let v = Math.round(min * 100); v <= Math.round(max * 100); v += Math.round(step * 100)) out.push(v / 100);
  return out;
};

/** The loads a place offers when the user has not described them: a commercial gym's defaults (config), nothing elsewhere. */
export function defaultEquipmentLoads(location: EquipmentLocation | null): EquipmentLoads {
  if (location !== 'gym') return EMPTY_EQUIPMENT_LOADS;
  const smallest = incrementValue('gym.smallestPlateKg');
  return {
    barKg: incrementValue('gym.barKg'),
    platePairsKg: [25, 20, 15, 10, 5, 2.5, smallest].filter((p, i, all) => p >= smallest && all.indexOf(p) === i),
    dumbbellsKg: range(incrementValue('gym.dumbbellMinKg'), incrementValue('gym.dumbbellStepKg'), incrementValue('gym.dumbbellMaxKg')),
    kettlebellsKg: range(incrementValue('gym.kettlebellMinKg'), incrementValue('gym.kettlebellStepKg'), incrementValue('gym.kettlebellMaxKg')),
    stack: { minKg: incrementValue('gym.stackMinKg'), stepKg: incrementValue('gym.stackStepKg'), maxKg: incrementValue('gym.stackMaxKg') },
  };
}

const cents = (kg: number) => Math.round(kg * 100);
const kg = (c: number) => c / 100;
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** The loadable item an exercise uses on this equipment (highest priority first), or null. */
export function loadItemFor(exercise: GraphExercise, equipment: ReadonlySet<EquipmentId>): EquipmentId | null {
  const items = exercise.equipment.flatMap((g) => g.anyOf.filter((id) => equipment.has(id)));
  return PRIORITY.find((id) => items.includes(id)) ?? null;
}

const isLoaded = (t: LoadType | undefined) => t === 'external' || t === 'machine';

/**
 * How an exercise can be loaded here:
 * - `null` when it takes no external load (body weight, bands);
 * - `{ implement: null }` when it does but the loads are not known (the user chooses; the engine never invents a number);
 * - otherwise the achievable-load model.
 * `loads === null` is the M07 legacy mode: any multiple of `legacyStepKg`.
 */
export function implementFor(
  exercise: GraphExercise,
  loadType: LoadType | undefined,
  equipment: ReadonlySet<EquipmentId>,
  loads: EquipmentLoads | null,
  legacyStepKg: number,
): { readonly implement: LoadImplement | null } | null {
  if (!isLoaded(loadType)) return null;
  if (loads === null) return { implement: { kind: 'increment', stepKg: legacyStepKg } };
  const item = loadItemFor(exercise, equipment);
  if (item === 'barbell' || item === 'smith_machine') {
    const plates = loads.platePairsKg.map(cents).filter((p) => p > 0);
    if (loads.barKg === null || plates.length === 0) return { implement: null };
    return { implement: { kind: 'barbell', barKg: loads.barKg, stepKg: kg(2 * plates.reduce(gcd)) } };
  }
  if (item === 'dumbbell') return { implement: loads.dumbbellsKg.length > 0 ? { kind: 'dumbbell', loadsKg: [...loads.dumbbellsKg].sort((a, b) => a - b) } : null };
  if (item === 'kettlebell') return { implement: loads.kettlebellsKg.length > 0 ? { kind: 'kettlebell', loadsKg: [...loads.kettlebellsKg].sort((a, b) => a - b) } : null };
  if (item !== null && STACK.includes(item)) return { implement: loads.stack ? { kind: 'stack', ...loads.stack } : null };
  if (item === 'weight_plate') return { implement: loads.platePairsKg.length > 0 ? { kind: 'plate', loadsKg: [...loads.platePairsKg].sort((a, b) => a - b) } : null };
  // Assisted machines (the load is assistance) and loaded moves without a loadable item: the user chooses.
  return { implement: null };
}

/** The heaviest achievable load at or below `targetKg`, or null (nothing light enough). */
export function achievableAtMost(targetKg: number, impl: LoadImplement): number | null {
  // Hundredths, rounded toward the safe side (never above the target).
  const t = Math.floor(targetKg * 100 + 1e-8);
  switch (impl.kind) {
    case 'increment': {
      const step = cents(impl.stepKg);
      const v = Math.floor(t / step) * step;
      return v > 0 ? kg(v) : null;
    }
    case 'barbell': {
      const bar = cents(impl.barKg);
      const step = cents(impl.stepKg);
      if (t < bar) return null;
      return kg(bar + Math.floor((t - bar) / step) * step);
    }
    case 'stack': {
      const min = cents(impl.minKg);
      const step = cents(impl.stepKg);
      if (t < min) return null;
      return kg(Math.min(min + Math.floor((cents(impl.maxKg) - min) / step) * step, min + Math.floor((t - min) / step) * step));
    }
    default: {
      const fits = impl.loadsKg.filter((l) => cents(l) <= t);
      return fits.length > 0 ? Math.max(...fits) : null;
    }
  }
}

/** The lightest achievable load at or above `targetKg`, or null (the equipment tops out below it). */
export function achievableAtLeast(targetKg: number, impl: LoadImplement): number | null {
  const t = Math.ceil(targetKg * 100 - 1e-8);
  switch (impl.kind) {
    case 'increment': {
      const step = cents(impl.stepKg);
      return kg(Math.max(step, Math.ceil(t / step) * step));
    }
    case 'barbell': {
      const bar = cents(impl.barKg);
      const step = cents(impl.stepKg);
      return kg(t <= bar ? bar : bar + Math.ceil((t - bar) / step) * step);
    }
    case 'stack': {
      const min = cents(impl.minKg);
      const step = cents(impl.stepKg);
      const v = t <= min ? min : min + Math.ceil((t - min) / step) * step;
      return v <= cents(impl.maxKg) ? kg(v) : null;
    }
    default: {
      const fits = impl.loadsKg.filter((l) => cents(l) >= t);
      return fits.length > 0 ? Math.min(...fits) : null;
    }
  }
}

/** The equipment's step just above `loadKg` (for "rounded to your equipment" explanations). */
export function stepAbove(loadKg: number, impl: LoadImplement): number | null {
  const next = achievableAtLeast(kg(cents(loadKg) + 1), impl);
  return next === null ? null : kg(cents(next) - cents(loadKg));
}
