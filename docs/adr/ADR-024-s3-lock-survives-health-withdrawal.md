# ADR-024: The S3 intensity lock survives a health-consent withdrawal (server side)

- Status: Proposed (fix wave after the deep code review; finding MOB-08, server side). The retention choice below is **validated: false** and needs seat B1 (data protection) and counsel before launch.
- Date: 2026-09-24
- Deciders: FIX-C engineer (apps/api). Needs review by B1 (retention basis, Art. 9 condition), counsel (legal-obligation / legal-claims basis), A1 (the lock rule is unchanged, only where its facts live) and the M05 and FIX-D owners (the device must read the retained lock).
- Amends: ADR-004 (consent model: what a health withdrawal erases), ADR-017 (S3 red-flag flow), ADR-023 (causal ids on red flags and attestations).

## Context

S3 (docs/specs/00-product-vision.md): a red flag ends the session and locks intensity "until the user attests medical review". CLAUDE.md rule 1 forbids weakening S1–S7.

On the server the lock was derived only from `execution_logs` (`intensityLockStatus` in packages/safety). Execution logs are health data: withdrawing the health consent erases them (ADR-004, `healthWithdrawalHandler`). The review (review/mobile.md MOB-08) showed the consequence: red flag → withdraw health consent → grant it again on a new phone or after a reinstall → no red-flag log exists anywhere → the lock is gone without the attestation. The server accepted the next full-intensity session.

## Decision

1. **A separate, minimal lock record.** Table `safety_locks` (migration `0010_fix_s3_lock_survives_withdrawal`) keeps, per user, only what S3's lock rule reads:
   - whether a row is a red flag or a medical-review attestation;
   - its device time, as recorded;
   - the ADR-023 causal ids: the flag's id, and the flags an attestation names.

   It never keeps the symptom, the plan, a pain score or any other health value. It is written in the sync transaction of the execution log it comes from (`recordLockFact`, ADR-009 same-transaction rule). The lock rule is still packages/safety's `intensityLockStatus`, applied to these rows in stored order (`retainedIntensityLock`). Nothing is re-implemented.
2. **Kept only while the lock is on.** The attestation that lifts the lock deletes the user's rows (`pruneLiftedLock`). A health-consent withdrawal also prunes a lock that is already lifted. So a user without an active lock has no row at all.
3. **Not erased by a health-consent withdrawal while the lock is on.** `healthWithdrawalHandler` erases the health collections as before and keeps active lock rows. The rows are erased with the account (FK cascade), appear in the in-app export (`safetyLocks`, GDPR Art. 15/20) and are listed in the data inventory.
4. **The server gate reads both.** A started session is refused (`safety.s3.intensity_locked`) when either the stored execution logs or the retained lock facts give a lock.
5. **The device can read it.** `GET /v1/safety/intensity-lock` returns `{ locked, since, flagIds }`. `flagIds` are the flags an attestation must name to lift the lock (ADR-023). A device that no longer holds the red flag can still show the lock and write the attestation that names them. This endpoint is read-only: the lock is set and lifted only through synced execution logs. Wiring the device to it is FIX-D's scope (apps/mobile).
6. **Existing data.** The migration copies the S3 facts of execution logs already stored, in their stored order. The next attestation or health withdrawal prunes rows of locks already lifted.

## Retention basis (validated: false)

Proposed basis for keeping the rows after the health consent is withdrawn. This needs B1 and counsel sign-off; nothing here is counsel-approved.

- The fact that intensity is locked after a red flag is special-category data: it reveals that a symptom occurred, but not which one.
- Processing without consent needs an Art. 9(2) condition. Candidates:
  - (f) establishment, exercise or defence of legal claims, with Art. 17(3)(e) as the erasure exception. This is the same rationale as the defensibility log (L6/L11), which already keeps the S3 events pseudonymously.
  - (c) vital interests, while the person is not in a position to consent. This condition probably does not fit.
- Storage limitation: the rows exist only while the lock is on, hold only the S3 inputs, and are erased with the account.
- **Open for counsel:**
  - whether a user may instead be offered "delete everything including the lock", which is account deletion today;
  - whether an account re-created with the same email should inherit the lock (not implemented: a new account is a new subject, residual risk R1).

## Consequences

- A health withdrawal can no longer lift S3 on the server. Until FIX-D wires the endpoint, a device reinstalled after a withdrawal shows unlocked. Its sessions are then refused on sync (`safety.s3.intensity_locked`), and the device keeps them in its outbox. The server is the safety net, not yet the user experience.
- Residual R1: deleting the account and signing up again starts without the lock (account deletion must erase everything; see above).
- Residual R2: the ADR-017 red-flag deload (a week after the attestation) is derived from the erased logs. After a withdrawal it is no longer enforced by the server. S3 itself is. For A1 and M05.
- Residual R3: if the retained rows are a strict suffix of the logs (rows pruned at an earlier lift), the retained reading can be at most stricter than the full log's, never looser. See the pruning argument in docs/status/FIX-api-security.md.

## Alternatives considered

- **Derive the lock from the defensibility log** (`safety.event` S3 `intensity_locked` and `safety.attested`). Rejected: those events carry no ADR-023 causal ids, so an offline attestation that did not cover a newer flag would read as a lift. It would also make the legal file a runtime input.
- **Keep the whole execution log for red flags.** Rejected: it keeps the symptom and more than S3 needs (data minimisation).
- **Refuse the withdrawal while locked.** Rejected: consent must be withdrawable at any time (GDPR Art. 7(3)).
