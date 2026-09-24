-- API-3: the idempotency ledger (sync_mutations.result) no longer keeps a
-- copy of the conflicting record. A conflict result stores only which record
-- it conflicted with (collection, record id: no data); a replay rebuilds
-- `current` from sync_changes, so data erased there (health-consent
-- withdrawal, ADR-004) is gone from the ledger too. Scrub the copies stored
-- before this fix.
UPDATE "sync_mutations"
SET "result" = ("result" - 'current') || jsonb_build_object(
  'currentRef',
  jsonb_build_object('collection', "result" -> 'current' -> 'collection', 'recordId', "result" -> 'current' -> 'recordId')
)
WHERE "result" ? 'current';
