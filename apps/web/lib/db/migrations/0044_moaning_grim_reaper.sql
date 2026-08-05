-- Re-key vercel_project_links from (user_id, repo_owner, repo_name) to
-- (organization_id, repo_owner, repo_name).
--
-- DESTRUCTIVE, deliberately. Existing rows all carry organization_id = NULL —
-- nothing ever backfilled them — so `SET NOT NULL` below cannot succeed while
-- they exist, and static SQL cannot know the seeded organization's id to fill
-- them in. Rather than carry a migration routine and a conflict-resolution
-- surface to rescue rows from a deployment that has one account and test data,
-- the links are dropped and re-created by linking a repo again.
--
-- Everything else here is a shape change: the conflict table existed only to
-- hold disagreements between per-user rows, which can no longer exist.
DELETE FROM "vercel_project_links";--> statement-breakpoint
ALTER TABLE "vercel_project_link_conflicts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "vercel_project_link_conflicts" CASCADE;--> statement-breakpoint
ALTER TABLE "vercel_project_links" DROP CONSTRAINT "vercel_project_links_user_id_users_id_fk";
--> statement-breakpoint
DROP INDEX "vercel_project_links_org_repo_idx";--> statement-breakpoint
ALTER TABLE "vercel_project_links" DROP CONSTRAINT "vercel_project_links_user_id_repo_owner_repo_name_pk";--> statement-breakpoint
ALTER TABLE "vercel_project_links" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "vercel_project_links" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "vercel_project_links" ADD CONSTRAINT "vercel_project_links_organization_id_repo_owner_repo_name_pk" PRIMARY KEY("organization_id","repo_owner","repo_name");--> statement-breakpoint
ALTER TABLE "vercel_project_links" ADD CONSTRAINT "vercel_project_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;