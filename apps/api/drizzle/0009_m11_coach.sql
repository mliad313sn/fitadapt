CREATE TABLE "coach_conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_message_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coach_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"role" text NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coach_tool_calls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"tool" text NOT NULL,
	"input" jsonb,
	"status" text NOT NULL,
	"reason_code" text NOT NULL,
	"reason_codes" jsonb NOT NULL,
	"engine_version" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "coach_conversations" ADD CONSTRAINT "coach_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_messages" ADD CONSTRAINT "coach_messages_conversation_id_coach_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."coach_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_messages" ADD CONSTRAINT "coach_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_tool_calls" ADD CONSTRAINT "coach_tool_calls_conversation_id_coach_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."coach_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_tool_calls" ADD CONSTRAINT "coach_tool_calls_message_id_coach_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."coach_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_tool_calls" ADD CONSTRAINT "coach_tool_calls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coach_conversations_user_idx" ON "coach_conversations" USING btree ("user_id","last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "coach_messages_seq_idx" ON "coach_messages" USING btree ("conversation_id","seq");--> statement-breakpoint
CREATE INDEX "coach_tool_calls_conversation_idx" ON "coach_tool_calls" USING btree ("conversation_id","created_at");--> statement-breakpoint
-- M11: messages and tool-call audits are append-only (ADR-024); rows leave only with the conversation
-- (the user deletes it, the ai_coach consent is withdrawn, the retention purge, or the account is deleted).
CREATE TRIGGER coach_messages_append_only BEFORE UPDATE ON coach_messages
  FOR EACH ROW EXECUTE FUNCTION reject_update_append_only();--> statement-breakpoint
CREATE TRIGGER coach_tool_calls_append_only BEFORE UPDATE ON coach_tool_calls
  FOR EACH ROW EXECUTE FUNCTION reject_update_append_only();
