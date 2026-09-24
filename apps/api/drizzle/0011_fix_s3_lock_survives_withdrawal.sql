CREATE TABLE "safety_locks" (
	"user_id" uuid NOT NULL,
	"seq" bigserial NOT NULL,
	"record_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"at" text NOT NULL,
	"flag_id" uuid,
	"attests" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "safety_locks_user_id_seq_pk" PRIMARY KEY("user_id","seq")
);
--> statement-breakpoint
ALTER TABLE "safety_locks" ADD CONSTRAINT "safety_locks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "safety_locks_record_idx" ON "safety_locks" USING btree ("user_id","record_id");--> statement-breakpoint
-- MOB-08: carry the S3 facts of the execution logs stored before this table
-- existed, in their stored order, so a lock set before the fix also survives a
-- later health-consent withdrawal. Only kind, time and causal ids are copied.
-- Rows of a lock that is already lifted are pruned at the next attestation or
-- at the next health-consent withdrawal (the same rule as new rows).
INSERT INTO "safety_locks" ("user_id", "record_id", "kind", "at", "flag_id", "attests")
SELECT "user_id", "record_id", "data" ->> 'kind', "data" ->> 'at',
  CASE WHEN "data" ->> 'kind' = 'red_flag' AND "data" ? 'eventId' THEN ("data" ->> 'eventId')::uuid END,
  CASE WHEN "data" ->> 'kind' = 'medical_review_attested' AND "data" ? 'attests' THEN "data" -> 'attests' END
FROM "sync_changes"
WHERE "collection" = 'execution_logs' AND "op" = 'upsert' AND "data" ->> 'kind' IN ('red_flag', 'medical_review_attested')
ORDER BY "user_id", "revision"
ON CONFLICT DO NOTHING;