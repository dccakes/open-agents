ALTER TABLE "usage_events" ADD COLUMN "session_id" text;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "workflow_run_id" text;--> statement-breakpoint
CREATE INDEX "usage_events_user_id_created_at_idx" ON "usage_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_events_workflow_run_id_idx" ON "usage_events" USING btree ("workflow_run_id");