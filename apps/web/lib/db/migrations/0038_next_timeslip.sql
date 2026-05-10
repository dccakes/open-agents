CREATE TABLE "linear_workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"workspace_name" text NOT NULL,
	"access_token" text NOT NULL,
	"webhook_secret" text NOT NULL,
	"webhook_id" text NOT NULL,
	"installed_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "linear_workspaces_workspace_id_unique" UNIQUE("workspace_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "linear_workspaces_workspace_id_idx" ON "linear_workspaces" USING btree ("workspace_id");