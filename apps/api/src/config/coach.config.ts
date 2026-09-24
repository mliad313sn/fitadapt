import { defineConfig } from '@fitadapt/shared';

/**
 * M11 AI-coach proxy limits (CLAUDE.md rule 4; ADR-031). Engineering defaults
 * without an external source: they bound cost, abuse and how long
 * conversations (health data) are kept, not a training or health value.
 * Rate limits live in Redis (never timer state). Awaiting review: the
 * retention with seat B1 (records of processing), the tiers with the PO and
 * M16 (subscriptions), the token budget with the M11 evals at Gate 2.
 */
const SOURCE = 'docs/adr/ADR-031-ai-coach.md (engineering default, no external source)';

export const coachConfig = defineConfig({
  /** Messages a free-tier user may send per window. */
  freeMessagesPerWindow: { value: 40, unit: 'messages', source: SOURCE, validated: false },
  /** Messages a premium user may send per window (M16 decides who is premium; until then everyone is free). */
  premiumMessagesPerWindow: { value: 200, unit: 'messages', source: SOURCE, validated: false },
  /** Window of the per-tier message limit. */
  messageWindowSeconds: { value: 86_400, unit: 's', source: SOURCE, validated: false },
  /** Short burst limit, any tier (also counts conversation starts). */
  burstPerMinute: { value: 10, unit: 'requests', source: SOURCE, validated: false },
  /** How long a cached answer to a general question (sent without personal context) is reused. */
  cacheTtlSeconds: { value: 86_400, unit: 's', source: SOURCE, validated: false },
  /** Conversations are deleted this long after their last message (minimal retention, spec Rules; configurable). */
  conversationRetentionDays: { value: 90, unit: 'days', source: SOURCE, validated: false },
  /** Largest model reply (a short chat answer; the output guard also caps text at 4,000 characters). */
  maxOutputTokens: { value: 2048, unit: 'tokens', source: SOURCE, validated: false },
  /** Time budget of one model request before the coach answers without the model. */
  modelTimeoutMs: { value: 30_000, unit: 'ms', source: SOURCE, validated: false },
});

export type CoachConfigKey = keyof typeof coachConfig;

export function coachConfigValue(key: CoachConfigKey): number {
  return coachConfig[key].value;
}

/**
 * Model routing (spec: "routing of simple requests to a smaller model").
 * Model ids from the claude-api reference: the main model for plan changes and
 * multi-turn talk, the smaller one for general questions answered from the
 * reviewed content. Not numbers, so not rule-4 config; changing them is an
 * ADR-level decision (evals must be re-run).
 */
export const COACH_MODELS = Object.freeze({ main: 'claude-opus-5', small: 'claude-haiku-4-5' });
