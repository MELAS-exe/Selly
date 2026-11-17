import { describe, expect, it } from 'vitest';
import { LocalBus, MAX_PAYLOAD } from './bus';
import { EventHub, type HubEvent } from './hub';

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('event fan-out between instances', () => {
  it('delivers an event published on one instance to a stream open on another, with the same id', async () => {
    const bus = new LocalBus();
    const a = new EventHub();
    const b = new EventHub();
    await a.attachBus(bus, async () => null);
    await b.attachBus(bus, async () => null);
    const seen: HubEvent[] = [];
    b.subscribe('c1', (e) => seen.push(e));

    const sent = a.publish('c1', 'message', { id: 'm1', text: 'Bonjour' });
    await tick();
    expect(seen).toEqual([sent]);
    expect(b.since('c1', 0)).toEqual([sent]);
  });

  it('does not echo an instance its own events, and ignores conversations nobody follows', async () => {
    const bus = new LocalBus();
    const a = new EventHub();
    const b = new EventHub();
    await a.attachBus(bus, async () => null);
    await b.attachBus(bus, async () => null);
    const seenA: HubEvent[] = [];
    a.subscribe('c1', (e) => seenA.push(e));
    a.publish('c1', 'typing', { on: true });
    a.publish('c2', 'typing', { on: true });
    await tick();
    expect(seenA).toHaveLength(1);
    expect(b.size()).toBe(0);
  });

  it('sends a large message as a reference and loads it on the other side', async () => {
    const bus = new LocalBus();
    const sentPayloads: string[] = [];
    const spy = {
      publish: async (m: string) => {
        sentPayloads.push(m);
        await bus.publish(m);
      },
      subscribe: (cb: (m: string) => void) => bus.subscribe(cb),
      close: () => bus.close(),
    };
    const big = { id: 'm-big', text: 'x'.repeat(MAX_PAYLOAD + 100) };
    const a = new EventHub();
    const b = new EventHub();
    await a.attachBus(spy, async () => null);
    await b.attachBus(bus, async (_c, id) => (id === 'm-big' ? big : null));
    const seen: HubEvent[] = [];
    b.subscribe('c1', (e) => seen.push(e));
    a.publish('c1', 'message', big);
    await tick();
    expect(sentPayloads[0]?.length).toBeLessThan(MAX_PAYLOAD);
    expect(seen[0]?.data).toEqual(big);
  });

  it('keeps event ids increasing across instances for one conversation', async () => {
    const bus = new LocalBus();
    const a = new EventHub();
    const b = new EventHub();
    await a.attachBus(bus, async () => null);
    await b.attachBus(bus, async () => null);
    b.subscribe('c1', () => {});
    const first = a.publish('c1', 'message', { id: '1' });
    await tick();
    const second = b.publish('c1', 'message', { id: '2' });
    expect(second.id).toBeGreaterThan(first.id);
    expect(b.since('c1', 0).map((e) => e.id)).toEqual([first.id, second.id]);
  });
});
