import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/browser-api';
import { demoRequest } from './demo';
import { daysUntil, fmtShort, fmtWhen, itemsLine, orderBadge } from './format';
import type { Page, Vendor, VendorOrder, VendorProduct } from './types';

describe('labels', () => {
  it('puts a refund to make before the order status', () => {
    expect(orderBadge({ status: 'paid', attention: null })).toEqual({
      tone: 'paid',
      label: 'Payée · à expédier',
    });
    expect(orderBadge({ status: 'paid', attention: 'paid_twice' }).tone).toBe('alert');
    expect(orderBadge({ status: 'expired', attention: 'paid_without_stock' }).label).toBe(
      'Payée sans stock',
    );
  });

  it('writes amounts, dates and items the way a vendor in Dakar reads them', () => {
    expect(fmtShort(85_000)).toBe('85k');
    expect(fmtShort(1_250_000)).toBe('1,3M');
    const now = new Date('2026-11-18T12:00:00Z');
    expect(fmtWhen('2026-11-18T09:18:00Z', now)).toBe('Aujourd’hui, 09:18');
    expect(fmtWhen('2026-11-17T17:36:00Z', now)).toBe('Hier, 17:36');
    expect(daysUntil('2026-11-30T12:00:00Z', now)).toBe(12);
    const item = {
      title: 'Sandales',
      options: { size: '42' },
      quantity: 2,
      unit_price: { amount: 1, currency: 'XOF' as const },
    };
    expect(itemsLine({ items: [item] })).toBe('Sandales · Taille 42 × 2');
    expect(itemsLine({ items: [item, item, item] })).toBe('Sandales · Taille 42 × 2 + 2 autres');
  });
});

describe('demo shop', () => {
  it('ships a paid order, and refuses to ship one that is not paid', async () => {
    const paid = await demoRequest<Page<VendorOrder>>('/orders?status=paid');
    const order = paid.data[0] as VendorOrder;
    const done = await demoRequest<VendorOrder>(`/orders/${order.id}/fulfill`, {
      method: 'PATCH',
      body: {},
    });
    expect(done.status).toBe('fulfilled');
    await expect(
      demoRequest(`/orders/${order.id}/fulfill`, { method: 'PATCH', body: {} }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('never takes stock below what pending orders hold', async () => {
    const { data } = await demoRequest<Page<VendorProduct>>('/inventory');
    const v = data.flatMap((p) => p.variants).find((x) => x.reserved > 0);
    if (!v) throw new Error('no reserved variant in the demo');
    await expect(
      demoRequest(`/inventory/variants/${v.id}/adjustments`, {
        method: 'POST',
        body: { set_to: v.reserved - 1, reason: 'adjustment' },
      }),
    ).rejects.toMatchObject({ problem: { code: 'VALIDATION_FAILED' } });
  });

  it('keeps settings merged one level deep, like core', async () => {
    await demoRequest('/vendors/me', {
      method: 'PATCH',
      body: { settings: { agent: { enabled: false, tone: 'formal' } } },
    });
    const v = await demoRequest<Vendor>('/vendors/me');
    expect(v.settings.agent).toMatchObject({ enabled: false, tone: 'formal' });
    expect(v.settings.alerts.web_push).toBe(true);
  });

  it('answers the chart with one point a day, today last', async () => {
    const m = await demoRequest<{ series: { date: string }[] }>(
      '/vendors/dashboard/metrics?period=7d',
    );
    expect(m.series).toHaveLength(7);
    expect(m.series.at(-1)?.date).toBe(new Date().toISOString().slice(0, 10));
  });
});

describe('error messages', () => {
  it('shows core’s own explanation for wallet errors', async () => {
    const { errorText } = await import('./data');
    const detail = 'Votre portefeuille ne peut pas encore recevoir de paiement.';
    expect(
      errorText(
        new ApiError({
          type: 'about:blank',
          title: 'x',
          status: 422,
          code: 'NWC_WALLET_ERROR',
          detail,
        }),
      ),
    ).toBe(detail);
    expect(
      errorText(
        new ApiError({ type: 'about:blank', title: 'x', status: 429, code: 'RATE_LIMITED' }),
      ),
    ).toBe('Trop de requêtes, réessayez dans un instant.');
  });
});
