// Constants of architecture.md section 5.3.2.
export const LOGIN_EVENT_KIND = 27235; // NIP-98 HTTP auth
export const MAX_CLOCK_SKEW_SECONDS = 60;
export const CHALLENGE_TTL_SECONDS = 300;
export const STEP_UP_TTL_SECONDS = 600;
export const MAX_KEYS_PER_VENDOR = 3;

// TODO (Dev 3): verifyLoginEvent(event, { url, method, challenge }) using nostr-tools (signature, kind, created_at,
// u and method tags, challenge tag), and property test P7 (a challenge is accepted at most once).
// TODO (Dev 1, with Dev 3): browser signer adapters for NIP-07, NIP-46, NIP-55 and a local key (NIP-49), in src/browser.
