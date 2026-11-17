CREATE SCHEMA "core";
--> statement-breakpoint
CREATE TYPE "core"."channel" AS ENUM('whatsapp', 'instagram', 'web');--> statement-breakpoint
CREATE TYPE "core"."currency" AS ENUM('XOF', 'SAT');--> statement-breakpoint
CREATE TYPE "core"."invoice_status" AS ENUM('pending', 'settled', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "core"."order_status" AS ENUM('pending_payment', 'paid', 'fulfilled', 'cancelled', 'expired');--> statement-breakpoint
CREATE TABLE "core"."audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."customer_identities" (
	"vendor_id" uuid NOT NULL,
	"channel" "core"."channel" NOT NULL,
	"external_id" text NOT NULL,
	"customer_id" uuid NOT NULL,
	CONSTRAINT "customer_identities_vendor_id_channel_external_id_pk" PRIMARY KEY("vendor_id","channel","external_id")
);
--> statement-breakpoint
CREATE TABLE "core"."customers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vendor_id" uuid NOT NULL,
	"display_name" text,
	"phone_e164" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."idempotency_keys" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" "bytea" NOT NULL,
	"status_code" smallint,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_scope_key_pk" PRIMARY KEY("scope","key")
);
--> statement-breakpoint
CREATE TABLE "core"."inventory_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"variant_id" uuid NOT NULL,
	"delta_on_hand" integer DEFAULT 0 NOT NULL,
	"delta_reserved" integer DEFAULT 0 NOT NULL,
	"reason" text NOT NULL,
	"order_id" uuid,
	"draft_id" uuid,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"wallet_connection_id" uuid,
	"source" text NOT NULL,
	"bolt11" text NOT NULL,
	"payment_hash" text NOT NULL,
	"amount_msat" bigint NOT NULL,
	"description" text NOT NULL,
	"verify_url" text,
	"status" "core"."invoice_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	"preimage" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_vendor_hash" UNIQUE("vendor_id","payment_hash"),
	CONSTRAINT "invoices_hash_hex" CHECK ("core"."invoices"."payment_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "invoices_amount_positive" CHECK ("core"."invoices"."amount_msat" > 0)
);
--> statement-breakpoint
CREATE TABLE "core"."nostr_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"challenge" text NOT NULL,
	"purpose" text NOT NULL,
	"session_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nostr_challenges_challenge_unique" UNIQUE("challenge")
);
--> statement-breakpoint
CREATE TABLE "core"."order_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_amount" bigint NOT NULL,
	"price_currency" "core"."currency" NOT NULL,
	"title_snapshot" text NOT NULL,
	"options_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "order_items_quantity_range" CHECK ("core"."order_items"."quantity" between 1 and 50)
);
--> statement-breakpoint
CREATE TABLE "core"."orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vendor_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"number" text NOT NULL,
	"public_token" text NOT NULL,
	"channel" "core"."channel" NOT NULL,
	"conversation_ref" text,
	"status" "core"."order_status" DEFAULT 'pending_payment' NOT NULL,
	"attention" text,
	"pricing_currency" "core"."currency" NOT NULL,
	"subtotal_xof" bigint NOT NULL,
	"delivery_fee_xof" bigint DEFAULT 0 NOT NULL,
	"discount_xof" bigint DEFAULT 0 NOT NULL,
	"total_xof" bigint NOT NULL,
	"total_msat" bigint NOT NULL,
	"rate_quote_id" uuid,
	"delivery" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"fulfilled_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_public_token_unique" UNIQUE("public_token"),
	CONSTRAINT "orders_vendor_number" UNIQUE("vendor_id","number"),
	CONSTRAINT "orders_total_positive" CHECK ("core"."orders"."total_xof" > 0),
	CONSTRAINT "orders_msat_whole_sats" CHECK ("core"."orders"."total_msat" > 0 and "core"."orders"."total_msat" % 1000 = 0)
);
--> statement-breakpoint
CREATE TABLE "core"."outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"topic" text NOT NULL,
	"key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "core"."plans" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"monthly_price_sat" bigint NOT NULL,
	"period_prices" jsonb NOT NULL,
	"limits" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" smallint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."product_drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vendor_id" uuid NOT NULL,
	"source" text NOT NULL,
	"image_keys" text[] DEFAULT '{}' NOT NULL,
	"input_text" text,
	"extracted" jsonb,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_product_id" uuid,
	"status" text DEFAULT 'processing' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "core"."product_images" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"dominant" text,
	"position" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."product_variants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" text,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"price_override" bigint,
	"on_hand" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "variants_unique_options" UNIQUE("product_id","options"),
	CONSTRAINT "variants_price_override_positive" CHECK ("core"."product_variants"."price_override" is null or "core"."product_variants"."price_override" > 0),
	CONSTRAINT "variants_on_hand_nonneg" CHECK ("core"."product_variants"."on_hand" >= 0),
	CONSTRAINT "variants_reserved_nonneg" CHECK ("core"."product_variants"."reserved" >= 0),
	CONSTRAINT "variants_reserved_le_on_hand" CHECK ("core"."product_variants"."reserved" <= "core"."product_variants"."on_hand")
);
--> statement-breakpoint
CREATE TABLE "core"."products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vendor_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text,
	"price_amount" bigint NOT NULL,
	"price_currency" "core"."currency" DEFAULT 'XOF' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', public.unaccent_i(title || ' ' || description))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_title_len" CHECK (length("core"."products"."title") between 2 and 120),
	CONSTRAINT "products_price_positive" CHECK ("core"."products"."price_amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "core"."rate_quotes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"xof_per_btc_cents" bigint NOT NULL,
	"source" text NOT NULL,
	"inputs" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	CONSTRAINT "rate_quotes_positive" CHECK ("core"."rate_quotes"."xof_per_btc_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "core"."subscription_invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vendor_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"plan_id" text NOT NULL,
	"months" smallint NOT NULL,
	"list_price_sat" bigint NOT NULL,
	"credit_sat" bigint DEFAULT 0 NOT NULL,
	"amount_sat" bigint NOT NULL,
	"wallet_connection_id" uuid NOT NULL,
	"source" text NOT NULL,
	"bolt11" text NOT NULL,
	"payment_hash" text NOT NULL,
	"amount_msat" bigint NOT NULL,
	"description" text NOT NULL,
	"verify_url" text,
	"status" "core"."invoice_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	"preimage" text,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sub_invoices_wallet_hash" UNIQUE("wallet_connection_id","payment_hash"),
	CONSTRAINT "sub_invoices_months" CHECK ("core"."subscription_invoices"."months" in (1, 3, 12)),
	CONSTRAINT "sub_invoices_hash_hex" CHECK ("core"."subscription_invoices"."payment_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "sub_invoices_amount" CHECK ("core"."subscription_invoices"."amount_sat" > 0 and "core"."subscription_invoices"."amount_msat" = "core"."subscription_invoices"."amount_sat" * 1000)
);
--> statement-breakpoint
CREATE TABLE "core"."subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vendor_id" uuid NOT NULL,
	"plan_id" text NOT NULL,
	"next_plan_id" text,
	"status" text NOT NULL,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"grace_ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_vendor_id_unique" UNIQUE("vendor_id")
);
--> statement-breakpoint
CREATE TABLE "core"."trial_claims" (
	"claim_key" text PRIMARY KEY NOT NULL,
	"vendor_id" uuid NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."usage_counters" (
	"vendor_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"month" date NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_counters_vendor_id_metric_month_pk" PRIMARY KEY("vendor_id","metric","month"),
	CONSTRAINT "usage_nonneg" CHECK ("core"."usage_counters"."used" >= 0)
);
--> statement-breakpoint
CREATE TABLE "core"."vendor_keys" (
	"pubkey" text PRIMARY KEY NOT NULL,
	"vendor_id" uuid NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "vendor_keys_pubkey_hex" CHECK ("core"."vendor_keys"."pubkey" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "core"."vendor_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pubkey" text NOT NULL,
	"vendor_id" uuid,
	"token_hash" "bytea" NOT NULL,
	"device_label" text,
	"step_up_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "core"."vendors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"slug" "citext" NOT NULL,
	"contact_whatsapp_e164" text,
	"locale" text DEFAULT 'fr-SN' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendors_slug_unique" UNIQUE("slug"),
	CONSTRAINT "vendors_display_name_len" CHECK (length("core"."vendors"."display_name") between 2 and 60),
	CONSTRAINT "vendors_slug_format" CHECK ("core"."vendors"."slug"::text ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
	CONSTRAINT "vendors_whatsapp_format" CHECK ("core"."vendors"."contact_whatsapp_e164" is null or "core"."vendors"."contact_whatsapp_e164" ~ '^\+[1-9][0-9]{7,14}$')
);
--> statement-breakpoint
CREATE TABLE "core"."wallet_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner" text DEFAULT 'vendor' NOT NULL,
	"vendor_id" uuid,
	"kind" text NOT NULL,
	"uri_ciphertext" "bytea",
	"key_version" smallint,
	"wallet_pubkey" text,
	"client_pubkey" text,
	"relays" text[] DEFAULT '{}' NOT NULL,
	"methods" text[] DEFAULT '{}' NOT NULL,
	"notifications" boolean DEFAULT false NOT NULL,
	"encryption" text,
	"lud16" text,
	"status" text DEFAULT 'active' NOT NULL,
	"last_ok_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "wallet_owner_vendor" CHECK (("core"."wallet_connections"."owner" = 'vendor') = ("core"."wallet_connections"."vendor_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "core"."customer_identities" ADD CONSTRAINT "customer_identities_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "core"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."customer_identities" ADD CONSTRAINT "customer_identities_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "core"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."customers" ADD CONSTRAINT "customers_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "core"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."inventory_movements" ADD CONSTRAINT "inventory_movements_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "core"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."invoices" ADD CONSTRAINT "invoices_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "core"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."invoices" ADD CONSTRAINT "invoices_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "core"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."invoices" ADD CONSTRAINT "invoices_wallet_connection_id_wallet_connections_id_fk" FOREIGN KEY ("wallet_connection_id") REFERENCES "core"."wallet_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "core"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."order_items" ADD CONSTRAINT "order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "core"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."orders" ADD CONSTRAINT "orders_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "core"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "core"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."orders" ADD CONSTRAINT "orders_rate_quote_id_rate_quotes_id_fk" FOREIGN KEY ("rate_quote_id") REFERENCES "core"."rate_quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."product_drafts" ADD CONSTRAINT "product_drafts_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "core"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."product_drafts" ADD CONSTRAINT "product_drafts_target_product_id_products_id_fk" FOREIGN KEY ("target_product_id") REFERENCES "core"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "core"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "core"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."products" ADD CONSTRAINT "products_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "core"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."subscription_invoices" ADD CONSTRAINT "subscription_invoices_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "core"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."subscription_invoices" ADD CONSTRAINT "subscription_invoices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "core"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."subscription_invoices" ADD CONSTRAINT "subscription_invoices_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "core"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."subscription_invoices" ADD CONSTRAINT "subscription_invoices_wallet_connection_id_wallet_connections_id_fk" FOREIGN KEY ("wallet_connection_id") REFERENCES "core"."wallet_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."subscriptions" ADD CONSTRAINT "subscriptions_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "core"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "core"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."subscriptions" ADD CONSTRAINT "subscriptions_next_plan_id_plans_id_fk" FOREIGN KEY ("next_plan_id") REFERENCES "core"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."trial_claims" ADD CONSTRAINT "trial_claims_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "core"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."usage_counters" ADD CONSTRAINT "usage_counters_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "core"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."vendor_keys" ADD CONSTRAINT "vendor_keys_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "core"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."vendor_sessions" ADD CONSTRAINT "vendor_sessions_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "core"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."wallet_connections" ADD CONSTRAINT "wallet_connections_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "core"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_movements_by_variant" ON "core"."inventory_movements" USING btree ("variant_id","created_at");--> statement-breakpoint
CREATE INDEX "invoices_by_order" ON "core"."invoices" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "invoices_pending_expiry" ON "core"."invoices" USING btree ("expires_at") WHERE "core"."invoices"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "orders_vendor_status" ON "core"."orders" USING btree ("vendor_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "products_by_vendor" ON "core"."products" USING btree ("vendor_id","status");--> statement-breakpoint
CREATE INDEX "products_search" ON "core"."products" USING gin ("search");--> statement-breakpoint
CREATE INDEX "products_title_trgm" ON "core"."products" USING gin (public.unaccent_i("title") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "subscription_invoices_by_vendor" ON "core"."subscription_invoices" USING btree ("vendor_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "subscription_invoices_pending_expiry" ON "core"."subscription_invoices" USING btree ("expires_at") WHERE "core"."subscription_invoices"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "subscriptions_expiring" ON "core"."subscriptions" USING btree ("current_period_end") WHERE "core"."subscriptions"."status" in ('trialing', 'active', 'grace');--> statement-breakpoint
CREATE INDEX "vendor_keys_by_vendor" ON "core"."vendor_keys" USING btree ("vendor_id") WHERE "core"."vendor_keys"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_connections_one_live" ON "core"."wallet_connections" USING btree ("vendor_id") WHERE "core"."wallet_connections"."status" <> 'revoked' and "core"."wallet_connections"."owner" = 'vendor';--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_connections_one_platform" ON "core"."wallet_connections" USING btree ((true)) WHERE "core"."wallet_connections"."status" <> 'revoked' and "core"."wallet_connections"."owner" = 'platform';