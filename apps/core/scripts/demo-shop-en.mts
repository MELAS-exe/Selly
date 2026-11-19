// Maison Sokhna in English, for the demo video (video/SCRIPT.md): the shop's locale, texts, catalogue, past orders
// and discussions, changed in place in the local database. Dev only, like demo-shop.mts, which must have run first.
//
//   pnpm --filter @selly/core exec tsx scripts/demo-shop-en.mts
//
// Run it once: it translates the French texts it finds and leaves the others alone, so a second run changes nothing.
import { execFileSync } from 'node:child_process';
import { nip19 } from 'nostr-tools';
import { finalizeEvent } from 'nostr-tools/pure';

const CORE = process.env.CORE ?? 'http://localhost:4000';
const ORIGIN = 'http://localhost:3000';
const DB_CONTAINER = process.env.DB_CONTAINER ?? 'selly-postgres-1';
const SLUG = 'maison-sokhna';
/** The demo shop's public key, as in demo-shop.mts and JUDGES.txt. */
const DEMO_NSEC = 'nsec19sqnr30hewl5ha7c65rgf56wluf6tn770h7wc8lt49f2tjx0ey4spllaaq';

const HERO = {
  eyebrow: 'Atelier and crafts · Sacré-Cœur, Dakar',
  title: 'Local craft, chosen and sewn for you.',
  text: 'Hand-woven cloth, clothes from the atelier, baskets, leather and jewellery by West African artisans, delivered all over Dakar in 24 h.',
  cta: 'See the collection',
};
const BANNER_TEXT = 'Free delivery in Dakar from 30,000 FCFA';
const ZONES: Record<string, string> = {
  'sacre-coeur': 'Mermoz, Sacré-Cœur',
};
const POLICIES = {
  returns:
    'Free exchange or alteration within 7 days, with your order. Made-to-measure pieces are not taken back.',
  payment: 'Paid in bitcoin (Lightning), straight to the atelier.',
};

const CATEGORIES: Record<string, string> = {
  Vêtements: 'Clothes',
  'Pagnes & tissus': 'Cloth & wax',
  'Sacs & paniers': 'Bags & baskets',
  Chaussures: 'Shoes',
  Bijoux: 'Jewellery',
  'Maison & beauté': 'Home & beauty',
};

/** French title → English title and description. */
const PRODUCTS: Record<string, [string, string]> = {
  'Robe Awa rouge': [
    'Awa red dress',
    'Straight dress in red crêpe, round neck and three-quarter sleeves, lined. Cut at the atelier, alterations free.',
  ],
  'Robe de cérémonie Safran': [
    'Saffron ceremony dress',
    'Long saffron satin dress, bodice embroidered with raised flowers and a full skirt. For weddings and baptisms.',
  ],
  'Chemise Modou imprimée': [
    'Modou printed shirt',
    'Men’s shirt in indigo printed cotton, classic collar, straight cut. Worn open over a tee or buttoned up.',
  ],
  'Chemise en lin blanc': [
    'White linen shirt',
    'Washed linen shirt, light and breathable for the Dakar heat. Also in khaki.',
  ],
  'Veste brodée indigo': [
    'Embroidered indigo jacket',
    'Short indigo cotton jacket, embroidered by hand all over with white patterns. A numbered artisan piece.',
  ],
  'Pagne kente tissé main': [
    'Hand-woven kente cloth',
    'Kente woven by hand in sewn strips, orange, yellow and green. Sold by the piece, 2 × 1.20 m, for a boubou or a skirt.',
  ],
  'Pagne indigo à losanges': [
    'Indigo diamond cloth',
    'Woven cotton cloth dyed with natural indigo, ochre diamond pattern. The blue softens gently with washing.',
  ],
  'Sac rond en rotin': [
    'Round rattan bag',
    'Round bag hand-woven in rattan, buckle closure and leather strap. Lined with wax print inside.',
  ],
  'Sac rond tressé émeraude': [
    'Emerald woven round bag',
    'The same round bag, woven with fibres dyed emerald green and ochre. Adjustable leather strap.',
  ],
  'Panier Bolga': [
    'Bolga basket',
    'Large basket woven in elephant grass, bright colours, leather-wrapped handle. For the market, laundry or toys.',
  ],
  'Corbeille suspendue tressée': [
    'Woven hanging basket',
    'Woven basket to hang, for plants or fruit. Braided ropes included.',
  ],
  'Sac en cuir Kumba': [
    'Kumba leather bag',
    'Full-grain leather handbag tanned in Ngaye Mékhé, two handles and a removable strap. Fits a 13-inch laptop.',
  ],
  'Sac week-end en toile': [
    'Canvas weekend bag',
    'Travel bag in royal blue cotton canvas, leather trims, shoulder strap. Cabin size.',
  ],
  'Sandales fleuries en cuir': [
    'Flowered leather sandals',
    'Natural leather sandals decorated with enamel flowers, ankle buckle. Made in Thiès.',
  ],
  'Sandales Thiès en cuir ajouré': [
    'Thiès openwork leather sandals',
    'Openwork, woven leather mules with a hand-sewn sole. The leather shapes to your foot after a few days.',
  ],
  'Perles de verre recyclé': [
    'Recycled glass beads',
    'A strand of large recycled glass beads, blown and painted by hand. Worn as a long necklace or a belt.',
  ],
  'Collier plastron en céramique': [
    'Ceramic bib necklace',
    'A bib of white and blue glazed ceramic discs on a black cord. Handmade.',
  ],
  'Créoles Soleil en laiton doré': [
    'Soleil gilded brass hoops',
    'Hammered, gilded brass hoops with a heart pendant. Light, made by an artisan in Soumbédioune.',
  ],
  'Savons au karité': [
    'Shea butter soaps',
    'Cold-process soap with shea butter from Burkina and baobab oil. A 120 g bar, no added scent.',
  ],
  'Bol en terre cuite': [
    'Terracotta bowl',
    'Terracotta bowl thrown and fired by hand, smooth inside. To serve or decorate, 18 cm.',
  ],
};

const OPTION_KEYS: Record<string, string> = { taille: 'size', pointure: 'size', couleur: 'color' };
const OPTION_VALUES: Record<string, string> = {
  Unique: 'One size',
  Blanc: 'White',
  Kaki: 'Khaki',
  Moyen: 'Medium',
  Grand: 'Large',
  Multicolore: 'Multicolour',
  Noir: 'Black',
  'Bleu roi': 'Royal blue',
  'Vert et cuivre': 'Green and copper',
  'Blanc et bleu': 'White and blue',
  Doré: 'Gold',
  '1 pain': '1 bar',
  'Lot de 3': 'Pack of 3',
  '2 × 1,20 m': '2 × 1.20 m',
};

/** Delivery addresses of the seeded orders that are not just place names. */
const ADDRESSES: Record<string, string> = {
  'Avenue Pompidou, en face de la BICIS': 'Avenue Pompidou, opposite the BICIS',
  'Mermoz, près de la pharmacie Mame Diarra': 'Mermoz, near the Mame Diarra pharmacy',
  'Unité 9, près du marché': 'Unité 9, near the market',
};

/** The seeded discussions (demo-shop.mts), line by line. */
const MESSAGES: Record<string, string> = {
  'Bonjour, la robe Safran existe en vert ? C’est pour un baptême samedi.':
    'Hello, does the Saffron dress come in green? It’s for a baptism on Saturday.',
  'Bonjour Khady ! La robe Safran est en satin safran, en S, M et L. Pour une autre couleur, je demande à l’atelier.':
    'Hello Khady! The Saffron dress is in saffron satin, in S, M and L. For another colour, I’ll ask the atelier.',
  'Oui demandez svp, et est-ce que je peux l’avoir avant samedi ?':
    'Yes please ask, and can I have it before Saturday?',
  'Je transmets à Sokhna, elle vous répond ici même.':
    'I’m passing this to Sokhna, she will answer you right here.',
  'Salam, je voudrais 6 chemises Modou pour un mariage, vous faites un prix ?':
    'Salam, I’d like 6 Modou shirts for a wedding, can you do a price?',
  'Wa aleykum salam Cheikh ! Pour 6 chemises, je préviens l’atelier : c’est Sokhna qui fixe les prix de groupe.':
    'Wa aleykum salam Cheikh! For 6 shirts I’ll tell the atelier: Sokhna sets group prices herself.',
  'Vous livrez aux Almadies ?': 'Do you deliver to Almadies?',
  'Oui, aux Almadies, à Ngor et à Yoff pour 1 500 FCFA, en 24 h. La livraison est offerte dès 30 000 FCFA d’achat.':
    'Yes, to Almadies, Ngor and Yoff for 1,500 FCFA, in 24 h. Delivery is free from 30,000 FCFA.',
  'Parfait, et le sac Kumba existe en noir ?': 'Perfect, and does the Kumba bag come in black?',
  'Oui, en cognac et en noir. Il en reste quelques-uns en noir.':
    'Yes, in cognac and in black. There are a few left in black.',
  'Je la prends, merci !': 'I’ll take it, thank you!',
  'Je fais du 42, les sandales Thiès taillent comment ?': 'I’m a 42, how do the Thiès sandals fit?',
  'Elles taillent normalement : prenez votre pointure habituelle, le 42. Le cuir se fait au pied après quelques jours.':
    'They fit true to size: take your usual 42. The leather shapes to your foot after a few days.',
  'Bonjour, ma robe Awa est un peu grande, je peux l’échanger ?':
    'Hello, my Awa dress is a little big, can I exchange it?',
  'Bien sûr : l’échange ou la retouche est gratuit sous 7 jours. Je préviens l’atelier.':
    'Of course: exchanges and alterations are free within 7 days. I’ll tell the atelier.',
  'Bonjour Binta, passez à l’atelier quand vous voulez, on la reprend à votre taille en 30 minutes.':
    'Hello Binta, come by the atelier whenever you like, we’ll take it in to your size in 30 minutes.',
  'Super, je passe demain matin. Merci Sokhna !':
    'Great, I’ll come tomorrow morning. Thank you Sokhna!',
  'Il existe en moyen (35 cm de diamètre) et en grand (45 cm). Le grand tient une semaine de linge ou le marché du samedi.':
    'It comes in medium (35 cm across) and large (45 cm). The large one holds a week of laundry or the Saturday market.',
  'Le panier Bolga, il fait quelle taille ?': 'The Bolga basket, how big is it?',
};

// ------------------------------------------------------------------------------------------------- plumbing

function sql(query: string) {
  return execFileSync(
    'docker',
    [
      'exec',
      '-i',
      DB_CONTAINER,
      'psql',
      '-U',
      'selly',
      '-d',
      'selly',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input: query, encoding: 'utf8' },
  );
}
const lit = (s: string) => `'${s.replaceAll("'", "''")}'`;
const slugify = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

async function signIn() {
  let cookie = '';
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(CORE + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        origin: ORIGIN,
        ...(cookie ? { cookie } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const set = res.headers.get('set-cookie');
    if (set?.startsWith('selly_session=')) cookie = set.split(';')[0] as string;
    const text = await res.text();
    if (res.status >= 400)
      throw new Error(`${method} ${path}: HTTP ${res.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  };
  const sk = nip19.decode(DEMO_NSEC).data as Uint8Array;
  const c = await call('POST', '/api/v1/auth/nostr/challenges', { purpose: 'sign_in' });
  await call('POST', '/api/v1/auth/nostr/sessions', {
    challenge_id: c.challenge_id,
    event: finalizeEvent(c.event_template, sk),
    device_label: 'demo seed (English)',
  });
  return call;
}

// ------------------------------------------------------------------------------------------------- run

async function main() {
  const call = await signIn();
  const me = await call('GET', '/api/v1/vendors/me');
  if (me.slug !== SLUG) throw new Error(`The demo key opens ${me.slug}, not ${SLUG}.`);
  const vendorId = me.id as string;
  // The stored settings, not the API's view of them (which adds image URLs the PATCH refuses).
  const settings = JSON.parse(
    sql(`select settings from core.vendors where id = ${lit(vendorId)};`),
  );

  console.log('shop');
  await call('PATCH', '/api/v1/vendors/me', {
    locale: 'en',
    settings: {
      delivery: {
        ...settings.delivery,
        zones: (settings.delivery?.zones ?? []).map((z: { id: string; label: string }) => ({
          ...z,
          label: ZONES[z.id] ?? z.label,
        })),
      },
      policies: POLICIES,
      branding: {
        hero: HERO,
        banner: { ...settings.branding?.banner, text: BANNER_TEXT },
      },
    },
  });

  console.log('catalogue');
  const v = lit(vendorId);
  const updates: string[] = [];
  for (const [fr, en] of Object.entries(CATEGORIES))
    updates.push(
      `update core.categories set name = ${lit(en)}, slug = ${lit(slugify(en))} where vendor_id = ${v} and name = ${lit(fr)};`,
    );
  for (const [fr, [title, description]] of Object.entries(PRODUCTS)) {
    updates.push(
      `update core.products set title = ${lit(title)}, description = ${lit(description)}, slug = ${lit(slugify(title))}
  where vendor_id = ${v} and title = ${lit(fr)};`,
      `update core.order_items set title_snapshot = ${lit(title)} where title_snapshot = ${lit(fr)}
  and order_id in (select id from core.orders where vendor_id = ${v});`,
      // Product cards in the discussions carry the title and the link.
      `update agent.messages set cards = replace(replace(cards::text, ${lit(JSON.stringify(fr))}, ${lit(JSON.stringify(title))}),
  ${lit(`/p/${slugify(fr)}"`)}, ${lit(`/p/${slugify(title)}"`)})::jsonb
  where conversation_id in (select id from agent.conversations where vendor_id = ${v});`,
    );
  }
  // Option names and values, in the variants and in the order lines.
  const options = (col: string) => {
    let expr = col;
    for (const [fr, en] of Object.entries(OPTION_KEYS))
      expr = `(case when ${expr} ? ${lit(fr)} then (${expr} - ${lit(fr)}) || jsonb_build_object(${lit(en)}, ${expr} -> ${lit(fr)}) else ${expr} end)`;
    let text = `${expr}::text`;
    for (const [fr, en] of Object.entries(OPTION_VALUES))
      text = `replace(${text}, ${lit(JSON.stringify(fr))}, ${lit(JSON.stringify(en))})`;
    return `${text}::jsonb`;
  };
  updates.push(
    `update core.product_variants set options = ${options('options')}
  where product_id in (select id from core.products where vendor_id = ${v});`,
    `update core.order_items set options_snapshot = ${options('options_snapshot')}
  where order_id in (select id from core.orders where vendor_id = ${v});`,
  );

  for (const [fr, en] of Object.entries(ADDRESSES))
    updates.push(
      `update core.orders set delivery = jsonb_set(delivery, '{address_text}', to_jsonb(${lit(en)}::text))
  where vendor_id = ${v} and delivery->>'address_text' = ${lit(fr)};`,
    );

  console.log('discussions');
  const convs = `(select id from agent.conversations where vendor_id = ${v})`;
  for (const [fr, en] of Object.entries(MESSAGES))
    updates.push(
      `update agent.messages set text = ${lit(en)} where text = ${lit(fr)} and conversation_id in ${convs};`,
    );
  updates.push(
    `update agent.messages set author_label = ${lit('Maison Sokhna’s assistant')}
  where author_label = ${lit('Assistant de Maison Sokhna')} and conversation_id in ${convs};`,
    `update agent.messages set author_label = ${lit('Maison Sokhna (seller)')}
  where author_label = ${lit('Maison Sokhna (vendeur)')} and conversation_id in ${convs};`,
  );
  sql(`begin;\n${updates.join('\n')}\ncommit;`);

  const left = sql(
    `select count(*) from core.products where vendor_id = ${v}
  and title in (${Object.keys(PRODUCTS).map(lit).join(', ')});`,
  ).trim();
  console.log(`done: ${SLUG} is in English (${left} product titles left in French).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
