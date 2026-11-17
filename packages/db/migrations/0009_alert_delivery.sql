ALTER TABLE "core"."vendor_notifications" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "vendor_notifications_undelivered" ON "core"."vendor_notifications" USING btree ("id") WHERE "core"."vendor_notifications"."delivered_at" is null;--> statement-breakpoint
-- Notifications written before this migration are not sent as alerts.
UPDATE "core"."vendor_notifications" SET "delivered_at" = now() WHERE "delivered_at" IS NULL;
