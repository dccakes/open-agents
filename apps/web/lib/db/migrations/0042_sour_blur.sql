ALTER TABLE "workflow_runs" ALTER COLUMN "finished_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_runs" ALTER COLUMN "total_duration_ms" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "input_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "output_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "step_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "halt_reason" text;