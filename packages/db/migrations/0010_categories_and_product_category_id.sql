CREATE TABLE "core"."categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vendor_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"position" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_vendor_slug" UNIQUE("vendor_id","slug"),
	CONSTRAINT "categories_name_len" CHECK (length("core"."categories"."name") between 1 and 40)
);
--> statement-breakpoint
ALTER TABLE "core"."products" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "core"."categories" ADD CONSTRAINT "categories_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "core"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "categories_by_vendor" ON "core"."categories" USING btree ("vendor_id","position");--> statement-breakpoint
ALTER TABLE "core"."products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "core"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "products_by_category" ON "core"."products" USING btree ("category_id");