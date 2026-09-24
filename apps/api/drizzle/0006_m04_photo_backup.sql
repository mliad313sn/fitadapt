CREATE TABLE "photo_backup_keys" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photo_backups" (
	"user_id" uuid NOT NULL,
	"photo_id" uuid NOT NULL,
	"envelope" "bytea" NOT NULL,
	"byte_length" integer NOT NULL,
	"stored_at" timestamp with time zone NOT NULL,
	CONSTRAINT "photo_backups_user_id_photo_id_pk" PRIMARY KEY("user_id","photo_id")
);
--> statement-breakpoint
ALTER TABLE "photo_backup_keys" ADD CONSTRAINT "photo_backup_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_backups" ADD CONSTRAINT "photo_backups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;