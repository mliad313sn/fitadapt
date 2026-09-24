# ADR-028: API abuse limits, bounded waits and the trusted-proxy hop count

- Status: Proposed. Fix wave after the deep code review (review/api-security.md, findings API-1, 4, 6, 7, 8, 9, 10, 12). Every value below is **validated: false** and awaits security review (seat B1) and operations (M19).
- Date: 2026-09-24
- Deciders: FIX-C engineer (apps/api).
- Amends: ADR-003 (sessions: logout ends the pair WebSocket too), ADR-006 (edge proxy), ADR-021 (pair relay limits, eight-character join codes).

## Context

The API security review found that several paths were bounded by nothing:

- **Pool waits.** Pool connections could be waited for forever (API-1).
- **Pair join codes.** Six-character codes could be guessed with no rate limit (API-4).
- **Photo uploads.** Bodies were read before authentication, with no quota (API-7).
- **Append-only writes.** Tables that are never purged could be grown at will (API-10).
- **The pair WebSocket.** It outlived logout (API-6) and had no cap on connections, queues or rooms (API-9).
- **Rate-limit buckets behind the proxy.** Behind the planned edge proxy, every per-address bucket would be shared by all users (API-8).

## Decision

### 1. Bounded waits (API-1)

The pool gets these limits from `config/db.config.ts`:

- `connectionTimeoutMillis`;
- `statement_timeout`, which also covers a wait for the per-user sync lock;
- `idle_in_transaction_session_timeout`.

A stuck request fails; it no longer hangs the process. The root cause is fixed separately: a validator reads through the transaction it runs in (see FIX-api-security API-1).

### 2. Rate limits

All limits use the existing Redis fixed-window `RateLimiter`. Keys are keyed hashes only, never an id or an address. Limits are per account, and per client address where the attacker needs no account state.

| What | Limit (config) | Why |
|---|---|---|
| Pair join | 10 / 15 min per account, 30 / 15 min per address (`pair.config.ts`) | Code guessing. Once limited, even the right code is refused. |
| Pair create | 20 / 15 min per account | Rows that are never purged, plus defensibility events. |
| Consent decisions | 60 / h per account (`privacy.config.ts`) | Never-purged ledger, plus the cost of `hasConsent` on every health push. |
| Legal acceptances, notices | 60 / h, 300 / h per account | Never-purged tables, plus defensibility events. |
| Photo uploads | 120 / h per account, 1 GiB stored (`photos.config.ts`) | Memory and storage. |

Two exceptions:

- A **withdrawal of a consent that is granted is never refused** (GDPR Art. 7(3)).
- An offline backlog above a limit is refused with 429. The device uploads it on a later sync.

### 3. Authentication before the body (API-7)

Every authenticated route authenticates in `onRequest`, before Fastify reads or parses the body.

### 4. Join codes (API-4)

A join code has eight characters from a 32-letter alphabet, about 1.1·10¹² codes (`PAIR_JOIN_CODE_LENGTH` in packages/shared). A code whose hash collides with a stored one is drawn again instead of answering 500 (API-12).

### 5. The pair WebSocket (API-6, API-9)

- The sign-in session is re-checked:
  - on every message;
  - every `sessionRecheckIntervalMs`;
  - when the access token expires.
- A logout or a refresh-token reuse on this instance closes the session's sockets at once (`AuthService.onSessionRevoked`). Close code 4401.
- Connections still waiting for their hello are capped per process and per address. The upgrade is answered 429.
- Each socket's queue depth and message rate are bounded. Close code 4429.
- A room is freed when its last socket closes.

### 6. Trusted proxy (API-8)

- Env `TRUST_PROXY_HOPS` (default 0) is the exact number of reverse proxies in front of the API. The API trusts exactly that many X-Forwarded-For hops, for `request.ip` and for the WebSocket's client address (`clientAddress`).
- **0**: X-Forwarded-For is ignored. This is correct locally and whenever the API is reached directly.
- **The M19 edge**: set the hop count to the number of proxies the platform puts in front of the API, usually 1.
- **Never set it higher than the real number.** One hop too many lets a client choose its own address, and so its own rate-limit bucket.
- If the platform gives a fixed proxy address list instead, prefer that: replace the hop function with the address list. This is a one-line change in `app.ts`.

## Consequences

- None of these limits is validated. The M19 launch check must list them (docs/status/FIX-api-security.md).
- Rate limits live in Redis. When Redis is unavailable the limited routes fail, as the sign-in routes already do.
- The WebSocket revocation push is per instance. Other instances close a revoked socket on their next re-check, at most `sessionRecheckIntervalMs` later, or on the next message.
