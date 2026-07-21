CREATE TABLE "linear_workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"workspace_name" text NOT NULL,
	"access_token" text NOT NULL,
	"webhook_secret" text,
	"webhook_id" text,
	"installed_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_sandbox_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider_type" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "provision_db" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "db_teardown_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "linear_issue_id" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "linear_issue_url" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "linear_agent_session_id" text;--> statement-breakpoint
ALTER TABLE "user_sandbox_configs" ADD CONSTRAINT "user_sandbox_configs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "linear_workspaces_workspace_id_idx" ON "linear_workspaces" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_sandbox_configs_user_provider_idx" ON "user_sandbox_configs" USING btree ("user_id","provider_type");--> statement-breakpoint
CREATE INDEX "user_sandbox_configs_user_id_idx" ON "user_sandbox_configs" USING btree ("user_id");