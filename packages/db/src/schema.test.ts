import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { core } from './index';
import { createTestDb } from './testing';

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  t = await createTestDb();
}, 60_000);
afterAll(() => t.close());

describe('core schema migrations', () => {
  it('seeds the three plans', async () => {
    const rows = await t.db.select().from(core.plans).orderBy(core.plans.sort);
    expect(rows.map((r) => r.id)).toEqual(['starter', 'pro', 'business']);
    expect(rows[1]?.periodPrices).toEqual({ '1': 15000, '3': 42750, '12': 150000 });
  });

  it('searches products without accents', async () => {
    const [v] = await t.db
      .insert(core.vendors)
      .values({ displayName: 'Awa Style', slug: 'awa-style' })
      .returning();
    await t.db.insert(core.products).values({
      vendorId: v!.id,
      title: 'Robe wax noire',
      slug: 'robe-wax-noire',
      description: 'Tissu élégant',
      priceAmount: 15000,
    });
    const res = await t.db.execute(
      sql`select title from core.products where search @@ plainto_tsquery('simple', public.unaccent_i('élégant'))`,
    );
    expect(res.rows).toHaveLength(1);
  });

  it('refuses reserved above on_hand', async () => {
    const [v] = await t.db
      .insert(core.vendors)
      .values({ displayName: 'Test Shop', slug: 'test-shop' })
      .returning();
    const [p] = await t.db
      .insert(core.products)
      .values({ vendorId: v!.id, title: 'Sac', slug: 'sac', priceAmount: 1000 })
      .returning();
    await expect(
      t.db.insert(core.productVariants).values({ productId: p!.id, onHand: 1, reserved: 2 }),
    ).rejects.toThrow();
  });

  it('allows only one live platform wallet', async () => {
    await t.db.insert(core.walletConnections).values({ owner: 'platform', kind: 'nwc' });
    await expect(
      t.db.insert(core.walletConnections).values({ owner: 'platform', kind: 'nwc' }),
    ).rejects.toThrow();
  });
});
