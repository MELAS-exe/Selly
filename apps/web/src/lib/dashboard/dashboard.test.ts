import { describe, expect, it } from 'vitest';
import { reduceEvent } from './events';
import { groupOrders } from './orders';
import { relativeTime } from './time';
import { usageGauge } from './usage';

const now = new Date('2026-11-18T12:00:00Z');

describe('relativeTime', () => {
  it('says "just now" under a minute', () => {
    expect(relativeTime('2026-11-18T11:59:30Z', now)).toBe('just now');
  });
  it('counts minutes, then hours', () => {
    expect(relativeTime('2026-11-18T11:55:00Z', now)).toBe('5 min ago');
    expect(relativeTime('2026-11-18T09:00:00Z', now)).toBe('3 h ago');
  });
  it('says yesterday, then the number of days', () => {
    expect(relativeTime('2026-11-17T10:00:00Z', now)).toBe('yesterday');
    expect(relativeTime('2026-11-14T10:00:00Z', now)).toBe('4 days ago');
  });
  it('gives the date past a week', () => {
    expect(relativeTime('2026-10-02T10:00:00Z', now)).toBe('2 Oct');
  });
  it('never reads a future date as "in"', () => {
    expect(relativeTime('2026-11-18T12:00:20Z', now)).toBe('just now');
  });
});

describe('groupOrders', () => {
  const o = (id: string, created_at: string) => ({ id, created_at });
  it('groups by day, newest first, with Today and Yesterday', () => {
    const groups = groupOrders(
      [
        o('a', '2026-11-16T09:00:00Z'),
        o('b', '2026-11-18T08:00:00Z'),
        o('c', '2026-11-17T20:00:00Z'),
        o('d', '2026-11-18T11:00:00Z'),
      ],
      now,
    );
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday', '16 Nov']);
    expect(groups[0]?.items.map((i) => i.id)).toEqual(['d', 'b']);
  });
  it('returns nothing for no orders', () => {
    expect(groupOrders([], now)).toEqual([]);
  });
});

describe('usageGauge', () => {
  it('gives the share used and a calm level below 80 %', () => {
    expect(usageGauge({ used: 30, limit: 100 })).toEqual({ percent: 30, level: 'ok', left: 70 });
  });
  it('warns from 80 % and is full at the limit', () => {
    expect(usageGauge({ used: 80, limit: 100 }).level).toBe('warn');
    expect(usageGauge({ used: 100, limit: 100 })).toEqual({ percent: 100, level: 'full', left: 0 });
  });
  it('caps the bar at 100 % when usage goes past the limit', () => {
    expect(usageGauge({ used: 130, limit: 100 })).toEqual({ percent: 100, level: 'full', left: 0 });
  });
  it('treats a zero limit as full, not as a division by zero', () => {
    expect(usageGauge({ used: 0, limit: 0 })).toEqual({ percent: 100, level: 'full', left: 0 });
  });
});

describe('reduceEvent', () => {
  const paid = {
    type: 'order.paid',
    id: 'n1',
    data: {
      order_id: 'o1',
      number: 'DMF8',
      total: { amount: 21000, currency: 'XOF' },
      total_sat: 35000,
      at: '2026-11-18T11:59:00Z',
    },
  };

  it('refreshes metrics, the order lists and that order on a payment, and celebrates', () => {
    const r = reduceEvent(paid);
    expect(r.invalidate).toEqual(expect.arrayContaining(['metrics', 'orders', 'order:o1']));
    expect(r.celebrate).toBe(true);
    expect(r.activity).toMatchObject({
      id: 'n1',
      kind: 'order.paid',
      orderId: 'o1',
      number: 'DMF8',
    });
  });

  it('does not celebrate a new unpaid order', () => {
    const r = reduceEvent({ ...paid, type: 'order.created' });
    expect(r.celebrate).toBe(false);
    expect(r.invalidate).toContain('orders');
  });

  it('refreshes drafts on draft.ready, and the wallet and shop on wallet.degraded', () => {
    expect(
      reduceEvent({ type: 'draft.ready', id: 'n2', data: { draft_id: 'd1' } }).invalidate,
    ).toEqual(expect.arrayContaining(['drafts', 'draft:d1', 'metrics']));
    expect(reduceEvent({ type: 'wallet.degraded', id: 'n3', data: {} }).invalidate).toEqual(
      expect.arrayContaining(['wallet', 'vendor']),
    );
  });

  it('refreshes the inbox on a handoff and keeps the conversation id for the feed', () => {
    const r = reduceEvent({
      type: 'conversation.handoff',
      id: 'n4',
      data: { conversation_id: 'c1', title: 'Fatou wants to talk to you' },
    });
    expect(r.invalidate).toEqual(expect.arrayContaining(['conversations', 'metrics']));
    expect(r.activity).toMatchObject({ kind: 'conversation.handoff', conversationId: 'c1' });
  });

  it('refreshes the subscription on subscription.updated and usage.warning', () => {
    expect(reduceEvent({ type: 'subscription.updated', id: 'n5', data: {} }).invalidate).toEqual(
      expect.arrayContaining(['subscription', 'vendor']),
    );
    expect(reduceEvent({ type: 'usage.warning', id: 'n6', data: {} }).invalidate).toContain(
      'subscription',
    );
  });

  it('ignores an unknown event without failing', () => {
    expect(reduceEvent({ type: 'something.new', id: 'n7', data: {} })).toEqual({
      invalidate: [],
      celebrate: false,
      activity: null,
    });
  });
});
