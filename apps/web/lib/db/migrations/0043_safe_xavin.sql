CREATE TABLE "linear_actor_links" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"linear_user_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_github_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"account_id" integer NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text DEFAULT 'Organization' NOT NULL,
	"added_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vercel_project_link_conflicts" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"repo_owner" text NOT NULL,
	"repo_name" text NOT NULL,
	"detected_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"resolved_by_user_id" text
);
--> statement-breakpoint
ALTER TABLE "github_installations" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "github_installations" ADD COLUMN "account_id" integer;--> statement-breakpoint
ALTER TABLE "linear_workspaces" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "vercel_team_id" text;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "vercel_team_slug" text;--> statement-breakpoint
ALTER TABLE "vercel_project_links" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "linear_actor_links" ADD CONSTRAINT "linear_actor_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linear_actor_links" ADD CONSTRAINT "linear_actor_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linear_actor_links" ADD CONSTRAINT "linear_actor_links_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_github_accounts" ADD CONSTRAINT "org_github_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_github_accounts" ADD CONSTRAINT "org_github_accounts_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vercel_project_link_conflicts" ADD CONSTRAINT "vercel_project_link_conflicts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vercel_project_link_conflicts" ADD CONSTRAINT "vercel_project_link_conflicts_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "linear_actor_links_org_linear_user_idx" ON "linear_actor_links" USING btree ("organization_id","linear_user_id");--> statement-breakpoint
CREATE INDEX "linear_actor_links_user_id_idx" ON "linear_actor_links" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_github_accounts_org_account_idx" ON "org_github_accounts" USING btree ("organization_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vercel_project_link_conflicts_org_repo_idx" ON "vercel_project_link_conflicts" USING btree ("organization_id","repo_owner","repo_name");--> statement-breakpoint
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linear_workspaces" ADD CONSTRAINT "linear_workspaces_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vercel_project_links" ADD CONSTRAINT "vercel_project_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "github_installations_org_installation_idx" ON "github_installations" USING btree ("organization_id","installation_id") WHERE "github_installations"."organization_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "linear_workspaces_organization_id_idx" ON "linear_workspaces" USING btree ("organization_id") WHERE "linear_workspaces"."organization_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "vercel_project_links_org_repo_idx" ON "vercel_project_links" USING btree ("organization_id","repo_owner","repo_name") WHERE "vercel_project_links"."organization_id" IS NOT NULL;