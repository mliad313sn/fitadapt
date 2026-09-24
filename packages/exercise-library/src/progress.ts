import { forecastLadderMilestone, type DateOf, type LadderLookup, type LadderMilestone } from '@fitadapt/engine';
import type { IsoDate, MilestoneForecast, SessionHistoryEntry } from '@fitadapt/shared';
import { LADDERS } from './seed/ladders.js';

/**
 * M04 bound to the M06 seed: the ladder rung of each exercise (variant level
 * over time) and the skill milestones the dashboard can forecast. The
 * forecasting itself is the engine's (packages/engine `analytics`).
 *
 * A milestone path is the seed ladder toward the target, with the gym and
 * home equivalents placed on the rung they stand for (e.g. the assisted
 * pull-up machine next to the band-assisted pull-up), so P2's gym and home
 * sessions count toward the same first strict pull-up. The placement is the
 * engineer's reading of the ladders and awaits seat A3 (S&C coach), like the
 * ladders themselves.
 */
const ladder = (id: string) => LADDERS.find((l) => l.id === id)!.steps;

const rungOf = new Map<string, { ladderId: string; rung: number }>();
for (const l of LADDERS) l.steps.forEach((step, rung) => step.forEach((exerciseId) => rungOf.has(exerciseId) || rungOf.set(exerciseId, { ladderId: l.id, rung })));

/** The first seed ladder an exercise is on, and its rung there (M02's pull, push and squat ladders come first). */
export const ladderLookup: LadderLookup = (exerciseId) => rungOf.get(exerciseId) ?? null;

export const MILESTONE_IDS = ['first_pull_up', 'first_push_up', 'first_dip', 'first_pistol_squat', 'first_bar_muscle_up'] as const;
export type MilestoneId = (typeof MILESTONE_IDS)[number];

const withEquivalents = (steps: readonly (readonly string[])[], extra: Readonly<Record<string, readonly string[]>>) => steps.map((step) => [...step, ...step.flatMap((id) => extra[id] ?? [])]);

export const MILESTONES: Readonly<Record<MilestoneId, LadderMilestone>> = Object.freeze({
  first_pull_up: { ladderId: 'pull', steps: withEquivalents(ladder('pull').slice(0, 7), { band_assisted_pull_up: ['assisted_pull_up_machine'] }), targetExerciseId: 'pull_up' },
  first_push_up: { ladderId: 'push', steps: ladder('push').slice(0, 5), targetExerciseId: 'push_up' },
  first_dip: { ladderId: 'dip', steps: ladder('dip').slice(0, 4), targetExerciseId: 'parallel_bar_dip' },
  first_pistol_squat: { ladderId: 'single_leg_squat', steps: ladder('single_leg_squat'), targetExerciseId: 'pistol_squat' },
  first_bar_muscle_up: { ladderId: 'muscle_up_bar', steps: ladder('muscle_up_bar'), targetExerciseId: 'bar_muscle_up' },
});

export interface MilestoneView {
  readonly id: MilestoneId;
  readonly forecast: MilestoneForecast;
}

/**
 * The milestones worth showing: those whose path the user has trained on
 * (at least one done set of an exercise of the path), forecast from the
 * history. A milestone reached is shown as reached.
 */
export function milestonesFor(history: readonly SessionHistoryEntry[], dateOf: DateOf, today: IsoDate): MilestoneView[] {
  const trained = new Set(history.flatMap((h) => h.exercises.filter((e) => e.performed.some((s) => s.status === 'done')).map((e) => e.exerciseId)));
  return MILESTONE_IDS.filter((id) => MILESTONES[id].steps.some((step) => step.some((e) => trained.has(e)))).map((id) => ({ id, forecast: forecastLadderMilestone(history, MILESTONES[id], dateOf, today) }));
}
