-- M20: acceptances and notice impressions are append-only (L2, L3); the
-- defensibility log (L11, ADR-009) rejects UPDATE and DELETE. The only
-- deletion path is the retention purge, which sets the transaction-local
-- flag app.defensibility_purge and removes whole expired chains; it records
-- a retention.purged event in the global chain.
CREATE TRIGGER legal_acceptances_append_only BEFORE UPDATE ON legal_acceptances
  FOR EACH ROW EXECUTE FUNCTION reject_update_append_only();
--> statement-breakpoint
CREATE TRIGGER notice_impressions_append_only BEFORE UPDATE ON notice_impressions
  FOR EACH ROW EXECUTE FUNCTION reject_update_append_only();
--> statement-breakpoint
CREATE TRIGGER defensibility_events_no_update BEFORE UPDATE ON defensibility_events
  FOR EACH ROW EXECUTE FUNCTION reject_update_append_only();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_defensibility_delete() RETURNS trigger AS $$
BEGIN
  IF coalesce(current_setting('app.defensibility_purge', true), '') <> 'on' THEN
    RAISE EXCEPTION 'defensibility_events is append-only (only the retention purge may delete)' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER defensibility_events_no_delete BEFORE DELETE ON defensibility_events
  FOR EACH ROW EXECUTE FUNCTION reject_defensibility_delete();
