import { describe, expect, it } from 'vitest';
import {
  addLine,
  type CartLine,
  countItems,
  MAX_QTY,
  readCart,
  setQuantity,
  writeCart,
} from './cart';
import { formatMoney, formatOptions, formatSats, toE164 } from './format';

const line = (id: string, quantity = 1): CartLine => ({
  variant_id: id,
  product_slug: 'baskets-blanches',
  title: 'Baskets blanches',
  options: { size: '42' },
  unit_price: { amount: 20000, currency: 'XOF' },
  quantity,
});

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

describe('cart', () => {
  it('merges the same variant instead of adding a second line', () => {
    const lines = addLine(addLine([], line('a', 1)), line('a', 2));
    expect(lines).toHaveLength(1);
    expect(lines[0]?.quantity).toBe(3);
  });

  it('caps the quantity at the contract maximum', () => {
    expect(addLine([line('a', 49)], line('a', 5))[0]?.quantity).toBe(MAX_QTY);
    expect(setQuantity([line('a')], 'a', 99)[0]?.quantity).toBe(MAX_QTY);
  });

  it('removes a line when its quantity drops to zero', () => {
    expect(setQuantity([line('a'), line('b')], 'a', 0).map((l) => l.variant_id)).toEqual(['b']);
  });

  it('counts items across lines', () => {
    expect(countItems([line('a', 2), line('b', 3)])).toBe(5);
  });

  it('round-trips through storage, per shop', () => {
    const s = new MemoryStorage();
    writeCart('awa-style', [line('a', 2)], s);
    expect(readCart('awa-style', s)).toEqual([line('a', 2)]);
    expect(readCart('autre', s)).toEqual([]);
  });

  it('drops malformed stored data instead of trusting it', () => {
    const s = new MemoryStorage();
    s.setItem('selly:cart:awa-style', '{not json');
    expect(readCart('awa-style', s)).toEqual([]);
    s.setItem(
      'selly:cart:awa-style',
      JSON.stringify([line('a'), { variant_id: 'x', quantity: -2 }]),
    );
    expect(readCart('awa-style', s)).toEqual([line('a')]);
  });
});

describe('format', () => {
  it('prints FCFA and sats in the fr-SN style', () => {
    // ICU versions differ on which space they use; only the shape matters here.
    const plain = (s: string) => s.replace(/\s/g, ' ');
    expect(plain(formatMoney({ amount: 20000, currency: 'XOF' }))).toBe('20 000 F CFA');
    expect(plain(formatSats(37664))).toBe('37 664 sats');
  });

  it('describes variant options in plain words', () => {
    expect(formatOptions({ size: '42', color: 'noir' })).toBe('Taille 42, noir');
  });

  it.each([
    ['77 123 45 67', '+221771234567'],
    ['0771234567', '+221771234567'],
    ['+221 77 123 45 67', '+221771234567'],
    ['00221771234567', '+221771234567'],
    ['+33 6 12 34 56 78', '+33612345678'],
  ])('normalises %s to %s', (input, expected) => {
    expect(toE164(input)).toBe(expected);
  });

  it('rejects text that is not a phone number', () => {
    expect(toE164('abc')).toBeNull();
    expect(toE164('123')).toBeNull();
  });
});
