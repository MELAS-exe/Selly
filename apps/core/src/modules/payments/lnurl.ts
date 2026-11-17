// The Lightning Address fallback (architecture.md section 3.6, F4): when the NWC wallet does not answer, an invoice
// comes from the wallet's Lightning Address (LUD-16 → LNURL-pay, LUD-06), only if its server supports LUD-21
// (`verify`), because Selly must be able to confirm the payment itself (ADR-06). The verify URL is stored with the
// invoice and settlement is checked there.
import { checkInvoice, decodeInvoice, type LightningNetwork } from '@selly/nwc';
import { safeGetJson } from '../../net';
import { sha256Hex } from '../../util';
import type { InvoiceLookup, MadeInvoice } from './provider';

const LUD16_RE = /^([a-z0-9._+-]{1,64})@([a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+)(?::\d{1,5})?$/i;

export class LnurlError extends Error {}

export interface LnurlOptions {
  network: LightningNetwork;
  allowInsecure: boolean;
  timeoutMs?: number;
  now: () => Date;
}

/** user@domain to its LNURL-pay endpoint. http only with allowInsecure (tests on 127.0.0.1). */
export function lnurlpUrl(lud16: string, allowInsecure = false): string {
  const at = lud16.lastIndexOf('@');
  const user = lud16.slice(0, at).toLowerCase();
  const host = lud16.slice(at + 1).toLowerCase();
  const local = allowInsecure && /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host);
  if (!local && !LUD16_RE.test(lud16))
    throw new LnurlError(`"${lud16}" is not a Lightning Address`);
  return `${local ? 'http' : 'https'}://${host}/.well-known/lnurlp/${encodeURIComponent(user)}`;
}

const asObject = (v: unknown, what: string): Record<string, unknown> => {
  if (!v || typeof v !== 'object') throw new LnurlError(`${what}: not a JSON object`);
  const o = v as Record<string, unknown>;
  if (o.status === 'ERROR') throw new LnurlError(`${what}: ${String(o.reason ?? 'error')}`);
  return o;
};

/** An invoice for exactly `amountMsat` from a Lightning Address that supports LUD-21. */
export async function lnurlInvoice(
  lud16: string,
  req: { amountMsat: number; expirySeconds: number; comment?: string },
  opts: LnurlOptions,
): Promise<MadeInvoice> {
  const fetchOpts = { allowInsecure: opts.allowInsecure, timeoutMs: opts.timeoutMs ?? 5_000 };
  const pay = asObject(
    await safeGetJson(lnurlpUrl(lud16, opts.allowInsecure), fetchOpts),
    'lnurlp',
  );
  if (pay.tag !== 'payRequest' || typeof pay.callback !== 'string')
    throw new LnurlError('not an LNURL-pay endpoint');
  const min = Number(pay.minSendable);
  const max = Number(pay.maxSendable);
  if (!(req.amountMsat >= min && req.amountMsat <= max))
    throw new LnurlError(`amount outside ${min}-${max} msat`);

  const cb = new URL(pay.callback);
  cb.searchParams.set('amount', String(req.amountMsat));
  const allowed = Number(pay.commentAllowed ?? 0);
  if (req.comment && allowed > 0) cb.searchParams.set('comment', req.comment.slice(0, allowed));
  const res = asObject(await safeGetJson(cb.toString(), fetchOpts), 'callback');
  if (typeof res.pr !== 'string') throw new LnurlError('callback returned no invoice');
  if (typeof res.verify !== 'string')
    throw new LnurlError('this Lightning Address does not support payment verification (LUD-21)');

  // Same rules as an NWC invoice (section 3.6), except the expiry: the server picks it, so Selly keeps the shorter
  // of the two. A payment after that is a late payment, recorded like any other.
  const decoded = decodeInvoice(res.pr);
  const now = opts.now();
  checkInvoice(res.pr, {
    amountMsat: req.amountMsat,
    paymentHash: decoded.paymentHash,
    maxExpirySeconds: Math.max(decoded.expirySeconds, req.expirySeconds),
    network: opts.network,
    now,
  });
  const ours = new Date(now.getTime() + req.expirySeconds * 1000);
  return {
    source: 'lnurl',
    walletConnectionId: null,
    bolt11: res.pr,
    paymentHash: decoded.paymentHash,
    amountMsat: req.amountMsat,
    expiresAt: decoded.expiresAt < ours ? decoded.expiresAt : ours,
    verifyUrl: res.verify,
  };
}

/** LUD-21: asks the verify URL. A preimage that does not match the payment hash is not a payment. */
export async function lnurlVerify(
  verifyUrl: string,
  paymentHash: string,
  opts: Pick<LnurlOptions, 'allowInsecure' | 'timeoutMs'>,
): Promise<InvoiceLookup> {
  const v = asObject(
    await safeGetJson(verifyUrl, {
      allowInsecure: opts.allowInsecure,
      timeoutMs: opts.timeoutMs ?? 5_000,
    }),
    'verify',
  );
  if (v.settled !== true) return { settled: false };
  const preimage = typeof v.preimage === 'string' ? v.preimage.toLowerCase() : '';
  if (!/^[0-9a-f]{64}$/.test(preimage) || sha256Hex(Buffer.from(preimage, 'hex')) !== paymentHash)
    throw new LnurlError('verify says settled but the preimage does not match');
  return { settled: true, preimage };
}
