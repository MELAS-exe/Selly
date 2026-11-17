CREATE TABLE "agent"."vendor_settings" (
	"vendor_id" uuid PRIMARY KEY NOT NULL,
	"bot_paused" boolean DEFAULT false NOT NULL,
	"bot_paused_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
