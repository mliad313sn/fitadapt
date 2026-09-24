# ADR-024: Defensibility log — anchored chain heads, and a purge that cannot truncate

- Status: Accepted (security fix, FIX-packages-tooling, finding PKG-01)
- Date: 2026-09-24
- Deciders: fix engineer, on the packages/tooling review. Needs review by B1 (data protection: the head table is kept after a purge) and the M19 owner (runtime database role).
- Amends: ADR-009 (defensibility log).

## Context

ADR-009 said tampering by a table owner is "detected". The review (PKG-01) showed that this held only for edits:

- `verifyChain` checked that each event links to the previous one. It had no expected length or head, so **any prefix of a valid chain verified `ok: true`**, and so did an empty chain. Removing the end of a chain (for example the S3 `safety.event` written after a red-flag report) or the whole chain was invisible to the legal-hold export.
- The only guard against `DELETE` was `current_setting('app.defensibility_purge') = 'on'`, a placeholder GUC that **any session can `SET LOCAL`**. Deleting rows needed no ownership, no disabled trigger and no hash recomputation — an insider, or anyone with SQL injection anywhere in the API, could do it.
- The planned M19 mitigation (a non-owner application role) would not have closed it, because that role could still set the GUC.

## Decision

1. **Anchored head per chain.** A new table `defensibility_heads (chain, length, head_hash, open_holds, purged_length, purged_head_hash, purged_at)` is maintained by a `BEFORE INSERT` trigger on `defensibility_events`, in the append transaction. The trigger also refuses an insert that does not extend the head (`chain_seq = length + 1`, `prev_hash = head_hash`), so the database itself refuses forks and rewritten tails.
2. **Heads are not writable directly.** A guard trigger refuses `INSERT`/`UPDATE` unless it runs inside a `defensibility_events` trigger (`pg_trigger_depth() >= 2`), and always refuses `DELETE`. `TRUNCATE` is refused on both tables.
3. **Verification needs the anchor.** `verifyChain(events, expected?: ChainHead)` reports `truncated` when the chain is shorter than the anchor and `head_mismatch` when its last hash differs. `DefensibilityLog.verify` and the legal-hold export read events and head in one repeatable-read snapshot and compare them; the export carries `anchoredHead`. `MemoryDefensibilityLog` keeps its own heads the same way.
4. **Deletion is structural, not a flag.** The GUC gate is gone. A `DELETE` is refused for the global chain and for a chain with an open legal hold (`open_holds`, counted by the insert trigger). The first deleted row turns the head into a **tombstone** (length 0, the purged length and hash kept). A deferred constraint trigger refuses the commit unless the whole chain is gone and the global chain holds a `retention.purged` event whose `chainDigest`, `eventCount` and `headHash` match the tombstone. A truncation is therefore impossible with the triggers on, and a whole-chain deletion always leaves a permanent record in the global chain and a tombstone head.
5. **One purge path.** `defensibility_purge_chain(chain, cutoff)` (`SECURITY DEFINER`, `EXECUTE` revoked from `PUBLIC`) refuses the global chain, a bad cutoff and a chain whose last event is not older than the cutoff, then deletes the whole chain. `DefensibilityLog.purgeExpired` calls it and appends `retention.purged` in the same transaction.
6. **Separate purger role where possible.** When the migrating role can create roles (docker compose and CI, where it is a superuser), the migration creates `fitadapt_defensibility_purger` (`NOLOGIN`), makes it the owner of the purge function and grants it only `SELECT, DELETE` on events and `SELECT, UPDATE` on heads. The delete trigger then refuses **every other role, including the application's**, even for a correctly recorded whole-chain delete. Where the migrating role cannot create roles, the migration logs a notice and the structural rules of point 4 still hold; an integration test asserts the behaviour of whichever mode is active and passed in both (a non-superuser owner and a superuser owner).
7. **A tampered chain can still be exported.** If the database refuses to extend a chain (it no longer matches its head), the legal-hold export logs the access in the global chain instead and returns the chain with `integrity: { ok: false, reason: 'truncated' }`.

## Alternatives considered

- **Signed periodic checkpoints (HMAC of all heads with an application key).** Stronger against someone with database access only, but the key sits beside the database credentials in the API's environment, and it needs a scheduler. Kept as the M19 external anchoring step (daily head digest in write-once storage), which also covers the owner case below.
- **Keep the GUC but check the role.** Any role can set a GUC; identity must come from `current_user` inside a `SECURITY DEFINER` function owned by a separate role.
- **Allow partial purges.** Retention is per whole chain already (ADR-009); a partial purge would be indistinguishable from truncation.

## Consequences

- Removing the end of a chain or a whole chain is **refused** with the triggers on, and **detected** (`truncated`) when an owner disables them.
- Remaining limit: a role that can disable triggers (the table owner) and also rewrite `defensibility_heads` consistently can still hide a truncation; this is the same class as the recomputation attack of ADR-009 and is closed only by (a) a runtime application role that does not own the tables and (b) external anchoring of heads — both M19 launch items. A superuser can `SET ROLE` to the purger role.
- Integration tests reset tables with `TRUNCATE` inside a transaction that disables the user triggers of the two defensibility tables (test harness only).
- `defensibility_heads` is listed in the data inventory (pseudonymous, retained; no personal data).
- `occurredAt` must be ISO 8601 UTC with `Z` (PKG-11); the purge compares it as text.
