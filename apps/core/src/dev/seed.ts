// Demo data so the web and agent developers have a shop to work against: SEED_DEMO=true.
import { core } from '@selly/db';
import { eq } from 'drizzle-orm';
import type { Database } from '../context';

export const DEMO_SLUG = 'awa-style';

export async function seedDemo(db: Database) {
  const [existing] = await db.select().from(core.vendors).where(eq(core.vendors.slug, DEMO_SLUG));
  if (existing) return existing.id;

  const [vendor] = await db
    .insert(core.vendors)
    .values({
      displayName: 'Awa Style',
      slug: DEMO_SLUG,
      contactWhatsappE164: '+221770000000',
      settings: {
        pricing_currency: 'XOF',
        delivery: {
          zones: [
            { id: 'plateau', label: 'Dakar Plateau', fee: { amount: 1000, currency: 'XOF' } },
            { id: 'pikine', label: 'Pikine', fee: { amount: 2000, currency: 'XOF' } },
          ],
          pickup: { available: true, address_text: 'Marché HLM, cantine 12' },
        },
        hours: [{ days: 'lun-sam', open: '09:00', close: '19:00' }],
        agent: {
          enabled: true,
          tone: 'friendly',
          negotiation: { mode: 'allow', max_discount_pct: 10 },
        },
      },
    })
    .returning();
  const vendorId = (vendor as { id: string }).id;

  const catalog = [
    {
      title: 'Robe wax noire',
      slug: 'robe-wax-noire',
      category: 'robes',
      price: 15000,
      sizes: { '38': 4, '40': 6, '42': 3 },
      color: 'noir',
      description: 'Robe en tissu wax, coupe droite, doublée.',
    },
    {
      title: 'Baskets blanches',
      slug: 'baskets-blanches',
      category: 'chaussures',
      price: 20000,
      sizes: { '40': 5, '41': 5, '42': 5, '43': 5, '44': 5 },
      color: null,
      description: 'Baskets en toile blanche, semelle claire.',
    },
    {
      title: 'Sac en cuir',
      slug: 'sac-en-cuir',
      category: 'sacs',
      price: 25000,
      sizes: {},
      color: 'marron',
      description: 'Sac à main en cuir, fait main à Dakar.',
    },
  ];
  for (const c of catalog) {
    const [p] = await db
      .insert(core.products)
      .values({
        vendorId,
        title: c.title,
        slug: c.slug,
        category: c.category,
        description: c.description,
        priceAmount: c.price,
      })
      .returning();
    const productId = (p as { id: string }).id;
    const sizes = Object.entries(c.sizes);
    const colorOpt: Record<string, string> = c.color ? { color: c.color } : {};
    const variants = sizes.length
      ? sizes.map(([size, n]) => ({ productId, options: { size, ...colorOpt }, onHand: n }))
      : [{ productId, options: colorOpt, onHand: 8 }];
    await db.insert(core.productVariants).values(variants);
  }
  return vendorId;
}
