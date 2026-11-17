CREATE SCHEMA "agent";
--> statement-breakpoint
CREATE TABLE "agent"."chat_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vendor_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"ip_hash" "bytea",
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "agent"."conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vendor_id" uuid NOT NULL,
	"channel" text DEFAULT 'web' NOT NULL,
	"role" text NOT NULL,
	"external_user_id" text NOT NULL,
	"customer_id" uuid,
	"customer_label" text,
	"mode" text DEFAULT 'bot' NOT NULL,
	"human_until" timestamp with time zone,
	"vendor_read_at" timestamp with time zone,
	"last_inbound_at" timestamp with time zone,
	"language" text,
	"summary" text DEFAULT '' NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_vendor_channel_user" UNIQUE("vendor_id","channel","external_user_id"),
	CONSTRAINT "conversations_channel" CHECK ("agent"."conversations"."channel" in ('web', 'whatsapp', 'instagram')),
	CONSTRAINT "conversations_role" CHECK ("agent"."conversations"."role" in ('customer', 'vendor')),
	CONSTRAINT "conversations_mode" CHECK ("agent"."conversations"."mode" in ('bot', 'human', 'paused'))
);
--> statement-breakpoint
CREATE TABLE "agent"."llm_calls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid,
	"vendor_id" uuid,
	"purpose" text NOT NULL,
	"model" text NOT NULL,
	"latency_ms" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"tool_calls" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent"."messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"author" text NOT NULL,
	"author_label" text,
	"kind" text NOT NULL,
	"text" text,
	"cards" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"quick_replies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"media_key" text,
	"image_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"quick_reply_id" text,
	"client_message_id" text,
	"status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_conversation_client_id" UNIQUE("conversation_id","client_message_id"),
	CONSTRAINT "messages_direction" CHECK ("agent"."messages"."direction" in ('in', 'out')),
	CONSTRAINT "messages_author" CHECK ("agent"."messages"."author" in ('customer', 'vendor', 'agent', 'system')),
	CONSTRAINT "messages_kind" CHECK ("agent"."messages"."kind" in ('text', 'audio', 'image', 'order_link', 'system')),
	CONSTRAINT "messages_status" CHECK ("agent"."messages"."status" in ('accepted', 'processed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "agent"."processed_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent"."chat_sessions" ADD CONSTRAINT "chat_sessions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "agent"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "agent"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_by_conversation" ON "agent"."messages" USING btree ("conversation_id","id");