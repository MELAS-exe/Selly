-- The three subscription plans (docs/architecture.md section 3.7). Prices are in sats.
-- Prices live in the database: change them with a new migration or an admin command, never in code.
INSERT INTO "core"."plans" ("id", "name", "monthly_price_sat", "period_prices", "limits", "sort") VALUES
  ('starter', 'Starter', 5000,
   '{"1": 5000, "3": 14250, "12": 50000}',
   '{"products": 30, "agent_turns_per_month": 300, "drafts_per_month": 10, "voice_notes": false, "nostr_dm_alerts": false, "powered_by_badge": true, "embed_widget": false, "support": "help_pages"}',
   1),
  ('pro', 'Pro', 15000,
   '{"1": 15000, "3": 42750, "12": 150000}',
   '{"products": 200, "agent_turns_per_month": 1500, "drafts_per_month": 100, "voice_notes": true, "nostr_dm_alerts": true, "powered_by_badge": false, "embed_widget": false, "support": "two_working_days"}',
   2),
  ('business', 'Business', 40000,
   '{"1": 40000, "3": 114000, "12": 400000}',
   '{"products": 1000, "agent_turns_per_month": 6000, "drafts_per_month": 500, "voice_notes": true, "nostr_dm_alerts": true, "powered_by_badge": false, "embed_widget": true, "support": "one_working_day"}',
   3)
ON CONFLICT ("id") DO NOTHING;
