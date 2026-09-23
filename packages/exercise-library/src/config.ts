import { defineConfig } from '@fitadapt/shared';

/**
 * Stimulus-similarity model used to generate SUBSTITUTES edges (0–1).
 * similarity = w.pattern·[same pattern] + w.primary·J(primary muscles)
 *            + w.allMuscles·J(all muscles) + w.laterality·[same unilateral flag]
 *            + w.skill·(1 − |skill difference| / 4)
 * where J is the Jaccard index. The weights sum to 1.
 *
 * Every value is an engineering default without an external source and awaits
 * review by seat A3 (S&C) with A2 (physiotherapist) for substitutions
 * (docs/status/M06.md). Never set validated:true without a sign-off record.
 */
export const SIMILARITY_CONFIG = defineConfig({
  weightPattern: { value: 0.35, source: 'Engineering default (M06, ADR-011); no external source', validated: false },
  weightPrimaryMuscles: { value: 0.35, source: 'Engineering default (M06, ADR-011); no external source', validated: false },
  weightAllMuscles: { value: 0.15, source: 'Engineering default (M06, ADR-011); no external source', validated: false },
  weightLaterality: { value: 0.05, source: 'Engineering default (M06, ADR-011); no external source', validated: false },
  weightSkill: { value: 0.1, source: 'Engineering default (M06, ADR-011); no external source', validated: false },
  /** Pairs below this similarity get no SUBSTITUTES edge. */
  minSimilarity: { value: 0.5, source: 'Engineering default (M06, ADR-011); no external source', validated: false },
});
