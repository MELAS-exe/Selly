// Smoke test of the dashboard against a running core: node scripts/dashboard-smoke.mjs http://localhost:4000
// Signs in and creates a shop (which has no plan yet, so adding a product is refused with PLAN_LIMIT_REACHED),
// opens the live stream, sends an agent notification and checks that the stream delivers it, then reads the
// order list and the sales numbers.
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';

const base = process.argv[2] ?? 'http://localhost:4000';
const origin = process.env.APP_BASE_URL ?? 'http://localhost:3000';
const token = process.env.SERVICE_TOKEN_AGENT ?? 'dev-agent-token';
const sk = generateSecretKey();
let cookie = '';

async function call(method, path, body, extra = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', origin, ...(cookie ? { cookie } : {}), ...extra },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const set = res.headers.get('set-cookie');
  if (set?.startsWith('selly_session=')) cookie = set.split(';')[0];
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const c = await call('POST', '/api/v1/auth/nostr/challenges', { purpose: 'sign_in' });
await call('POST', '/api/v1/auth/nostr/sessions', { challenge_id: c.body.challenge_id, event: finalizeEvent(c.body.event_template, sk) });
const v = await call('POST', '/api/v1/vendors', { display_name: 'Smoke Dash', slug: `dash-${getPublicKey(sk).slice(0, 8)}` });
console.log('shop', v.status, v.body.live_blockers);

const p = await call(
  'POST',
  '/api/v1/inventory',
  { title: 'Pagne tissé', price: { amount: 9000, currency: 'XOF' }, variants: [{ options: {}, on_hand: 3 }] },
  { 'idempotency-key': crypto.randomUUID() },
);
console.log('create product without a plan', p.status, p.body.code, '-', p.body.detail);

// Live stream on the new shop, fed by an agent notification.
const ctrl = new AbortController();
const res = await fetch(`${base}/api/v1/vendors/me/events`, { headers: { cookie }, signal: ctrl.signal });
console.log('stream', res.status, res.headers.get('content-type'));
const reader = res.body.getReader();
const dec = new TextDecoder();
let text = '';
const read = (async () => {
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += dec.decode(value);
    }
  } catch {}
})();
const n = await call('POST', `/internal/v1/vendors/${v.body.id}/notifications`, { type: 'conversation.handoff', conversation_id: crypto.randomUUID(), title: 'Fatou veut vous parler' }, { authorization: `Bearer ${token}` });
console.log('agent notification', n.status);
for (let i = 0; i < 40 && !text.includes('conversation.handoff'); i++) await new Promise((r) => setTimeout(r, 100));
console.log('stream received:', (text.match(/event: \S+/g) ?? []).join(', ') || 'nothing');
ctrl.abort();
await read;

const orders = await call('GET', '/api/v1/orders');
const metrics = await call('GET', '/api/v1/vendors/dashboard/metrics?period=7d');
console.log('orders', orders.status, orders.body.data.length, '| metrics', metrics.status, metrics.body.orders);
