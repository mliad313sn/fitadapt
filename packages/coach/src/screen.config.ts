import { defineConfig } from '@fitadapt/shared';

/**
 * Boundaries of the deterministic pre-screen (CLAUDE.md rule 4). They are
 * NOT nutrition values: they only decide when a message is answered by the
 * fixed extreme-dieting reply instead of the model. The engine's S4 floors
 * (packages/safety) are unchanged and always apply. Conservative engineering
 * defaults for seat A4 (disordered-eating guardrails) and B4.
 */
const SOURCE = 'docs/adr/ADR-031-ai-coach.md (engineering default for the chat pre-screen; not a nutrition value; S4 floors live in packages/safety)';

export const COACH_SCREEN_CONFIG = defineConfig({
  /** A daily intake a message names below this is treated as extreme dieting (fixed reply, no model). */
  veryLowIntakeKcal: { value: 1200, unit: 'kcal/day', source: SOURCE, validated: false },
  /**
   * A loss a message asks for faster than this is treated as extreme dieting. Below the S4 ceiling
   * (1 % of body weight a week) for every adult weight above 100 kg, so it is at least as strict.
   */
  fastLossKgPerWeek: { value: 1, unit: 'kg/week', source: SOURCE, validated: false },
});
