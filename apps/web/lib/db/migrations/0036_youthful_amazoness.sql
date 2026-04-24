CREATE TABLE "pr_remediation_states" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"pr_number" integer NOT NULL,
	"head_sha" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp,
	"last_fingerprint_hash" text,
	"status" text DEFAULT 'watching' NOT NULL,
	"watcher_run_id" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"delivery_id" text PRIMARY KEY NOT NULL,
	"processed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "watcher_lease_run_id" text;--> statement-breakpoint
ALTER TABLE "pr_remediation_states" ADD CONSTRAINT "pr_remediation_states_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pr_remediation_states_session_pr_head_sha_idx" ON "pr_remediation_states" USING btree ("session_id","pr_number","head_sha");