ALTER TABLE "core"."products" ADD COLUMN "slug" text NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."products" ADD CONSTRAINT "products_vendor_slug" UNIQUE("vendor_id","slug");