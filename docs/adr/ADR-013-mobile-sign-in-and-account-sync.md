# ADR-013 — Sign-in in the app and account sync of the device ledgers

- Status: Accepted (M01)
- Date: 2026-09-23
- Deciders: M01 engineer; security review of the device session with the M00 auth thresholds (PE-11, seat B1 for the privacy aspects)

## Context

M00 built one-time-code auth in the API but no sign-in screen, so the device sync client had no token and pushes stayed in the outbox. M17 left export and deletion disabled in the app and the device consent ledger unsent. M20 records acceptances on the server but had no device-side acceptance. The app is offline first: consents, acceptances and notices are often given in airplane mode and uploaded later. The server previously stamped every record with its own receipt time.

## Decision

- **Optional sign-in.** The app works without an account; "Sign in to back up and sync" on the home screen opens an email one-time-code flow (`/v1/auth/otp/*`). Error codes map to the existing `errors.auth.*` copy.
- **Tokens.** The refresh token lives in the OS keystore through `expo-secure-store` (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`), never in SQLite or logs; the access token stays in memory and is refreshed (rotation) 30 s before expiry (`accessTokenRefreshMarginSeconds`, config, `validated: false`). A refresh answered with `invalid_refresh_token`, `refresh_token_reused` or `unauthorized` signs the device out. The email and the code are never stored.
- **Account sync order.** On sign-in and whenever connectivity returns, `runAccountSync` uploads, in this order: consent decisions (M17 ledger, by decision time), L2 acceptances, L3 notice impressions, then runs the sync outbox. The server refuses health collections without the health consent, so consents must arrive first. A network failure stops the run; the next run resumes. A record refused for good (4xx other than 401/429) is not retried and stays in the device ledger; server errors are rethrown.
- **Device time and idempotency on the server.** `POST /v1/privacy/consents`, `/v1/legal/acceptances` and `/v1/legal/notices` take an optional device record `id` (a retried upload is stored once, `ON CONFLICT DO NOTHING`, and logged once) and an optional device time (`recordedAt`, `acceptedAt`, `occurredAt`). The device time is accepted within `clientClockSkewSeconds` (300 s) in the future and `offlineRecordMaxAgeSeconds` (30 days) in the past (config, `validated: false`); a new `received_at` column keeps the server receipt time beside it (migration `0005_m01_client_timestamps`). An acceptance is checked against the texts in force at its device time, so an offline acceptance of v1 uploaded after v2 came into force is recorded and correctly reported as needing re-acceptance.
- **Privacy client.** Export and deletion (M17) are enabled once signed in; the local wipe also clears the M01 ledgers and the session.
- **Device defensibility buffer.** The device keeps a hash-chained buffer (`packages/legal` `chainEvent`, chain `device`) of acceptances, notices and consent decisions for offline evidence; the server writes the authoritative log when the records are uploaded.

## Alternatives considered

- **Mandatory sign-in before onboarding**: breaks offline first and adds friction before the first workout (activation KPI).
- **Server time only**: an acceptance given offline before a workout would look as if it came after it; the defensibility file must show what the user saw and when.
- **Unbounded client time**: lets a client backdate at will. A bounded window plus the server receipt time keeps both facts.
- **Uploading the ledgers through the generic sync collections**: consents and acceptances have their own append-only tables, rules and log events (ADR-004, ADR-008); reusing their endpoints keeps one rule set.

## Consequences

- A second device does not receive the consent ledger (the API returns consent states, not records): the user decides again on that device. Open question.
- The upload ledger is device-local; after a reinstall records already uploaded are not on the device any more and nothing is re-sent.
- Safety events written after a screening push run outside the sync transaction; if logging fails after the change is applied, the replay returns `duplicate` and the event is not written again (known limit; M19 should make the log write transactional with the store).
- Step-up re-authentication before export and deletion (M17 open question 6) is not built.
