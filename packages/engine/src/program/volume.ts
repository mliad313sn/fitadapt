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

/** Planned (fractional) and direct weekly sets per group for a given allocation. */
export function volumeOf(sessions: readonly AllocationSession[], sets: readonly (readonly number[])[], targets: Readonly<Record<ProgramMuscleGroup, number>>): VolumeTarget[] {
  const planned = Object.fromEntries(PROGRAM_MUSCLE_GROUPS.map((g) => [g, 0])) as Record<ProgramMuscleGroup, number>;
  const direct = Object.fromEntries(PROGRAM_MUSCLE_GROUPS.map((g) => [g, 0])) as Record<ProgramMuscleGroup, number>;
  sessions.forEach((s, i) =>
    s.slots.forEach((slot, j) => {
      if (!slot.counted) return;
      const n = sets[i]![j]!;
      const group = primaryGroup(slot.pattern);
      if (!group || n === 0) return;
      direct[group] += n;
      for (const [g, c] of contributions(slot.pattern)) planned[g] = round2(planned[g] + c * n);
    }),
  );
  return PROGRAM_MUSCLE_GROUPS.map((muscle) => ({ muscle, min: 0, max: 0, target: targets[muscle], planned: planned[muscle], direct: direct[muscle] }));
}

const ROLE_RANK = { accessory: 0, secondary: 1, primary: 2 } as const;

/**
 * M05 scheduled deload (volume −40–50 %): the deload week keeps the sessions
 * and slots of the accumulation week before it with `reduction` of its sets
 * removed: first each muscle group down to at most `reduction` of its own
 * direct sets (rounded up, so no group is above half its accumulation
 * volume), then over the whole week down to `reduction` of all its sets
 * (at least half kept, rounded up). Sets go one at a time from the slot with
 * the most sets (accessories, then secondaries, then primaries; later
 * sessions first), keeping ≥ 1 set per slot while possible.
 */
export function deloadAllocation(sessions: readonly AllocationSession[], previous: readonly (readonly number[])[], reduction: number): number[][] {
  const sets = previous.map((row) => [...row]);
  const total = sets.flat().reduce((a, b) => a + b, 0);
  const keep = Math.max(1, Math.ceil(total * (1 - reduction)));
  let current = total;
  const pick = (minSets: number, allowPrimary: boolean, only: (i: number, j: number) => boolean): [number, number] | null => {
    let best: [number, number] | null = null;
    for (let i = 0; i < sets.length; i++) {
      for (let j = 0; j < sets[i]!.length; j++) {
        const n = sets[i]![j]!;
        const role = sessions[i]!.slots[j]!.role;
        if (n < minSets || (!allowPrimary && role === 'primary') || !only(i, j)) continue;
        if (!best) {
          best = [i, j];
          continue;
        }
        const b = sets[best[0]]![best[1]]!;
        const br = ROLE_RANK[sessions[best[0]]!.slots[best[1]]!.role];
        if (n > b || (n === b && (ROLE_RANK[role] < br || (ROLE_RANK[role] === br && (i > best[0] || (i === best[0] && j > best[1])))))) best = [i, j];
      }
    }
    return best;
  };
  const take = (at: [number, number]) => {
    sets[at[0]]![at[1]]! -= 1;
    current -= 1;
  };
  // 1. Each group at most (1 − reduction) of its own direct sets.
  for (const g of PROGRAM_MUSCLE_GROUPS) {
    const inGroup = (i: number, j: number) => sessions[i]!.slots[j]!.counted && primaryGroup(sessions[i]!.slots[j]!.pattern) === g;
    const directOf = () => sets.reduce((sum, row, i) => sum + row.reduce((a, n, j) => a + (inGroup(i, j) ? n : 0), 0), 0);
    const limit = Math.ceil(directOf() * (1 - reduction));
    while (directOf() > limit) take((pick(2, true, inGroup) ?? pick(1, true, inGroup))!);
  }
  // 2. The whole week down to (1 − reduction) of its sets.
  const any = () => true;
  while (current > keep) {
    const at = pick(2, true, any) ?? pick(1, false, any);
    if (!at) break;
    take(at);
  }
  return sets;
}
