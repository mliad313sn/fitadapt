import { defineConfig, type ConfigValue } from '@fitadapt/shared';

/**
 * Coach orchestration limits (CLAUDE.md rule 4). None is a training or health
 * value: they bound how much the model may do in one turn and how retrieval
 * decides that a question is covered by the knowledge registry. Engineering
 * defaults without an external source, awaiting review (ADR-031; the
 * retrieval threshold with the M11 evals at Gate 2, seats A1 and B4).
 */
const SOURCE = 'docs/adr/ADR-031-ai-coach.md (engineering default, no external source)';

export const COACH_CONFIG = defineConfig({
  /** Tool calls the model may make in one user turn (all of them audited). */
  maxToolCallsPerTurn: { value: 4, unit: 'calls', source: SOURCE, validated: false },
  /** Model requests in one user turn (the first answer plus the rounds after tool results). */
  maxModelRounds: { value: 3, unit: 'requests', source: SOURCE, validated: false },
  /** Earlier messages of the conversation sent to the model (data minimisation: the rest stays on the server). */
  historyMessages: { value: 8, unit: 'messages', source: SOURCE, validated: false },
  /** Retrieval: a knowledge entry must match at least this many distinct keywords of the question to ground an answer. */
  retrievalMinScore: { value: 1, unit: 'keywords', source: SOURCE, validated: false },
  /** Retrieval: entries passed to the model as grounding. */
  retrievalMaxEntries: { value: 3, unit: 'entries', source: SOURCE, validated: false },
  /** Offline and "shorter" requests without a number: minutes taken off today's session. */
  shorterByMinutes: { value: 15, unit: 'min', source: SOURCE, validated: false },
});

export type CoachConfigKey = keyof typeof COACH_CONFIG;

export function coachValue(key: CoachConfigKey): number {
  return (COACH_CONFIG[key] as ConfigValue).value;
}
