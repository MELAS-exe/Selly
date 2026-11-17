// The guards on URLs that users choose (Lightning Addresses): no private networks, https only, no redirects.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { lnurlpUrl } from './modules/payments/lnurl';
import { FetchRefused, isPublicAddress, safeGetJson } from './net';

describe('safe outbound fetch', () => {
  it('tells public addresses from private ones, IPv4-mapped IPv6 included', () => {
    for (const a of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])
      expect(isPublicAddress(a), a).toBe(true);
    for (const a of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.5',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:10.0.0.1',
      'not-an-ip',
    ])
      expect(isPublicAddress(a), a).toBe(false);
  });

  it('refuses http, credentials, private literals and names that resolve to private addresses', async () => {
    await expect(safeGetJson('http://example.com/x')).rejects.toBeInstanceOf(FetchRefused);
    await expect(safeGetJson('https://user:pw@example.com/x')).rejects.toBeInstanceOf(FetchRefused);
    await expect(safeGetJson('https://127.0.0.1/x')).rejects.toBeInstanceOf(FetchRefused);
    await expect(safeGetJson('https://[::1]/x')).rejects.toBeInstanceOf(FetchRefused);
    await expect(safeGetJson('https://169.254.169.254/latest/meta-data')).rejects.toBeInstanceOf(
      FetchRefused,
    );
    // localhost resolves to 127.0.0.1: refused in the DNS lookup, before any connection.
    await expect(safeGetJson('https://localhost/x')).rejects.toBeInstanceOf(FetchRefused);
  });

  it('does not follow redirects, and caps the body', async () => {
    const server = http.createServer((req, res) => {
      if (req.url === '/redirect') {
        res.writeHead(302, { location: 'http://169.254.169.254/' });
        return res.end();
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ big: 'x'.repeat(100_000) }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      await expect(safeGetJson(`${base}/redirect`, { allowInsecure: true })).rejects.toBeInstanceOf(
        FetchRefused,
      );
      await expect(safeGetJson(`${base}/big`, { allowInsecure: true })).rejects.toThrow();
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('turns a Lightning Address into its LNURL-pay URL, and refuses anything else', () => {
    expect(lnurlpUrl('Fatou@Getalby.com')).toBe('https://getalby.com/.well-known/lnurlp/fatou');
    for (const bad of ['fatou', '@getalby.com', 'fatou@localhost', 'a@b', 'x@[::1]', 'a b@c.com'])
      expect(() => lnurlpUrl(bad), bad).toThrow();
  });
});
