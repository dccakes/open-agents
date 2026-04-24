CREATE TABLE "pr_remediation_leases" (
	"session_id" text PRIMARY KEY NOT NULL,
	"pr_number" integer NOT NULL,
	"watcher_run_id" text NOT NULL,
	"claimed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pr_remediation_leases" ADD CONSTRAINT "pr_remediation_leases_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "watcher_lease_run_id";