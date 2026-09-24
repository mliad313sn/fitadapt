CREATE TABLE "pair_events" (
	"pair_session_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"from_user_id" uuid NOT NULL,
	"from_slot" text NOT NULL,
	"client_event_id" uuid NOT NULL,
	"event" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pair_events_pair_session_id_seq_pk" PRIMARY KEY("pair_session_id","seq")
);
--> statement-breakpoint
CREATE TABLE "pair_participants" (
	"pair_session_id" uuid NOT NULL,
	"slot" text NOT NULL,
	"user_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"consent_version" integer NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pair_participants_pair_session_id_slot_pk" PRIMARY KEY("pair_session_id","slot")
);
--> statement-breakpoint
CREATE TABLE "pair_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"host_user_id" uuid NOT NULL,
	"join_code_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pair_sessions_join_code_hash_unique" UNIQUE("join_code_hash")
);
--> statement-breakpoint
ALTER TABLE "pair_events" ADD CONSTRAINT "pair_events_pair_session_id_pair_sessions_id_fk" FOREIGN KEY ("pair_session_id") REFERENCES "public"."pair_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pair_events" ADD CONSTRAINT "pair_events_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pair_participants" ADD CONSTRAINT "pair_participants_pair_session_id_pair_sessions_id_fk" FOREIGN KEY ("pair_session_id") REFERENCES "public"."pair_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pair_participants" ADD CONSTRAINT "pair_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pair_sessions" ADD CONSTRAINT "pair_sessions_host_user_id_users_id_fk" FOREIGN KEY ("host_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pair_events_client_idx" ON "pair_events" USING btree ("pair_session_id","from_user_id","client_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pair_participants_user_idx" ON "pair_participants" USING btree ("pair_session_id","user_id");--> statement-breakpoint
-- M09: the pair relay is append-only (ADR-021): events and participations are never edited;
-- rows leave only with the account (cascade) or on a partner_sharing withdrawal.
CREATE TRIGGER pair_events_append_only BEFORE UPDATE ON pair_events
  FOR EACH ROW EXECUTE FUNCTION reject_update_append_only();--> statement-breakpoint
CREATE TRIGGER pair_participants_append_only BEFORE UPDATE ON pair_participants
  FOR EACH ROW EXECUTE FUNCTION reject_update_append_only();
