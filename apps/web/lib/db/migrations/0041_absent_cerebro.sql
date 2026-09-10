CREATE TABLE "approval" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"chat_id" text,
	"workflow_run_id" text,
	"kind" text NOT NULL,
	"tool_name" text,
	"tool_call_id" text,
	"input_summary" jsonb NOT NULL,
	"decision" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"consumed_at" timestamp,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"decided_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "policy_event" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"workflow_run_id" text,
	"tool_name" text,
	"input_summary" jsonb NOT NULL,
	"decision" text NOT NULL,
	"matched_rule" text,
	"posture" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "posture" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_event" ADD CONSTRAINT "policy_event_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_session_decision_idx" ON "approval" USING btree ("session_id","decision");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_tool_call_id_idx" ON "approval" USING btree ("tool_call_id");--> statement-breakpoint
CREATE INDEX "approval_decision_expires_at_idx" ON "approval" USING btree ("decision","expires_at");--> statement-breakpoint
CREATE INDEX "policy_event_session_created_at_idx" ON "policy_event" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "policy_event_workflow_run_id_idx" ON "policy_event" USING btree ("workflow_run_id");