// Smoke test of vendor sign-in against a running core: node scripts/signin-smoke.mjs http://localhost:4000
// Signs in with a fresh key, creates a shop, reads it back, and checks that the session cookie works.
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';

const base = process.argv[2] ?? 'http://localhost:4000';
const origin = process.env.APP_BASE_URL ?? 'http://localhost:3000';
const sk = generateSecretKey();
let cookie = '';

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', origin, ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const set = res.headers.get('set-cookie');
  if (set?.startsWith('selly_session=')) cookie = set.split(';')[0];
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, set };
}

const c = await call('POST', '/api/v1/auth/nostr/challenges', { purpose: 'sign_in' });
console.log('challenge', c.status, c.body.purpose);
const event = finalizeEvent(c.body.event_template, sk);
const s = await call('POST', '/api/v1/auth/nostr/sessions', {
  challenge_id: c.body.challenge_id,
  event,
  device_label: 'smoke test',
});
console.log(
  'sign-in',
  s.status,
  'vendor',
  s.body.vendor,
  'cookie flags:',
  s.set
    ?.split(';')
    .slice(1)
    .map((x) => x.trim())
    .join(', '),
);
const slug = `smoke-${getPublicKey(sk).slice(0, 8)}`;
const v = await call('POST', '/api/v1/vendors', { display_name: 'Smoke Shop', slug });
console.log('create shop', v.status, v.body.slug, 'blockers', v.body.live_blockers);
const me = await call('GET', '/api/v1/vendors/me');
console.log('me', me.status, me.body.id === v.body.id ? 'same shop' : 'MISMATCH');
const replay = await call('POST', '/api/v1/auth/nostr/sessions', {
  challenge_id: c.body.challenge_id,
  event,
});
console.log('replay', replay.status, replay.body.code);
const out = await call('POST', '/api/v1/auth/logout');
const after = await call('GET', '/api/v1/vendors/me');
console.log('logout', out.status, 'then me', after.status);
