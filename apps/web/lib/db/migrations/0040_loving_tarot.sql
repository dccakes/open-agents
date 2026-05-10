ALTER TABLE "linear_workspaces" ALTER COLUMN "webhook_secret" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "linear_workspaces" ALTER COLUMN "webhook_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "linear_issue_id" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "linear_issue_url" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "linear_agent_session_id" text;