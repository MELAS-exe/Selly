ALTER TABLE "core"."subscription_invoices" ALTER COLUMN "subscription_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."subscription_invoices" ALTER COLUMN "wallet_connection_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."subscriptions" ADD COLUMN "next_plan_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "core"."subscriptions" ADD COLUMN "trial_ends_at" timestamp with time zone;