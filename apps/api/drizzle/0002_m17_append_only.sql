-- M17: consent records and audit entries are append-only (ADR-004, L11).
-- UPDATE is rejected; DELETE stays possible for account deletion (cascade)
-- and for retention purges on the schedule in docs/compliance/retention-schedule.md.
CREATE OR REPLACE FUNCTION reject_update_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER consent_records_append_only BEFORE UPDATE ON consent_records
  FOR EACH ROW EXECUTE FUNCTION reject_update_append_only();
--> statement-breakpoint
CREATE TRIGGER audit_entries_append_only BEFORE UPDATE ON audit_entries
  FOR EACH ROW EXECUTE FUNCTION reject_update_append_only();
