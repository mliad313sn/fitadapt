CREATE TABLE "audit_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_ref" text NOT NULL,
	"action" text NOT NULL,
	"data_type" text,
	"version" integer,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seq" bigserial NOT NULL,
	"user_id" uuid NOT NULL,
	"data_type" text NOT NULL,
	"decision" text NOT NULL,
	"version" integer NOT NULL,
	"locale" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"source" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_ref" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"primary_completed_at" timestamp with time zone NOT NULL,
	"backup_purge_due_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_entries_subject_idx" ON "audit_entries" USING btree ("subject_ref","occurred_at");--> statement-breakpoint
CREATE INDEX "consent_records_user_idx" ON "consent_records" USING btree ("user_id","data_type","recorded_at");--> statement-breakpoint
CREATE INDEX "data_requests_subject_idx" ON "data_requests" USING btree ("subject_ref");--> statement-breakpoint
CREATE INDEX "data_requests_due_idx" ON "data_requests" USING btree ("status","backup_purge_due_at");