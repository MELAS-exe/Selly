CREATE TABLE "core"."wallet_pairings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vendor_id" uuid NOT NULL,
	"client_pubkey" text NOT NULL,
	"secret_ciphertext" "bytea",
	"key_version" smallint NOT NULL,
	"relays" text[] NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"wallet_connection_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "wallet_pairings_client_pubkey_unique" UNIQUE("client_pubkey")
);
--> statement-breakpoint
ALTER TABLE "core"."wallet_pairings" ADD CONSTRAINT "wallet_pairings_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "core"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."wallet_pairings" ADD CONSTRAINT "wallet_pairings_wallet_connection_id_wallet_connections_id_fk" FOREIGN KEY ("wallet_connection_id") REFERENCES "core"."wallet_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wallet_pairings_pending" ON "core"."wallet_pairings" USING btree ("expires_at") WHERE "core"."wallet_pairings"."status" = 'pending';