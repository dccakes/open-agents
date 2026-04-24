ALTER TABLE "sessions" ADD COLUMN "provision_db" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "db_teardown_metadata" jsonb;