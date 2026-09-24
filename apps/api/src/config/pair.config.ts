import { defineConfig } from '@fitadapt/shared';

/**
 * Limits of the multi-device Fair Pair relay (M09, ADR-021). Engineering
 * defaults without an external source (CLAUDE.md rule 4): they bound abuse
 * and storage, not a training or health value. Await security review
 * (PE-11 with seat B1). No timer lives here: rests and turns are timed on the
 * devices (ADR-001: Redis and the server never hold timer state).
 */
const SOURCE = 'docs/adr/ADR-021-fair-pair-partner-training.md (engineering default, no external source)';

export const pairConfig = defineConfig({
  /** How long a join code stays valid after the host creates the pair session. */
  joinWindowSeconds: { value: 1800, unit: 's', source: SOURCE, validated: false },
  /** Events one pair session may relay (a long session is a few hundred). */
  maxEventsPerSession: { value: 2000, unit: 'events', source: SOURCE, validated: false },
  /** Largest WebSocket message accepted. */
  maxMessageBytes: { value: 16 * 1024, unit: 'bytes', source: SOURCE, validated: false },
  /** A connection must say hello (with its access token) within this time, or it is closed. */
  helloTimeoutMs: { value: 10_000, unit: 'ms', source: SOURCE, validated: false },
});

export type PairConfigKey = keyof typeof pairConfig;

export function pairValue(key: PairConfigKey): number {
  return pairConfig[key].value;
}
