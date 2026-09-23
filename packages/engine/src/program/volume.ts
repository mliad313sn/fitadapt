import { PROGRAM_MUSCLE_GROUPS, type GoalId, type MovementPattern, type ProgramMuscleGroup, type TrainingAge, type VolumeTarget } from '@fitadapt/shared';
import { PROGRAM_CONFIG, programValue, type ProgramConfigKey } from './config.js';

/**
 * Weekly hard-set targets per muscle group and the allocation of hard sets to
 * session slots. Pure and deterministic.
 */

/** Hard sets counted per muscle group for one set of `pattern` (config `contribution.*`). */
const contributionCache = new Map<MovementPattern, ReadonlyArray<readonly [ProgramMuscleGroup, number]>>();

export function contributions(pattern: MovementPattern): ReadonlyArray<readonly [ProgramMuscleGroup, number]> {
  let out = contributionCache.get(pattern);
  if (!out) {
    const list: [ProgramMuscleGroup, number][] = [];
    for (const group of PROGRAM_MUSCLE_GROUPS) {
      const key = `contribution.${pattern}.${group}`;
      if (Object.prototype.hasOwnProperty.call(PROGRAM_CONFIG, key)) list.push([group, programValue(key as ProgramConfigKey)]);
    }
    out = list;
    contributionCache.set(pattern, out);
  }
  return out;
}

/** The group a pattern trains most directly (contribution 1), or null (balance, mobility, locomotion). */
export function primaryGroup(pattern: MovementPattern): ProgramMuscleGroup | null {
  return contributions(pattern).find(([, c]) => c >= 1)?.[0] ?? null;
}

export function volumeRange(age: TrainingAge): { min: number; max: number } {
  return { min: programValue(`volume.${age}.min`), max: programValue(`volume.${age}.max`) };
}

/**
 * The weekly target for a group in the given accumulation week of a
 * mesocycle (1-based): the goal's position in the range, plus the weekly
 * increment, never above the max; scaled by `factor` for deload and
 * transition weeks.
 */
export function weeklyTarget(age: TrainingAge, goal: GoalId, weekInMesocycle: number, factor: number): number {
  const { min, max } = volumeRange(age);
  const base = min + programValue(`volume.position.${goal}`) * (max - min);
  const ramped = Math.min(max, base + programValue('volume.weeklyIncrementSets') * (weekInMesocycle - 1));
  return Math.round(ramped * factor * 2) / 2;
}

export interface AllocationSlot {
  readonly pattern: MovementPattern;
  readonly role: 'primary' | 'secondary' | 'accessory';
  /** Counted toward the weekly targets (false: balance and mobility, fixed sets). */
  readonly counted: boolean;
  readonly fixedSets: number;
}

export interface AllocationSession {
  readonly slots: readonly AllocationSlot[];
  /** Hard sets (counted + fixed) the session has time for. */
  readonly capacity: number;
}

export interface Allocation {
  /** Sets per slot, per session (same shape as the input). */
  readonly sets: readonly (readonly number[])[];
  readonly volume: readonly VolumeTarget[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Greedy, deterministic allocation: fixed sets first (balance, mobility),
 * then one hard set at a time to the slot whose main group is furthest below
 * its weekly target (ratio), favouring primary then secondary slots and
 * spreading sets across sessions. A set is never added if it would take its
 * main group above `caps` (counting the fractional sets other patterns
 * already give it), the session above its capacity or the slot above
 * `session.maxSetsPerSlot`. Fractional sets a pattern gives other groups
 * (e.g. arms from presses and rows) are counted in `planned` but do not block
 * that pattern's own group.
 */
export function allocateSets(sessions: readonly AllocationSession[], targets: Readonly<Record<ProgramMuscleGroup, number>>, caps: Readonly<Record<ProgramMuscleGroup, number>>): Allocation {
  const sets = sessions.map((s) => s.slots.map(() => 0));
  const used = sessions.map(() => 0);
  const planned = Object.fromEntries(PROGRAM_MUSCLE_GROUPS.map((g) => [g, 0])) as Record<ProgramMuscleGroup, number>;
  const direct = Object.fromEntries(PROGRAM_MUSCLE_GROUPS.map((g) => [g, 0])) as Record<ProgramMuscleGroup, number>;
  const maxPerSlot = programValue('session.maxSetsPerSlot');
  const bonus = { primary: programValue('allocation.bonus.primary'), secondary: programValue('allocation.bonus.secondary'), accessory: 0 } as const;
  const spread = programValue('allocation.spreadPenalty');

  sessions.forEach((s, i) =>
    s.slots.forEach((slot, j) => {
      if (slot.counted || slot.fixedSets === 0) return;
      const n = Math.min(slot.fixedSets, s.capacity - used[i]!);
      if (n > 0) {
        sets[i]![j] = n;
        used[i]! += n;
      }
    }),
  );

  for (;;) {
    let best: { i: number; j: number; score: number } | null = null;
    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i]!;
      if (used[i]! >= s.capacity) continue;
      for (let j = 0; j < s.slots.length; j++) {
        const slot = s.slots[j]!;
        if (!slot.counted || sets[i]![j]! >= maxPerSlot) continue;
        const group = primaryGroup(slot.pattern);
        if (!group || targets[group] <= 0) continue;
        const deficit = (targets[group] - planned[group]) / targets[group];
        if (deficit <= 0) continue;
        if (planned[group] + 1 > caps[group] + 1e-9) continue;
        const score = deficit + bonus[slot.role] - spread * sets[i]![j]!;
        if (!best || score > best.score + 1e-9) best = { i, j, score };
      }
    }
    if (!best) break;
    const { i, j } = best;
    sets[i]![j]! += 1;
    used[i]! += 1;
    const pattern = sessions[i]!.slots[j]!.pattern;
    direct[primaryGroup(pattern)!] += 1;
    for (const [g, c] of contributions(pattern)) planned[g] = round2(planned[g] + c);
  }

  return { sets, volume: PROGRAM_MUSCLE_GROUPS.map((muscle) => ({ muscle, min: 0, max: 0, target: targets[muscle], planned: planned[muscle], direct: direct[muscle] })) };
}
