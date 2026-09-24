CREATE TABLE "defensibility_heads" (
	"chain" text PRIMARY KEY NOT NULL,
	"length" integer NOT NULL,
	"head_hash" text NOT NULL,
	"open_holds" integer DEFAULT 0 NOT NULL,
	"purged_length" integer,
	"purged_head_hash" text,
	"purged_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- PKG-01 (ADR-024, amending ADR-009): anchored chain heads and a purge that
-- cannot truncate. The head row of each chain is written by trigger in the
-- same transaction as the event, so the verifier can tell a complete chain
-- from a prefix of it. DELETE is refused unless it removes a whole chain that
-- has no open legal hold and whose purge is recorded as retention.purged in
-- the global chain; the GUC gate of 0004 (settable by any session) is gone.
-- Backfill the heads of existing chains before the guard exists.
INSERT INTO defensibility_heads (chain, length, head_hash, open_holds)
SELECT e.chain, e.chain_seq, e.hash,
  greatest(0, (SELECT count(*) FILTER (WHERE h.type = 'legal_hold.placed') - count(*) FILTER (WHERE h.type = 'legal_hold.released') FROM defensibility_events h WHERE h.chain = e.chain))::int
FROM defensibility_events e
WHERE e.chain_seq = (SELECT max(m.chain_seq) FROM defensibility_events m WHERE m.chain = e.chain);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_truncate_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (TRUNCATE is refused)', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- Heads change only from inside the defensibility_events triggers (trigger depth 2) and are never deleted.
CREATE OR REPLACE FUNCTION defensibility_heads_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'defensibility_heads is append-only (a chain head is never deleted)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'defensibility_heads is append-only (maintained only by the defensibility_events triggers)' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER defensibility_heads_guard BEFORE INSERT OR UPDATE OR DELETE ON defensibility_heads
  FOR EACH ROW EXECUTE FUNCTION defensibility_heads_guard();
--> statement-breakpoint
CREATE TRIGGER defensibility_heads_no_truncate BEFORE TRUNCATE ON defensibility_heads
  FOR EACH STATEMENT EXECUTE FUNCTION reject_truncate_append_only();
--> statement-breakpoint
CREATE TRIGGER defensibility_events_no_truncate BEFORE TRUNCATE ON defensibility_events
  FOR EACH STATEMENT EXECUTE FUNCTION reject_truncate_append_only();
--> statement-breakpoint
-- Every insert must extend the anchored head of its chain (sequence and link), and advances it.
CREATE OR REPLACE FUNCTION defensibility_events_advance_head() RETURNS trigger AS $$
DECLARE
  h defensibility_heads%ROWTYPE;
  holds integer := CASE NEW.type WHEN 'legal_hold.placed' THEN 1 WHEN 'legal_hold.released' THEN -1 ELSE 0 END;
BEGIN
  SELECT * INTO h FROM defensibility_heads WHERE chain = NEW.chain FOR UPDATE;
  IF NOT FOUND THEN
    IF NEW.chain_seq <> 1 OR NEW.prev_hash <> repeat('0', 64) THEN
      RAISE EXCEPTION 'defensibility_events is append-only (a new chain starts at 1 from the genesis hash)' USING ERRCODE = 'restrict_violation';
    END IF;
    INSERT INTO defensibility_heads (chain, length, head_hash, open_holds) VALUES (NEW.chain, 1, NEW.hash, greatest(0, holds));
  ELSE
    IF NEW.chain_seq <> h.length + 1 OR NEW.prev_hash <> h.head_hash THEN
      RAISE EXCEPTION 'defensibility_events is append-only (an event must extend the anchored head of its chain)' USING ERRCODE = 'restrict_violation';
    END IF;
    UPDATE defensibility_heads
      SET length = NEW.chain_seq, head_hash = NEW.hash, open_holds = greatest(0, h.open_holds + holds), updated_at = now()
      WHERE chain = NEW.chain;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER defensibility_events_advance_head BEFORE INSERT ON defensibility_events
  FOR EACH ROW EXECUTE FUNCTION defensibility_events_advance_head();
--> statement-breakpoint
-- The only deletion path: a whole expired chain, by this function. SECURITY DEFINER so that, when a
-- separate purger role exists (below), the delete runs as that role and no other role can delete.
CREATE OR REPLACE FUNCTION defensibility_purge_chain(p_chain text, p_cutoff text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  last_at text;
  n integer;
BEGIN
  IF p_chain = 'global' THEN
    RAISE EXCEPTION 'the global defensibility chain is never purged' USING ERRCODE = 'restrict_violation';
  END IF;
  IF p_cutoff !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$' THEN
    RAISE EXCEPTION 'purge cutoff must be an ISO 8601 UTC timestamp' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT max(occurred_at) INTO last_at FROM defensibility_events WHERE chain = p_chain;
  IF last_at IS NULL THEN
    RETURN 0;
  END IF;
  IF last_at >= p_cutoff THEN
    RAISE EXCEPTION 'defensibility chain has not reached its retention period' USING ERRCODE = 'restrict_violation';
  END IF;
  DELETE FROM defensibility_events WHERE chain = p_chain;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION defensibility_purge_chain(text, text) FROM PUBLIC;
--> statement-breakpoint
-- Replaces the GUC gate of 0004. Row checks: never the global chain, never a chain under legal hold, and
-- (when a separate purger role owns defensibility_purge_chain) only that role. The first deleted row of a
-- chain turns its head into a tombstone (length 0; purged_length and purged_head_hash kept).
CREATE OR REPLACE FUNCTION reject_defensibility_delete() RETURNS trigger AS $$
DECLARE
  h defensibility_heads%ROWTYPE;
  purger oid;
  table_owner oid;
BEGIN
  IF OLD.chain = 'global' THEN
    RAISE EXCEPTION 'defensibility_events is append-only (the global chain is never deleted)' USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT proowner INTO purger FROM pg_proc WHERE oid = 'defensibility_purge_chain(text, text)'::regprocedure;
  SELECT relowner INTO table_owner FROM pg_class WHERE oid = TG_RELID;
  IF purger <> table_owner AND (SELECT oid FROM pg_roles WHERE rolname = current_user) <> purger THEN
    RAISE EXCEPTION 'defensibility_events is append-only (only defensibility_purge_chain may delete)' USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT * INTO h FROM defensibility_heads WHERE chain = OLD.chain FOR UPDATE;
  IF NOT FOUND OR h.open_holds > 0 THEN
    RAISE EXCEPTION 'defensibility_events is append-only (a chain under legal hold is never deleted)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF h.length > 0 THEN
    UPDATE defensibility_heads
      SET purged_length = h.length, purged_head_hash = h.head_hash, purged_at = now(), length = 0, head_hash = repeat('0', 64), updated_at = now()
      WHERE chain = OLD.chain;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- At commit: the whole chain is gone (a partial delete is a truncation) and the purge is recorded in the
-- global chain with the chain digest, event count and head hash of the tombstone.
CREATE OR REPLACE FUNCTION defensibility_events_check_purge() RETURNS trigger AS $$
DECLARE
  h defensibility_heads%ROWTYPE;
  remaining integer;
BEGIN
  SELECT * INTO h FROM defensibility_heads WHERE chain = OLD.chain;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'defensibility_events is append-only (a deleted chain has no head)' USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT count(*) INTO remaining FROM defensibility_events WHERE chain = OLD.chain;
  IF remaining <> h.length THEN
    RAISE EXCEPTION 'defensibility_events is append-only (only a whole chain may be deleted)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM defensibility_events g
    WHERE g.chain = 'global' AND g.type = 'retention.purged'
      AND g.payload->>'chainDigest' = encode(sha256(convert_to(OLD.chain, 'UTF8')), 'hex')
      AND (g.payload->>'eventCount')::int = h.purged_length
      AND g.payload->>'headHash' = h.purged_head_hash
  ) THEN
    RAISE EXCEPTION 'defensibility_events is append-only (a purge must be recorded as retention.purged in the global chain)' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER defensibility_events_purge_complete AFTER DELETE ON defensibility_events
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION defensibility_events_check_purge();
--> statement-breakpoint
-- Separate purger role where the migrating role may create roles (the docker-compose and CI databases,
-- whose migrating role is a superuser): the purge function then runs as a NOLOGIN role, and the delete
-- trigger refuses every other role, including the application's. Elsewhere the structural checks above
-- still hold; ADR-024 lists the least-privilege runtime role as an M19 launch item.
DO $$
DECLARE
  may_create boolean;
BEGIN
  SELECT rolsuper OR rolcreaterole INTO may_create FROM pg_roles WHERE rolname = current_user;
  IF NOT coalesce(may_create, false) THEN
    RAISE NOTICE 'defensibility purger role not created: the migrating role cannot create roles (ADR-024)';
    RETURN;
  END IF;
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fitadapt_defensibility_purger') THEN
      CREATE ROLE fitadapt_defensibility_purger NOLOGIN;
    END IF;
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO fitadapt_defensibility_purger', current_schema());
    GRANT SELECT, DELETE ON defensibility_events TO fitadapt_defensibility_purger;
    GRANT SELECT, UPDATE ON defensibility_heads TO fitadapt_defensibility_purger;
    ALTER FUNCTION defensibility_purge_chain(text, text) OWNER TO fitadapt_defensibility_purger;
    EXECUTE format('GRANT EXECUTE ON FUNCTION defensibility_purge_chain(text, text) TO %I', current_user);
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'defensibility purger role not configured: insufficient privilege (ADR-024)';
  END;
END;
$$;
