// Outbound HTTP to hosts that users choose (a vendor's Lightning Address). The threat is SSRF (architecture.md 9.1):
// a crafted address that makes core call its own network. So: https only, every resolved address must be public
// (checked in the socket's DNS lookup, so a second DNS answer cannot swap in a private one), no redirects, a short
// timeout and a small body.
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';

const PRIVATE = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  PRIVATE.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  PRIVATE.addSubnet(net, bits, 'ipv6');

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  // ::ffff:10.0.0.1 is 10.0.0.1.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped) return !PRIVATE.check(mapped, 'ipv4');
  return !PRIVATE.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

export class FetchRefused extends Error {}

const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    const list = addresses as LookupAddress[];
    const bad = list.find((a) => !isPublicAddress(a.address));
    if (bad || list.length === 0)
      return callback(new FetchRefused(`${hostname} resolves to a private address`), '', 0);
    if (options.all)
      return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
    const first = list[0] as LookupAddress;
    callback(null, first.address, first.family);
  });
};

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  /** Tests only: allow http:// and private addresses (a local LNURL server). */
  allowInsecure?: boolean;
}

/** GET a URL and parse its JSON body, under the rules above. Throws FetchRefused or an Error. */
export function safeGetJson(url: string, opts: SafeFetchOptions = {}): Promise<unknown> {
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const maxBytes = opts.maxBytes ?? 64 * 1024;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return Promise.reject(new FetchRefused('not a URL'));
  }
  const insecure = !!opts.allowInsecure;
  if (u.protocol !== 'https:' && !(insecure && u.protocol === 'http:'))
    return Promise.reject(new FetchRefused('only https:// URLs are fetched'));
  if (u.username || u.password) return Promise.reject(new FetchRefused('credentials in URL'));
  // A literal IP skips DNS: check it here.
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!insecure && isIP(host) && !isPublicAddress(host))
    return Promise.reject(new FetchRefused('private address'));

  const mod = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.get(
      u,
      {
        headers: { accept: 'application/json', 'user-agent': 'Selly/1.0' },
        timeout: timeoutMs,
        ...(insecure ? {} : { lookup: publicOnlyLookup }),
      },
      (res) => {
        if ((res.statusCode ?? 0) >= 300 && (res.statusCode ?? 0) < 400) {
          res.resume();
          return reject(new FetchRefused('redirects are not followed'));
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            req.destroy(new FetchRefused('response too large'));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => {
          if ((res.statusCode ?? 0) >= 400)
            return reject(new Error(`HTTP ${res.statusCode} from ${u.host}`));
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch {
            reject(new Error(`${u.host} did not answer JSON`));
          }
        });
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error(`${u.host} did not answer in time`)));
    req.on('error', reject);
  });
}
