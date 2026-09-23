CREATE TABLE "defensibility_events" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"id" uuid NOT NULL,
	"chain" text NOT NULL,
	"chain_seq" integer NOT NULL,
	"type" text NOT NULL,
	"occurred_at" text NOT NULL,
	"payload" jsonb NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "defensibility_events_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "legal_acceptances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seq" bigserial NOT NULL,
	"user_id" uuid NOT NULL,
	"document_id" text NOT NULL,
	"version" integer NOT NULL,
	"locale" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"source" text NOT NULL,
	"content_hash" text NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notice_impressions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seq" bigserial NOT NULL,
	"user_id" uuid NOT NULL,
	"notice_id" text NOT NULL,
	"version" integer NOT NULL,
	"kind" text NOT NULL,
	"locale" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"content_hash" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice_impressions" ADD CONSTRAINT "notice_impressions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "defensibility_events_chain_idx" ON "defensibility_events" USING btree ("chain","chain_seq");--> statement-breakpoint
CREATE INDEX "defensibility_events_type_idx" ON "defensibility_events" USING btree ("type");--> statement-breakpoint
CREATE INDEX "legal_acceptances_user_idx" ON "legal_acceptances" USING btree ("user_id","document_id","accepted_at");--> statement-breakpoint
CREATE INDEX "notice_impressions_user_idx" ON "notice_impressions" USING btree ("user_id","notice_id");