import { defineConfig } from '@fitadapt/shared';

/**
 * Limits of the multi-device Fair Pair relay (M09, ADR-021). Engineering
 * defaults without an external source (CLAUDE.md rule 4): they bound abuse
 * and storage, not a training or health value. Await security review
 * (PE-11 with seat B1). No timer lives here: rests and turns are timed on the
 * devices (ADR-001: Redis and the server never hold timer state).
 */
const SOURCE = 'docs/adr/ADR-021-fair-pair-partner-training.md (engineering default, no external source)';
const REVIEW = 'docs/status/FIX-api-security.md (API security review; engineering default, no external source)';

export const pairConfig = defineConfig({
  /** How long a join code stays valid after the host creates the pair session. */
  joinWindowSeconds: { value: 1800, unit: 's', source: SOURCE, validated: false },
  /** Events one pair session may relay (a long session is a few hundred). */
  maxEventsPerSession: { value: 2000, unit: 'events', source: SOURCE, validated: false },
  /** Largest WebSocket message accepted. */
  maxMessageBytes: { value: 16 * 1024, unit: 'bytes', source: SOURCE, validated: false },
  /** A connection must say hello (with its access token) within this time, or it is closed. */
  helloTimeoutMs: { value: 10_000, unit: 'ms', source: SOURCE, validated: false },
  // API-4 / API-10 (docs/status/FIX-api-security.md): join-code guessing and pair-session creation are rate-limited.
  /** Join attempts one account may make per window (a person types a code a few times at most). */
  joinAttemptsPerUserPerWindow: { value: 10, unit: 'attempts per user per window', source: REVIEW, validated: false },
  /** Join attempts from one client address per window (several people behind one address). */
  joinAttemptsPerIpPerWindow: { value: 30, unit: 'attempts per address per window', source: REVIEW, validated: false },
  /** Pair sessions one account may start per window. */
  createsPerUserPerWindow: { value: 20, unit: 'sessions per user per window', source: REVIEW, validated: false },
  pairRateLimitWindowSeconds: { value: 900, unit: 's', source: REVIEW, validated: false },
  /** A new join code that collides with a stored one is drawn again, this many times at most (API-12). */
  joinCodeDrawAttempts: { value: 5, unit: 'draws', source: REVIEW, validated: false },
});

export type PairConfigKey = keyof typeof pairConfig;

export function pairValue(key: PairConfigKey): number {
  return pairConfig[key].value;
}
