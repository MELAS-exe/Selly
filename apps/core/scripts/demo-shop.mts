// A demo vendor with real-looking data, for screenshots and presentations: Maison Sokhna, an atelier and craft shop in
// Dakar. Its own logo and colours, a catalogue with photos, six weeks of orders paid through the fake wallet, and
// a few customer discussions. Dev only: it writes straight into the local database to backdate the sales.
//
//   pnpm dev:testwallet                                       the fake wallets must be running
//   pnpm --filter @selly/core exec tsx scripts/demo-shop.mts  then this
//
// Photos come from demo-shop-photos/ next to this script (public-domain images from Openverse, credits in its
// CREDITS.txt). The shop's Nostr key is the fixed demo key below, published on purpose so anyone running the demo can
// sign in as the shop (JUDGES.txt): it opens nothing but this local demo shop. The shop is made once: delete it (or
// change SLUG) to run the script again.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { nip19 } from 'nostr-tools';
import { finalizeEvent } from 'nostr-tools/pure';
import sharp from 'sharp';

const CORE = process.env.CORE ?? 'http://localhost:4000';
const WALLET = process.env.TESTWALLET ?? 'http://127.0.0.1:7788';
const ORIGIN = 'http://localhost:3000';
const DB_CONTAINER = process.env.DB_CONTAINER ?? 'selly-postgres-1';
const PHOTOS = new URL('demo-shop-photos/', import.meta.url);
const SLUG = 'maison-sokhna';
/** The demo shop's key (npub npub1mu28sl69f56vj6wxnpt0dnxwmsjt95wyreex73cdhgz67vnuwv0qhuxhlh). Public on purpose: a demo account, never a real one. */
const DEMO_NSEC = 'nsec19sqnr30hewl5ha7c65rgf56wluf6tn770h7wc8lt49f2tjx0ey4spllaaq';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const key = (p: string) => `${p}-${crypto.randomUUID()}`.slice(0, 60);

// ------------------------------------------------------------------------------------------------- the shop

const BRAND = {
  primary_color: '#1E2B5C', // deep indigo: text, buttons, dark sections
  accent_color: '#C8642B', // terracotta: marks and accents
  background_color: '#FAF4EA', // warm cream paper
};

const HERO = {
  eyebrow: 'Atelier et artisanat · Sacré-Cœur, Dakar',
  title: 'L’artisanat d’ici, choisi et cousu pour vous.',
  text: 'Pagnes tissés main, vêtements de l’atelier, paniers, cuirs et bijoux d’artisans d’Afrique de l’Ouest, livrés partout à Dakar en 24 h.',
  cta: 'Voir la collection',
};

const BANNER = { text: 'Livraison offerte dès 30 000 FCFA à Dakar', photo: 'banner.jpg' };

const ZONES = [
  { id: 'plateau', label: 'Dakar Plateau', fee: 1000 },
  { id: 'sacre-coeur', label: 'Sacré-Cœur, Mermoz', fee: 1000 },
  { id: 'almadies', label: 'Almadies, Ngor, Yoff', fee: 1500 },
  { id: 'parcelles', label: 'Parcelles Assainies', fee: 1500 },
  { id: 'pikine', label: 'Pikine, Guédiawaye', fee: 2000 },
  { id: 'rufisque', label: 'Rufisque', fee: 2500 },
];
const PICKUP = 'Atelier Sokhna, Sacré-Cœur 3, villa 8812';

type Product = {
  title: string;
  category: string;
  price: number;
  description: string;
  photos: string[];
  /** Size or colour, with the stock of each. */
  variants: [Record<string, string>, number][];
};

const sizes = (axis: 'taille' | 'pointure', list: string[], stock: number[]) =>
  list.map((v, i) => [{ [axis]: v }, stock[i] ?? 4] as [Record<string, string>, number]);

const PRODUCTS: Product[] = [
  {
    title: 'Robe Awa rouge',
    category: 'Vêtements',
    price: 26000,
    description:
      'Robe droite en crêpe rouge, col rond et manches trois-quarts, doublée. Coupée à l’atelier, retouche offerte.',
    photos: ['robe-rouge.jpg'],
    variants: sizes('taille', ['S', 'M', 'L', 'XL'], [5, 8, 7, 4]),
  },
  {
    title: 'Robe de cérémonie Safran',
    category: 'Vêtements',
    price: 45000,
    description:
      'Robe longue en satin safran, bustier brodé de fleurs en relief et jupe ample. Pour les mariages et les baptêmes.',
    photos: ['robe-safran.jpg'],
    variants: sizes('taille', ['S', 'M', 'L'], [3, 5, 4]),
  },
  {
    title: 'Chemise Modou imprimée',
    category: 'Vêtements',
    price: 18000,
    description:
      'Chemise homme en coton imprimé indigo, col classique, coupe droite. Se porte ouverte sur un tee-shirt ou boutonnée.',
    photos: ['chemise-imprimee.jpg'],
    variants: sizes('taille', ['M', 'L', 'XL', 'XXL'], [7, 9, 6, 3]),
  },
  {
    title: 'Chemise en lin blanc',
    category: 'Vêtements',
    price: 22000,
    description:
      'Chemise en lin lavé, légère et respirante pour la chaleur de Dakar. Existe aussi en kaki.',
    photos: ['chemise-lin.jpg'],
    variants: [
      [{ taille: 'M', couleur: 'Blanc' }, 6],
      [{ taille: 'L', couleur: 'Blanc' }, 7],
      [{ taille: 'L', couleur: 'Kaki' }, 4],
      [{ taille: 'XL', couleur: 'Kaki' }, 3],
    ],
  },
  {
    title: 'Veste brodée indigo',
    category: 'Vêtements',
    price: 38000,
    description:
      'Veste courte en coton indigo entièrement brodée à la main de motifs blancs. Une pièce d’artisan, numérotée.',
    photos: ['veste-brodee.jpg'],
    variants: [[{ taille: 'Unique' }, 4]],
  },
  {
    title: 'Pagne kente tissé main',
    category: 'Pagnes & tissus',
    price: 32000,
    description:
      'Kente tissé à la main en bandes cousues, orange, jaune et vert. Vendu par pagne de 2 × 1,20 m, pour un boubou ou une jupe.',
    photos: ['pagne-kente.jpg'],
    variants: [[{ format: '2 × 1,20 m' }, 9]],
  },
  {
    title: 'Pagne indigo à losanges',
    category: 'Pagnes & tissus',
    price: 24000,
    description:
      'Pagne tissé en coton teint à l’indigo naturel, motif losange ocre. Le bleu se patine doucement au lavage.',
    photos: ['pagne-indigo.jpg'],
    variants: [[{ format: '2 × 1,20 m' }, 8]],
  },
  {
    title: 'Sac rond en rotin',
    category: 'Sacs & paniers',
    price: 14000,
    description:
      'Sac rond tressé à la main en rotin, fermeture à boucle et bandoulière en cuir. Doublé de wax à l’intérieur.',
    photos: ['sac-rotin.jpg'],
    variants: [[{ taille: '20 cm' }, 10]],
  },
  {
    title: 'Sac rond tressé émeraude',
    category: 'Sacs & paniers',
    price: 16000,
    description:
      'Le même sac rond, tressé de fibres teintes en vert émeraude et ocre. Bandoulière réglable en cuir.',
    photos: ['sac-vert.jpg'],
    variants: [[{ taille: '20 cm' }, 7]],
  },
  {
    title: 'Panier Bolga',
    category: 'Sacs & paniers',
    price: 19000,
    description:
      'Grand panier tressé en herbe d’éléphant, couleurs vives, anse gainée de cuir. Pour le marché, le linge ou les jouets.',
    photos: ['panier-bolga.jpg'],
    variants: [
      [{ taille: 'Moyen' }, 8],
      [{ taille: 'Grand' }, 5],
    ],
  },
  {
    title: 'Corbeille suspendue tressée',
    category: 'Sacs & paniers',
    price: 9500,
    description:
      'Corbeille tressée à suspendre, pour les plantes ou les fruits. Cordes tressées incluses.',
    photos: ['corbeille.jpg'],
    variants: [[{ couleur: 'Multicolore' }, 12]],
  },
  {
    title: 'Sac en cuir Kumba',
    category: 'Sacs & paniers',
    price: 42000,
    description:
      'Sac à main en cuir pleine fleur tanné à Ngaye Mékhé, deux anses et bandoulière amovible. Tient un ordinateur 13 pouces.',
    photos: ['sac-cuir.jpg'],
    variants: [
      [{ couleur: 'Cognac' }, 5],
      [{ couleur: 'Noir' }, 3],
    ],
  },
  {
    title: 'Sac week-end en toile',
    category: 'Sacs & paniers',
    price: 29000,
    description:
      'Sac de voyage en toile de coton bleu roi, finitions en cuir, bandoulière. Format cabine.',
    photos: ['sac-voyage.jpg'],
    variants: [[{ couleur: 'Bleu roi' }, 6]],
  },
  {
    title: 'Sandales fleuries en cuir',
    category: 'Chaussures',
    price: 15000,
    description:
      'Sandales en cuir naturel ornées de fleurs émaillées, boucle à la cheville. Fabriquées à Thiès.',
    photos: ['sandales-fleurs.jpg'],
    variants: sizes('pointure', ['37', '38', '39', '40', '41'], [3, 5, 6, 5, 3]),
  },
  {
    title: 'Sandales Thiès en cuir ajouré',
    category: 'Chaussures',
    price: 17000,
    description:
      'Mules en cuir ajouré et tressé, semelle cousue main. Le cuir se fait au pied après quelques jours.',
    photos: ['sandales-cuir.jpg'],
    variants: sizes('pointure', ['39', '40', '41', '42', '43', '44'], [3, 4, 6, 6, 5, 3]),
  },
  {
    title: 'Perles de verre recyclé',
    category: 'Bijoux',
    price: 8500,
    description:
      'Rang de grosses perles en verre recyclé, soufflées et peintes à la main. À porter en sautoir ou en ceinture.',
    photos: ['perles.jpg'],
    variants: [[{ couleur: 'Vert et cuivre' }, 15]],
  },
  {
    title: 'Collier plastron en céramique',
    category: 'Bijoux',
    price: 13000,
    description:
      'Plastron de disques en céramique émaillée blanc et bleu, montés sur cordon noir. Pièce faite main.',
    photos: ['collier.jpg'],
    variants: [[{ couleur: 'Blanc et bleu' }, 9]],
  },
  {
    title: 'Créoles Soleil en laiton doré',
    category: 'Bijoux',
    price: 11000,
    description:
      'Créoles en laiton martelé et doré, pendentif en cœur. Légères, faites par un artisan de Soumbédioune.',
    photos: ['creoles.jpg'],
    variants: [[{ couleur: 'Doré' }, 14]],
  },
  {
    title: 'Savons au karité',
    category: 'Maison & beauté',
    price: 3500,
    description:
      'Savon saponifié à froid au beurre de karité du Burkina et à l’huile de baobab. Pain de 120 g, sans parfum ajouté.',
    photos: ['savons.jpg'],
    variants: [
      [{ format: '1 pain' }, 40],
      [{ format: 'Lot de 3' }, 20],
    ],
  },
  {
    title: 'Bol en terre cuite',
    category: 'Maison & beauté',
    price: 7000,
    description:
      'Bol en terre cuite tourné et cuit à la main, intérieur lissé. Pour servir ou décorer, 18 cm.',
    photos: ['bol.jpg'],
    variants: [[{ format: '18 cm' }, 11]],
  },
];

const CUSTOMERS = [
  ['Aïssatou Diallo', '+221771234501'],
  ['Moussa Ndiaye', '+221772345602'],
  ['Fatou Sow', '+221763456703'],
  ['Mariama Ba', '+221704567804'],
  ['Cheikh Fall', '+221785678905'],
  ['Khady Diop', '+221776789006'],
  ['Ibrahima Sarr', '+221767890107'],
  ['Ndèye Gueye', '+221778901208'],
  ['Ousmane Faye', '+221709012309'],
  ['Coumba Mbaye', '+221770123410'],
  ['Abdoulaye Cissé', '+221761234511'],
  ['Rokhaya Seck', '+221772345612'],
  ['Awa Thiam', '+221783456713'],
  ['Pape Diouf', '+221774567814'],
  ['Binta Kane', '+221705678915'],
  ['Mamadou Touré', '+221766789016'],
] as const;

const ADDRESSES: Record<string, string[]> = {
  plateau: ['Rue Carnot x Félix Faure, imm. 12', 'Avenue Pompidou, en face de la BICIS'],
  'sacre-coeur': ['Sacré-Cœur 3, villa 9120', 'Mermoz, près de la pharmacie Mame Diarra'],
  almadies: ['Route des Almadies, résidence Les Filaos', 'Ngor Virage, villa 14'],
  parcelles: ['Unité 15, villa 233', 'Unité 9, près du marché'],
  pikine: ['Guédiawaye, cité Fadia, villa 80', 'Pikine Icotaf, rue 12'],
  rufisque: ['Rufisque, cité SIPRES, villa 41'],
};

// ------------------------------------------------------------------------------------------------- plumbing

class Session {
  cookie = '';
  async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(CORE + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        origin: ORIGIN,
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const set = res.headers.get('set-cookie');
    if (set?.startsWith('selly_session=')) this.cookie = set.split(';')[0] as string;
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    if (res.status >= 400)
      throw new Error(`${method} ${path}: HTTP ${res.status} ${text.slice(0, 300)}`);
    return json;
  }
}

/** Runs SQL in the local database (dev only). */
function sql(query: string) {
  // DEMO_DATABASE_URL: psql straight to the database (the demo service of docker-compose.yml); otherwise through the
  // database container.
  const url = process.env.DEMO_DATABASE_URL;
  const psql = ['-At', '-v', 'ON_ERROR_STOP=1'];
  return execFileSync(
    url ? 'psql' : 'docker',
    url
      ? [url, ...psql]
      : ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'selly', '-d', 'selly', ...psql],
    {
      input: query,
      encoding: 'utf8',
    },
  );
}
const lit = (s: string | null) => (s === null ? 'null' : `'${s.replaceAll("'", "''")}'`);

async function upload(v: Session, bytes: Buffer, type: string) {
  const up = await v.call('POST', '/api/v1/media/uploads', {
    content_type: type,
    size_bytes: bytes.length,
  });
  const put = await fetch(up.upload_url, { method: 'PUT', headers: up.headers, body: bytes });
  if (!put.ok) throw new Error(`upload: HTTP ${put.status}`);
  return up.storage_key as string;
}

async function photo(v: Session, file: string) {
  const path = new URL(file, PHOTOS);
  if (!existsSync(path)) {
    console.warn(`  no photo ${file}`);
    return null;
  }
  // Re-encoded at a sensible size: bank photos are often 6000 px wide.
  const bytes = await sharp(readFileSync(path))
    .rotate()
    .resize({ width: 1800, height: 1800, fit: 'inside' })
    .jpeg({ quality: 86 })
    .toBuffer();
  return upload(v, bytes, 'image/jpeg');
}

/** The shop's logo: an indigo disc, a cream S drawn as two arcs, a ring of terracotta dots like a wax print. */
function logoSvg() {
  const dots = Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2;
    const r = i % 2 ? 9 : 14;
    return `<circle cx="${256 + Math.cos(a) * 206}" cy="${256 + Math.sin(a) * 206}" r="${r}" fill="${BRAND.accent_color}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${BRAND.background_color}"/>
  <circle cx="256" cy="256" r="236" fill="${BRAND.primary_color}"/>
  ${dots}
  <circle cx="256" cy="256" r="168" fill="none" stroke="${BRAND.background_color}" stroke-opacity=".35" stroke-width="3"/>
  <path d="M 322 176 A 72 72 0 1 0 256 256 A 72 72 0 1 1 190 336" fill="none" stroke="${BRAND.background_color}" stroke-width="40" stroke-linecap="round"/>
  <circle cx="256" cy="256" r="10" fill="${BRAND.accent_color}"/>
</svg>`;
}

async function payInvoice(hash: string) {
  const r = await fetch(`${WALLET}/pay`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ref: hash }),
  });
  if (!r.ok) throw new Error(`pay: HTTP ${r.status} ${await r.text()}`);
}

// A seeded random, so two runs make the same shop.
let seed = 20261119;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)] as T;

// ------------------------------------------------------------------------------------------------- run

async function main() {
  const exists = await fetch(`${CORE}/api/v1/stores/${SLUG}`);
  if (exists.status !== 404) throw new Error(`The shop ${SLUG} exists already.`);
  await fetch(`${WALLET}/uris`).catch(() => {
    throw new Error('The fake wallets are not running: pnpm dev:testwallet');
  });

  // Sign in with the demo key, the one JUDGES.txt gives for signing in from the browser.
  const sk = nip19.decode(DEMO_NSEC).data as Uint8Array;
  const v = new Session();
  const c = await v.call('POST', '/api/v1/auth/nostr/challenges', { purpose: 'sign_in' });
  await v.call('POST', '/api/v1/auth/nostr/sessions', {
    challenge_id: c.challenge_id,
    event: finalizeEvent(c.event_template, sk),
    device_label: 'demo seed',
  });

  console.log('shop');
  const shop = await v.call('POST', '/api/v1/vendors', {
    display_name: 'Maison Sokhna',
    slug: SLUG,
    contact_whatsapp_e164: '+221776543210',
  });
  // Its own fake wallet: a wallet that already served another shop's free trial cannot start this one's.
  const { demo: walletUri } = await fetch(`${WALLET}/uris`).then((r) => r.json());
  if (!walletUri)
    throw new Error('Restart pnpm dev:testwallet: it now runs a wallet for the demo shop.');
  await v.call('PUT', '/api/v1/vendors/me/wallet', { kind: 'nwc', uri: walletUri });

  const logoKey = await upload(
    v,
    await sharp(Buffer.from(logoSvg())).png().toBuffer(),
    'image/png',
  );
  const bannerKey = await photo(v, BANNER.photo);
  await v.call('PATCH', '/api/v1/vendors/me', {
    settings: {
      delivery: {
        zones: ZONES.map((z) => ({
          id: z.id,
          label: z.label,
          fee: { amount: z.fee, currency: 'XOF' },
        })),
        pickup: { available: true, address_text: PICKUP },
      },
      hours: [
        { days: 'lun-ven', open: '09:30', close: '19:30' },
        { days: 'sam', open: '10:00', close: '18:00' },
      ],
      policies: {
        returns:
          'Échange ou retouche gratuite sous 7 jours, sur présentation de la commande. Les pièces sur mesure ne sont pas reprises.',
        payment: 'Paiement en bitcoin (Lightning), directement à l’atelier.',
      },
      agent: {
        enabled: true,
        tone: 'friendly',
        negotiation: { mode: 'allow', max_discount_pct: 10 },
      },
      branding: {
        ...BRAND,
        logo_key: logoKey,
        banner: { text: BANNER.text, href: null, image_key: bannerKey },
        hero: HERO,
      },
    },
  });

  console.log('catalogue');
  const categories: Record<string, string> = {};
  for (const name of new Set(PRODUCTS.map((p) => p.category)))
    categories[name] = (await v.call('POST', '/api/v1/vendors/me/categories', { name })).id;
  // Stock as it was before the orders below: they take their share of it.
  const variants: { id: string; price: number; productIdx: number }[] = [];
  for (const [i, p] of PRODUCTS.entries()) {
    const image_keys = (await Promise.all(p.photos.map((f) => photo(v, f)))).filter(
      (k): k is string => !!k,
    );
    const created = await v.call(
      'POST',
      '/api/v1/inventory',
      {
        title: p.title,
        description: p.description,
        category_id: categories[p.category],
        price: { amount: p.price, currency: 'XOF' },
        ...(image_keys.length ? { image_keys } : {}),
        variants: p.variants.map(([options, n]) => ({ options, on_hand: n + 8 })),
      },
      { 'idempotency-key': key('demo-product') },
    );
    for (const x of created.variants) variants.push({ id: x.id, price: p.price, productIdx: i });
    console.log(`  ${p.title}`);
  }

  console.log('orders');
  // Six weeks of sales, busier on weekends and growing towards today. Each order is really created and paid through
  // the fake wallet; its dates are moved back afterwards.
  const now = Date.now();
  const DAY = 86_400_000;
  type Made = {
    id: string;
    at: number;
    fate: 'fulfilled' | 'paid' | 'cancelled' | 'expired' | 'pending';
  };
  const made: Made[] = [];
  for (let d = 42; d >= 0; d--) {
    const day = new Date(now - d * DAY);
    const weekend = day.getDay() === 0 || day.getDay() === 6 || day.getDay() === 5;
    const count = Math.round((0.6 + (42 - d) / 30 + (weekend ? 1.2 : 0)) * (0.5 + rand()));
    for (let n = 0; n < count; n++) {
      const [name, phone] = pick(CUSTOMERS);
      const lines = new Map<string, number>();
      const items = 1 + (rand() < 0.35 ? 1 : 0) + (rand() < 0.1 ? 1 : 0);
      for (let k = 0; k < items; k++) {
        const x = pick(variants);
        lines.set(x.id, (lines.get(x.id) ?? 0) + (rand() < 0.15 ? 2 : 1));
      }
      const pickup = rand() < 0.2;
      const zone = pick(ZONES);
      const subtotal = [...lines].reduce(
        (s, [id, q]) => s + (variants.find((x) => x.id === id)?.price ?? 0) * q,
        0,
      );
      const total = subtotal + (pickup ? 0 : zone.fee);
      const at = day.getTime() - (d === 0 ? rand() * 6 : rand() * 10 + 2) * 3_600_000;
      const fate: Made['fate'] =
        d === 0 && rand() < 0.5
          ? 'pending'
          : d <= 2
            ? rand() < 0.75
              ? 'paid'
              : 'fulfilled'
            : rand() < 0.06
              ? 'cancelled'
              : rand() < 0.07
                ? 'expired'
                : 'fulfilled';
      try {
        const o = await fetch(`${CORE}/api/v1/orders`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': key('demo-order') },
          body: JSON.stringify({
            store_slug: SLUG,
            channel: 'web',
            customer: { display_name: name, phone_e164: phone },
            items: [...lines].map(([variant_id, quantity]) => ({ variant_id, quantity })),
            delivery: pickup
              ? { method: 'pickup' }
              : {
                  method: 'delivery',
                  zone_id: zone.id,
                  address_text: pick(ADDRESSES[zone.id] ?? ['Dakar']),
                },
            expected_total: { amount: total, currency: 'XOF' },
          }),
        }).then(async (r) => ({ status: r.status, body: await r.json() }));
        if (o.status !== 201) {
          console.warn(`  order refused: ${o.status} ${JSON.stringify(o.body).slice(0, 160)}`);
          continue;
        }
        const id = o.body.order.id as string;
        if (fate === 'paid' || fate === 'fulfilled') {
          await payInvoice(o.body.invoice.payment_hash);
          for (let t = 0; t < 40; t++) {
            const s = await v.call('GET', `/api/v1/orders/${id}`);
            if (s.status === 'paid') break;
            await sleep(250);
          }
        }
        if (fate === 'fulfilled')
          await v.call('PATCH', `/api/v1/orders/${id}/fulfill`, { note: 'Livrée' });
        if (fate === 'cancelled' || fate === 'expired')
          await v
            .call('POST', `/api/v1/orders/${id}/cancel`, {
              reason: fate === 'cancelled' ? 'Le client a changé d’avis.' : 'Paiement non reçu.',
            })
            .catch(() => null);
        made.push({ id, at, fate });
      } catch (err) {
        console.warn(`  order failed: ${(err as Error).message.slice(0, 160)}`);
      }
    }
    process.stdout.write(`  ${made.length} orders\r`);
  }
  console.log(`  ${made.length} orders`);

  // Back to their dates: created, paid a few minutes later, fulfilled the next day. The ones cancelled for want of
  // payment become expired (cancelling first gave their stock back); today's unpaid ones stay open for a day.
  const extra = (m: Made, created: string) =>
    m.fate === 'expired'
      ? `\nupdate core.orders set status = 'expired', cancel_reason = null, cancelled_at = null where id = ${lit(m.id)};
update core.invoices set status = 'expired' where order_id = ${lit(m.id)};`
      : m.fate === 'pending'
        ? `\nupdate core.orders set created_at = ${lit(created)}, expires_at = now() + interval '1 day' where id = ${lit(m.id)};
update core.invoices set created_at = ${lit(created)}, expires_at = now() + interval '1 day' where order_id = ${lit(m.id)};`
        : '';
  const backdate = made
    .map((m) => {
      const created = new Date(m.at).toISOString();
      const paid = new Date(m.at + (3 + rand() * 20) * 60_000).toISOString();
      const done = new Date(
        Math.min(now - 3_600_000, m.at + (18 + rand() * 30) * 3_600_000),
      ).toISOString();
      return `update core.orders set created_at = ${lit(created)}, updated_at = ${lit(m.fate === 'fulfilled' ? done : paid)},
  paid_at = case when paid_at is null then null else ${lit(paid)}::timestamptz end,
  fulfilled_at = case when fulfilled_at is null then null else ${lit(done)}::timestamptz end,
  cancelled_at = case when cancelled_at is null then null else ${lit(paid)}::timestamptz end,
  expires_at = ${lit(new Date(m.at + 30 * 60_000).toISOString())}
  where id = ${lit(m.id)} and status <> 'pending_payment';
update core.invoices set created_at = ${lit(created)},
  settled_at = case when settled_at is null then null else ${lit(paid)}::timestamptz end
  where order_id = ${lit(m.id)} and status <> 'pending';${extra(m, created)}`;
    })
    .join('\n');
  sql(backdate);

  console.log('discussions');
  // Customers who wrote to the shop: Selly answered most; two are waiting for the vendor.
  const store = await fetch(`${CORE}/api/v1/stores/${SLUG}`).then((r) => r.json());
  const card = (title: string) => {
    const p = store.products.find((x: { title: string }) => x.title === title);
    return p
      ? [
          {
            type: 'product',
            product_id: p.id,
            title: p.title,
            price: p.price,
            image_url: p.image?.url ?? null,
            url: `${ORIGIN}/s/${SLUG}/p/${p.slug}`,
          },
        ]
      : [];
  };
  type Msg = [
    author: 'customer' | 'agent' | 'vendor',
    text: string,
    minutes: number,
    cards?: unknown[],
  ];
  const chats: {
    who: string;
    mode: 'bot' | 'human';
    hoursAgo: number;
    read: boolean;
    msgs: Msg[];
  }[] = [
    {
      who: 'Khady Diop',
      mode: 'human',
      hoursAgo: 0.4,
      read: false,
      msgs: [
        ['customer', 'Bonjour, la robe Safran existe en vert ? C’est pour un baptême samedi.', 0],
        [
          'agent',
          'Bonjour Khady ! La robe Safran est en satin safran, en S, M et L. Pour une autre couleur, je demande à l’atelier.',
          1,
          card('Robe de cérémonie Safran'),
        ],
        ['customer', 'Oui demandez svp, et est-ce que je peux l’avoir avant samedi ?', 3],
        ['agent', 'Je transmets à Sokhna, elle vous répond ici même.', 3],
      ],
    },
    {
      who: 'Cheikh Fall',
      mode: 'human',
      hoursAgo: 2.5,
      read: false,
      msgs: [
        [
          'customer',
          'Salam, je voudrais 6 chemises Modou pour un mariage, vous faites un prix ?',
          0,
        ],
        [
          'agent',
          'Wa aleykum salam Cheikh ! Pour 6 chemises, je préviens l’atelier : c’est Sokhna qui fixe les prix de groupe.',
          1,
          card('Chemise Modou imprimée'),
        ],
      ],
    },
    {
      who: 'Mariama Ba',
      mode: 'bot',
      hoursAgo: 5,
      read: true,
      msgs: [
        ['customer', 'Vous livrez aux Almadies ?', 0],
        [
          'agent',
          'Oui, aux Almadies, à Ngor et à Yoff pour 1 500 FCFA, en 24 h. La livraison est offerte dès 30 000 FCFA d’achat.',
          1,
        ],
        ['customer', 'Parfait, et le sac Kumba existe en noir ?', 2],
        [
          'agent',
          'Oui, en cognac et en noir. Il en reste quelques-uns en noir.',
          2,
          card('Sac en cuir Kumba'),
        ],
        ['customer', 'Je la prends, merci !', 4],
      ],
    },
    {
      who: 'Pape Diouf',
      mode: 'bot',
      hoursAgo: 27,
      read: true,
      msgs: [
        ['customer', 'Je fais du 42, les sandales Thiès taillent comment ?', 0],
        [
          'agent',
          'Elles taillent normalement : prenez votre pointure habituelle, le 42. Le cuir se fait au pied après quelques jours.',
          1,
          card('Sandales Thiès en cuir ajouré'),
        ],
      ],
    },
    {
      who: 'Binta Kane',
      mode: 'human',
      hoursAgo: 50,
      read: true,
      msgs: [
        ['customer', 'Bonjour, ma robe Awa est un peu grande, je peux l’échanger ?', 0],
        [
          'agent',
          'Bien sûr : l’échange ou la retouche est gratuit sous 7 jours. Je préviens l’atelier.',
          1,
        ],
        [
          'vendor',
          'Bonjour Binta, passez à l’atelier quand vous voulez, on la reprend à votre taille en 30 minutes.',
          40,
        ],
        ['customer', 'Super, je passe demain matin. Merci Sokhna !', 55],
      ],
    },
    {
      who: 'Ousmane Faye',
      mode: 'bot',
      hoursAgo: 75,
      read: true,
      msgs: [
        ['customer', 'Le panier Bolga, il fait quelle taille ?', 0],
        [
          'agent',
          'Il existe en moyen (35 cm de diamètre) et en grand (45 cm). Le grand tient une semaine de linge ou le marché du samedi.',
          1,
          card('Panier Bolga'),
        ],
      ],
    },
  ];
  const conv = chats
    .map((ch) => {
      const start = now - ch.hoursAgo * 3_600_000;
      const last = start + Math.max(...ch.msgs.map((m) => m[2])) * 60_000;
      const lastIn =
        start + Math.max(...ch.msgs.filter((m) => m[0] === 'customer').map((m) => m[2])) * 60_000;
      const id = crypto.randomUUID();
      const label = (a: Msg[0]) =>
        a === 'customer'
          ? ch.who
          : a === 'agent'
            ? 'Assistant de Maison Sokhna'
            : 'Maison Sokhna (vendeur)';
      const msgs = ch.msgs
        .map(
          ([a, text, min, cards]) =>
            `insert into agent.messages (id, conversation_id, direction, author, author_label, kind, text, cards, quick_replies, image_keys, status, created_at)
  values (gen_random_uuid(), ${lit(id)}, ${lit(a === 'customer' ? 'in' : 'out')}, ${lit(a)}, ${lit(label(a))}, 'text', ${lit(text)},
  ${lit(JSON.stringify(cards ?? []))}::jsonb, '[]'::jsonb, '[]'::jsonb, 'processed', ${lit(new Date(start + min * 60_000).toISOString())});`,
        )
        .join('\n');
      return `insert into agent.conversations (id, vendor_id, channel, role, external_user_id, customer_label, mode, human_until, vendor_read_at, last_inbound_at, summary, state, created_at, updated_at)
  values (${lit(id)}, ${lit(shop.id)}, 'web', 'customer', ${lit(crypto.randomUUID())}, ${lit(ch.who)}, ${lit(ch.mode)},
  ${ch.mode === 'human' ? lit(new Date(now + 6 * 3_600_000).toISOString()) : 'null'},
  ${ch.read ? lit(new Date(last + 60_000).toISOString()) : 'null'}, ${lit(new Date(lastIn).toISOString())}, '', '{}'::jsonb,
  ${lit(new Date(start).toISOString())}, ${lit(new Date(last).toISOString())});
${msgs}`;
    })
    .join('\n');
  sql(conv);

  const tally = made.reduce<Record<string, number>>(
    (t, m) => ({ ...t, [m.fate]: (t[m.fate] ?? 0) + 1 }),
    {},
  );
  console.log(`done: ${ORIGIN}/s/${SLUG}`, tally);
  console.log('Sign in as the shop with the demo key: see JUDGES.txt at the repository root.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
