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
ALTER TABLE "user_sandbox_configs" ADD CONSTRAINT "user_sandbox_configs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_sandbox_configs_user_provider_idx" ON "user_sandbox_configs" USING btree ("user_id","provider_type");--> statement-breakpoint
CREATE INDEX "user_sandbox_configs_user_id_idx" ON "user_sandbox_configs" USING btree ("user_id");