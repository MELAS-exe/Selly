// Test helpers for other packages: import from '@selly/core/testing' (add "@selly/core": "workspace:*" to
// devDependencies). They run core in-process on PGlite with a fake wallet and a clock the test controls. Never import
// this from production code.
import { core } from '@selly/db';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { createSession } from './modules/auth/service';
import type { TestApp } from './test-helpers';

export { assertContract } from './contract';
export { dispatchOnce, signEvent } from './modules/events/dispatcher';
export { confirmPayment, reconcileOnce, settleInvoice } from './modules/payments/service';
export {
  reconcileSubscriptionInvoices,
  runSubscriptionJob,
  settleSubscriptionInvoice,
} from './modules/subscriptions/billing';
export {
  createShop,
  createTestApp,
  feed,
  idemKey,
  orderPayload,
  SERVICE_TOKEN,
  type TestApp,
} from './test-helpers';

/**
 * A signed-in vendor session for `vendorId`, as the Nostr sign-in would create it. Returns the cookie value
 * (send it as `selly_session=<value>`) and the key. Use it to test routes that check sessions through
 * POST /internal/v1/sessions/introspect.
 */
export async function createVendorSession(
  t: TestApp,
  vendorId: string,
  opts: { pubkey?: string; deviceLabel?: string } = {},
) {
  const pubkey = opts.pubkey ?? getPublicKey(generateSecretKey());
  await t.db
    .insert(core.vendorKeys)
    .values({ pubkey, vendorId, label: 'test' })
    .onConflictDoNothing();
  const { session, token } = await createSession(t.ctx, {
    pubkey,
    vendorId,
    deviceLabel: opts.deviceLabel ?? 'test',
  });
  return { cookie: token, sessionId: session.id, pubkey };
}
