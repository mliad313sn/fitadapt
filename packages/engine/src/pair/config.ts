import { defineConfig } from '@fitadapt/shared';

/**
 * M09 Fair Pair coefficients and thresholds (CLAUDE.md rule 4). Every value
 * is `validated: false`: none has been reviewed by the council.
 * Seats: A3 (S&C coach) for the turn time model and the equipment
 * changeover; A5 (exercise physiologist) for the relative-intensity
 * coefficients of the Fair Challenge Score; A6 (behavioural scientist) for
 * the score design (no reward for exceeding the prescription, nothing
 * counted after pain, no comparison of absolute loads).
 *
 * The pair planner never changes a prescription: loads, variants, reserves
 * and rest targets come from each partner's own M02 plan. Rest targets are a
 * minimum the timeline never shortens (not configuration).
 */
const ENG = 'M09 engineering default (conservative choice by the engineer); no external source';
const SPEC = 'docs/specs/M09-fair-pair-partner-training.md';

/** Version of the pair planner and score rules (stored in every SharedTimeline). */
export const PAIR_RULES_VERSION = '0.1.0';

export const PAIR_CONFIG = defineConfig({
  /** Handing over (the phone, the space) between two partners' turns. */
  'turn.handoverSeconds': { value: 10, unit: 's', source: ENG, validated: false },
  /** Changing the load on a shared single implement (one barbell, one pair of dumbbells) between partners' turns. */
  'equipment.changeoverSeconds': { value: 30, unit: 's', source: ENG, validated: false },
  /**
   * Turns make a pair session longer than either solo session: both sessions are generated for fewer minutes
   * (the engine's own time-boxing) until the shared timeline fits the time both have, in steps of this size…
   */
  'time.stepMinutes': { value: 1, unit: 'min', source: ENG, validated: false },
  /** …never below this many minutes per person (then the timeline is kept as it is and says it runs over). */
  'time.minimumMinutes': { value: 15, unit: 'min', source: ENG, validated: false },
  /**
   * Largest credit a set earns, as a share of its expected volume (1 = no extra points for going past the
   * prescription: the score never rewards grinding reps or adding load, L4).
   */
  'score.setCreditCap': {
    value: 1,
    source: `${SPEC} (Rules: "Fair Challenge scoring … never rewards training through pain"); cap at the prescription chosen by the engineer; A6 to review`,
    validated: false,
  },
  /**
   * Variant coefficient when the person did another exercise than prescribed (an engine swap) and the
   * %-bodyweight of either is unknown: counted like the prescribed one (swaps keep the stimulus, M02/M06).
   */
  'score.unknownVariantCoefficient': { value: 1, source: ENG, validated: false },
});
