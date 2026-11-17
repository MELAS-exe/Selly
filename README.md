# Selly

An AI sales agent and mobile-first micro-storefronts for social commerce in West Africa, starting in Senegal. A customer opens the vendor's web shop, asks the chat about stock and prices, and gets an order with a Lightning invoice. The customer pays in bitcoin into the vendor's own wallet, linked with Nostr Wallet Connect. The platform never holds that money. Vendors sign in with a Nostr key and pay Selly a subscription in sats (Starter, Pro, Business).

All clients are React web apps. WhatsApp, Instagram and a Banxaas on-ramp (mobile money to bitcoin) are perspectives, not part of the MVP.

Status: design v0.3.

- [`docs/architecture.md`](docs/architecture.md): architecture, decisions, data model, flows, plans and pricing.
- [`docs/api.json`](docs/api.json): OpenAPI 3.1 contract with every request and response in full.
