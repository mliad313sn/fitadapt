# ADR-026: The phone's data lifecycle — one account per phone, atomic photo keys, a backup is never replaced, the device log is never discarded

- Status: Accepted (fix wave after the mobile code review, FIX-D)
- Date: 2026-09-24
- Deciders: fix engineer (FIX-D), on the review findings MOB-01…MOB-14 (`scratchpad/review/mobile.md`). Needs review by PE-11 (security: key staging, capture protection), B1 (data protection: account binding, guest withdrawal, evidence of hand-over) and B2 (counsel: evidentiary value of the partner's hand-over step and of the kept broken log segments).
- Amends: ADR-006 and ADR-020 (keys and photo backup), ADR-009 (defensibility log, device buffer), ADR-013 (sign-in and account sync), ADR-021 (Fair Pair on one phone).
- Number: the next free one at the time of writing; other fixers may collide, to be resolved at merge.

## Context

The mobile review found that the phone's local data had no owner and no lifecycle guarantees: an account wipe left in-memory stores that wrote deleted data back (MOB-01), any other account could sign in and receive the previous person's outbox (MOB-07), turning on the backup on a second phone made the first backup unreadable (MOB-02), adopting a backup key was not atomic (MOB-03), any database open error deleted the database (MOB-04), and a device log that did not verify was silently dropped (MOB-11).

## Decisions

1. **One account per phone's data (MOB-07).** The id of the account that first signs in is stored in `app_kv` (`device_account_id`, in the encrypted database). A sign-in by another account is refused: its new session is logged out at once and nothing is uploaded (`OtherAccountDataError`). The sign-in screen offers "delete this phone's data" (two steps), which erases the binding with the data. The consent/legal upload ledger is kept per account. Rejected: merging or silently re-assigning the data (mixes two people's health data); prompting "sign in as that account" only (no way out for a new owner of the phone). No change in `packages/sync`: the gate is before any token is kept.
2. **A wipe resets every store (MOB-01).** All stores are built in `apps/mobile/src/app-services.ts`; `wipeLocalData` erases the database and resets each store in place, and guest ledgers handed out before a wipe or a guest deletion can no longer write. Rejected: remounting the root (loses the confirmation and navigation state, and a pending async write could still use an old store).
3. **An existing backup is never replaced (MOB-02).** "Turn on backup" first asks the account; if a wrapped key exists, the phone asks for that backup's recovery code and joins it (adopts its key, restores, uploads its own photos). A new code is offered only when there is no backup. Restores skip and count envelopes that do not open. The server-side refusal of a replacing `PUT /key` is FIX-C's.
4. **Key adoption is atomic (MOB-03).** Re-encrypted copies are staged (`<id>.bin.new`), the new key is stored under a staging name (the commit point), then files are swapped and the key replaced. Before the commit a failure leaves the old state; after it, the swap is finished on the next key read or vault open.
5. **Only "not a database" resets the database (MOB-04)**, after one retry with `PRAGMA cipher_migrate`; every other error keeps the file and fails closed (`DatabaseOpenError` with the SQLite result name). A true key mismatch still replaces the file: it is unreadable by anyone, its outbox included (M04 open question 3 stands).
6. **The device defensibility buffer is segmented and never discarded (MOB-11).** A segment that does not verify is kept aside unchanged and a new segment starts with `log.segment_started` (new payload in `packages/legal`, cross-scope, FIX-E); a full segment (`device.segmentMaxEvents`, validated:false) is closed unchanged and linked by its head. Storage is bounded per append and per start-up check, not in total (evidence is not deleted on the device except with the account).
7. **Crypto-erasure is confirmed (MOB-14)** (`DeviceKeyStore.remove` is async and awaited; failures are reported without data) and **decrypted photos are not captured (MOB-12)**: expo-screen-capture (MIT) while the photos screen (photos, recovery code) is mounted.
8. **The partner answers for herself (MOB-09, MOB-10).** A hand-over step she must confirm opens every visit to her steps; her earlier health answers are never shown again; each of her consents can be withdrawn where it was given, with the owner's effects (health: answers and weight forgotten; the S3 lock in her execution logs is kept).

## Consequences

- A second person on the same phone must erase the first person's data from the phone before signing in (unsynced data of the first person is lost by that explicit choice, and the screen says so).
- Legacy installs signed in before this change have no binding until their next sign-in; their upload ledger stays under the old key.
- The kept broken segments and the hand-over confirmation are evidence of what happened on the device, not proof of identity: B2 to assess.
