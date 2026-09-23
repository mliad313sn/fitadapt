ALTER TABLE "consent_records" ADD COLUMN "received_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "legal_acceptances" ADD COLUMN "received_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "notice_impressions" ADD COLUMN "received_at" timestamp with time zone DEFAULT now() NOT NULL;