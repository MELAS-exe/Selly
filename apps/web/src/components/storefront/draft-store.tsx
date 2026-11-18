'use client';

// The Replit storefront draft ("vendor-storefront", Kër Awa), in Selly's design system: paper and grain, green ink,
// lime accents, hairlines, sharp corners, a serif for titles and prices, spaced uppercase labels, the S mark and the
// wordmark. Texts at 16 px or more and targets of 44 px (the storefront rules). Same demo data and behaviour as the
// 1:1 port (previous commit), so this diff is the design system only. Shown at /dev/storefront-draft.

import {
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  useId,
  useMemo,
  useState,
} from 'react';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  ChevronDown,
  CircleHelp,
  Clock3,
  Heart,
  MapPin,
  Menu,
  MessageCircle,
  Minus,
  PackageCheck,
  Plus,
  Search,
  Send,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Store,
  X,
} from './draft-icons';
import './draft.css';
import './storefront.css';

const PROMO_IMAGE = '/storefront/promo-bag.webp';

type Art = 'bag' | 'oil' | 'earrings' | 'fabric' | 'soap' | 'cushion' | 'pouch' | 'basket';

interface Product {
  id: number;
  name: string;
  category: string;
  price: number;
  stock: number;
  detail: string;
  color: string;
  art: Art;
  tag?: string;
  oldPrice?: number;
}

// Backgrounds retinted to the paper palette (the draft's pastels, softened towards #f6f4f0).
const PRODUCTS: Product[] = [
  {
    id: 1,
    name: 'Cabas Noppal',
    category: 'Accessoires',
    price: 12500,
    stock: 4,
    detail: 'Raphia tressé & wax • fait main à Dakar',
    color: '#e9e2cf',
    art: 'bag',
    tag: 'Prix doux',
    oldPrice: 15000,
  },
  {
    id: 2,
    name: 'Huile de baobab',
    category: 'Beauté',
    price: 6500,
    stock: 8,
    detail: '100 ml • pure, pressée à froid',
    color: '#efe3c6',
    art: 'oil',
    tag: 'Naturel',
  },
  {
    id: 3,
    name: 'Boucles Sutura',
    category: 'Accessoires',
    price: 8500,
    stock: 2,
    detail: 'Laiton doré • pièce artisanale',
    color: '#eddccd',
    art: 'earrings',
    tag: 'Dernières pièces',
  },
  {
    id: 4,
    name: 'Tissu wax — Niani',
    category: 'Textiles',
    price: 9000,
    stock: 11,
    detail: '6 yards • coton premium',
    color: '#dde6da',
    art: 'fabric',
  },
  {
    id: 5,
    name: 'Savon noir du Sénégal',
    category: 'Beauté',
    price: 3000,
    stock: 14,
    detail: '250 g • karité & cendres végétales',
    color: '#e7ddcb',
    art: 'soap',
  },
  {
    id: 6,
    name: 'Coussin Teranga',
    category: 'Maison',
    price: 18000,
    stock: 0,
    detail: 'Housse 45 × 45 cm • coton tissé',
    color: '#e8dbd1',
    art: 'cushion',
    tag: 'Rupture',
  },
  {
    id: 7,
    name: 'Pochette Thiès',
    category: 'Accessoires',
    price: 7500,
    stock: 6,
    detail: 'Coton tissé • doublure wax',
    color: '#e1e2cc',
    art: 'pouch',
  },
  {
    id: 8,
    name: 'Panier Kër',
    category: 'Maison',
    price: 22000,
    stock: 3,
    detail: 'Vannerie naturelle • format moyen',
    color: '#ebdfc4',
    art: 'basket',
  },
];

const CATEGORIES = ['Tout voir', 'Accessoires', 'Beauté', 'Textiles', 'Maison'];

const fcfa = (n: number) => `${new Intl.NumberFormat('fr-SN').format(n)} FCFA`;

/** The shop's mark: a sharp ink square with its initial, and the name in the serif. */
function Logo({ light = false }: { light?: boolean }) {
  return (
    <span className="flex items-center gap-3" aria-label="Kër Awa">
      <span
        className={`sf-serif grid size-11 place-items-center text-2xl font-semibold ${light ? 'bg-d-paper text-d-ink' : 'bg-d-ink text-d-paper'}`}
      >
        K
      </span>
      <span>
        <span className="sf-serif block text-[1.625rem] leading-none font-semibold">Kër Awa</span>
        <span
          className={`mt-1 block text-xs font-semibold tracking-[0.24em] ${light ? 'text-d-paper/70' : 'text-d-ink-soft'}`}
        >
          ATELIER · DAKAR
        </span>
      </span>
    </span>
  );
}

/** Text on a circle around the S mark, as on the landing page. */
function Stamp() {
  const id = useId();
  return (
    <div className="relative size-28" aria-hidden="true">
      <svg viewBox="0 0 120 120" className="pv-spin motion-loop size-full text-d-ink">
        <path id={id} d="M 60, 60 m -45, 0 a 45,45 0 1,1 90,0 a 45,45 0 1,1 -90,0" fill="none" />
        <text className="fill-current text-[10px] tracking-[0.3em] uppercase">
          <textPath href={`#${id}`}>Une touche de chez nous • Kër Awa • </textPath>
        </text>
      </svg>
      <img src="/brand/selly-s.png" alt="" className="absolute inset-0 m-auto w-9" />
    </div>
  );
}

function ProductArt({ product }: { product: Product }) {
  const art: Record<Art, ReactNode> = {
    bag: (
      <>
        <div className="art-bag-handle" />
        <div className="art-bag">
          <span className="art-wax" />
        </div>
      </>
    ),
    oil: (
      <>
        <div className="art-bottle">
          <i />
          <span />
        </div>
        <div className="art-shadow" />
      </>
    ),
    earrings: (
      <>
        <div className="earring earring-one">
          <i />
        </div>
        <div className="earring earring-two">
          <i />
        </div>
      </>
    ),
    fabric: (
      <>
        <div className="fabric-fold fabric-one" />
        <div className="fabric-fold fabric-two" />
        <div className="fabric-fold fabric-three" />
      </>
    ),
    soap: (
      <div className="soap-block">
        <span>ND</span>
      </div>
    ),
    cushion: (
      <div className="cushion">
        <span />
      </div>
    ),
    pouch: (
      <>
        <div className="pouch-zip" />
        <div className="pouch-shape">
          <i />
        </div>
      </>
    ),
    basket: (
      <>
        <div className="basket-handle" />
        <div className="basket-shape">
          <i />
        </div>
      </>
    ),
  };
  return (
    <div
      className={`product-art art-${product.art}`}
      style={{ background: product.color }}
      aria-label={`Illustration de ${product.name}`}
      role="img"
    >
      <span className="art-sun" />
      <span className="art-leaf leaf-a" />
      <span className="art-leaf leaf-b" />
      <div className="art-object">{art[product.art]}</div>
    </div>
  );
}

type Message = { from: 'selly' | 'you'; text: string };

function InfoCell({ icon, title, sub }: { icon: ReactNode; title: string; sub: string }) {
  return (
    <div className="flex items-center gap-4 border-d-hairline px-5 py-5 md:border-r md:last:border-r-0">
      <span className="grid size-11 shrink-0 place-items-center border border-d-hairline">
        {icon}
      </span>
      <div>
        <div className="font-semibold">{title}</div>
        <div className="text-[0.9375rem] text-d-ink-soft">{sub}</div>
      </div>
    </div>
  );
}

export function DraftStore() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('Tout voir');
  const [inStock, setInStock] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [chatProduct, setChatProduct] = useState<Product | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    {
      from: 'selly',
      text: 'Salam ! Je suis là pour vous aider à trouver votre bonheur chez Kër Awa.',
    },
  ]);
  const [draft, setDraft] = useState('');
  const [cart, setCart] = useState<Record<number, number>>({});
  const [toast, setToast] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [favorites, setFavorites] = useState<number[]>([]);

  const shown = useMemo(
    () =>
      PRODUCTS.filter((p) => {
        const q = query.trim().toLocaleLowerCase('fr');
        return (
          (!q || `${p.name} ${p.category} ${p.detail}`.toLocaleLowerCase('fr').includes(q)) &&
          (category === 'Tout voir' || p.category === category) &&
          (!inStock || p.stock > 0)
        );
      }),
    [query, category, inStock],
  );
  const count = Object.values(cart).reduce((a, b) => a + b, 0);
  const subtotal = PRODUCTS.reduce((a, p) => a + p.price * (cart[p.id] || 0), 0);

  const notify = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(''), 2600);
  };
  const add = (p: Product) => {
    if (p.stock) setCart((c) => ({ ...c, [p.id]: Math.min(p.stock, (c[p.id] || 0) + 1) }));
    notify(`${p.name} ajouté au panier`);
  };
  const openChat = (p?: Product) => {
    setChatProduct(p || null);
    setChatOpen(true);
    if (p)
      setMessages((m) => [
        ...m,
        {
          from: 'selly',
          text: `Vous regardez ${p.name}. Il en reste ${p.stock} en stock, au prix de ${fcfa(p.price)}. Que voulez-vous savoir ?`,
        },
      ]);
  };
  const send = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setMessages((m) => [...m, { from: 'you', text }]);
    const lower = text.toLocaleLowerCase('fr');
    const found = (chatProduct ? [chatProduct, ...PRODUCTS] : PRODUCTS).find(
      (p) =>
        lower.includes(p.name.toLocaleLowerCase('fr')) ||
        lower.includes(p.category.toLocaleLowerCase('fr')),
    );
    const reply = found
      ? found.stock
        ? `${found.name} est bien disponible : ${fcfa(found.price)}. ${found.detail}. Je peux vous aider sur la matière, la taille ou le stock.`
        : `Le ${found.name} est momentanément en rupture. Je peux vous proposer une autre pièce de la catégorie ${found.category.toLowerCase()}.`
      : /livr|adresse|où|dakar/.test(lower)
        ? 'La boutique est à Liberté 6 Extension, Dakar. Awa vous accueille du lundi au samedi, de 10 h à 19 h.'
        : /prix|combien|budget/.test(lower)
          ? `Les prix de la boutique vont de ${fcfa(3000)} à ${fcfa(22000)}. Dites-moi quel article vous intéresse et je vous donne les détails.`
          : 'Je peux vous renseigner sur les prix, les disponibilités et les matières de chaque article. Quel produit vous plaît ?';
    setDraft('');
    window.setTimeout(() => setMessages((m) => [...m, { from: 'selly', text: reply }]), 350);
  };
  const change = (p: Product, delta: number) =>
    setCart((c) => {
      const next = { ...c, [p.id]: Math.max(0, Math.min(p.stock, (c[p.id] || 0) + delta)) };
      if (!next[p.id]) delete next[p.id];
      return next;
    });
  const share = async () => {
    try {
      if (navigator.share)
        await navigator.share({
          title: 'Kër Awa — la boutique',
          text: 'Les belles choses de chez Awa, à Dakar.',
          url: window.location.href,
        });
      else if (navigator.clipboard) {
        await navigator.clipboard.writeText(window.location.href);
        notify('Lien de la boutique copié');
      } else notify('Partagez le lien de la boutique depuis votre navigateur');
    } catch {}
  };

  return (
    <main className="ker-draft sf min-h-dvh">
      <div className="bg-d-ink px-4 py-2.5 text-center text-[0.9375rem] text-d-paper">
        <span className="inline-flex items-center justify-center gap-2.5">
          <span className="size-1.5 bg-d-lime" /> Les trouvailles d’Awa, préparées avec soin à Dakar
          <span className="hidden sm:inline">· Livraison à Dakar disponible</span>
        </span>
      </div>

      <header className="sticky top-0 z-30 border-b border-d-hairline bg-d-paper/90 backdrop-blur-md">
        <div className="mx-auto flex h-20 max-w-[1260px] items-center justify-between gap-4 px-5 sm:px-8">
          <a href="#top" aria-label="Accueil Kër Awa">
            <Logo />
          </a>
          <nav className="hidden items-center gap-9 md:flex" aria-label="Navigation principale">
            <a
              className="min-h-11 content-center font-medium hover:underline hover:underline-offset-8"
              href="#catalogue"
            >
              La sélection
            </a>
            <a
              className="min-h-11 content-center font-medium hover:underline hover:underline-offset-8"
              href="#boutique"
            >
              La boutique
            </a>
            <button
              type="button"
              className="flex min-h-11 items-center gap-1.5 font-medium hover:underline hover:underline-offset-8"
              onClick={() => openChat()}
            >
              Parler à Selly <ArrowUpRight size={15} />
            </button>
          </nav>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="sf-btn sf-btn-ghost hidden !min-h-11 sm:inline-flex"
              onClick={share}
            >
              <ArrowUpRight size={15} /> Partager
            </button>
            <button
              type="button"
              className="sf-icon-btn relative"
              onClick={() => setCartOpen(true)}
              aria-label={`Ouvrir le panier, ${count} articles`}
            >
              <ShoppingBag size={19} strokeWidth={1.6} />
              {count > 0 && (
                <span className="tnum absolute -top-2 -right-2 grid h-5 min-w-5 place-items-center bg-d-lime px-1 text-xs font-bold text-d-ink">
                  {count}
                </span>
              )}
            </button>
            <button
              type="button"
              className="sf-icon-btn md:hidden"
              aria-label="Ouvrir le menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <Menu size={19} />
            </button>
          </div>
        </div>
        {menuOpen && (
          <div className="grid border-t border-d-hairline px-5 md:hidden">
            <a
              href="#catalogue"
              onClick={() => setMenuOpen(false)}
              className="min-h-12 content-center border-b border-d-hairline font-medium"
            >
              La sélection
            </a>
            <a
              href="#boutique"
              onClick={() => setMenuOpen(false)}
              className="min-h-12 content-center border-b border-d-hairline font-medium"
            >
              La boutique
            </a>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                openChat();
              }}
              className="flex min-h-12 items-center gap-2 text-left font-medium"
            >
              <MessageCircle size={17} /> Parler à Selly
            </button>
          </div>
        )}
      </header>

      <section
        id="top"
        className="mx-auto max-w-[1260px] border-x border-d-hairline px-5 pt-10 pb-14 sm:px-8 lg:pt-16 lg:pb-20"
      >
        <div className="grid items-center gap-10 lg:grid-cols-[1.02fr_.98fr] lg:gap-16">
          <div>
            <p className="sf-eyebrow sf-rise mb-7">Bienvenue chez Kër Awa</p>
            <h1 className="sf-serif text-[3.25rem] leading-[0.95] font-normal tracking-[-0.02em] sm:text-[4.5rem] lg:text-[5.5rem]">
              <span className="sf-line [--i:0]">Des belles choses,</span>
              <span className="sf-line italic text-d-lime-deep [--i:1]">tout près de vous.</span>
            </h1>
            <p className="sf-rise mt-6 max-w-[28rem] text-[1.0625rem] leading-relaxed text-d-ink-soft [--d:300ms]">
              Une sélection choisie avec cœur, entre artisanat sénégalais et petits essentiels du
              quotidien.
            </p>
            <div className="sf-rise mt-9 flex flex-wrap gap-3 [--d:400ms]">
              <a href="#catalogue" className="sf-btn sf-btn-primary">
                Voir la sélection <ArrowDownRight size={16} />
              </a>
              <button type="button" onClick={() => openChat()} className="sf-btn sf-btn-ghost">
                <Sparkles size={15} /> Demander à Selly
              </button>
            </div>
            <div className="sf-rise mt-10 flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.9375rem] text-d-ink-soft [--d:500ms]">
              <span className="flex items-center gap-2">
                <BadgeCheck size={16} className="text-d-lime-deep" /> Boutique vérifiée
              </span>
              <span className="size-1 bg-d-ink/30" />
              <span>Fait main, ici au Sénégal</span>
            </div>
          </div>

          <div className="sf-rise relative mx-auto w-full max-w-[570px] [--d:200ms] lg:max-w-none">
            <div
              aria-hidden="true"
              className="absolute inset-0 translate-x-3 translate-y-3 border border-d-hairline"
            />
            <div className="absolute top-8 -left-3 z-10 hidden border border-d-hairline bg-d-paper px-5 py-4 sm:block">
              <p className="flex items-center gap-2 text-xs font-semibold tracking-[0.2em] text-d-ink-soft uppercase">
                <span className="size-1.5 bg-d-lime" /> Préparé à Dakar
              </p>
              <p className="sf-serif mt-1 text-xl font-semibold">Le coup de cœur d’Awa</p>
            </div>
            <div className="relative aspect-[1.1/1] overflow-clip bg-d-paper-deep">
              <img
                src={PROMO_IMAGE}
                alt="Cabas en raphia et tissu wax, création artisanale"
                className="size-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-d-ink/25 via-transparent to-transparent" />
              <span className="absolute top-5 right-5 bg-d-ink px-3 py-2 text-xs font-semibold tracking-[0.2em] text-d-paper uppercase">
                La pièce du moment
              </span>
              <button
                type="button"
                onClick={() => openChat(PRODUCTS[0])}
                className="absolute right-4 bottom-4 left-4 flex items-center justify-between gap-4 border border-d-hairline bg-d-paper/95 p-4 text-left backdrop-blur-md sm:p-5"
              >
                <span>
                  <span className="sf-serif block text-2xl font-semibold">Cabas Noppal</span>
                  <span className="mt-0.5 block text-[0.9375rem] text-d-ink-soft">
                    Raphia tressé · fait main à Dakar
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-right">
                    <span className="sf-figure block text-2xl">{fcfa(12500)}</span>
                    <span className="text-[0.9375rem] text-d-ink-soft line-through">
                      {fcfa(15000)}
                    </span>
                  </span>
                  <span className="grid size-11 place-items-center bg-d-ink text-d-paper">
                    <MessageCircle size={18} />
                  </span>
                </span>
              </button>
            </div>
            <div className="absolute -right-6 -bottom-10 hidden bg-d-paper sm:block">
              <Stamp />
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-d-hairline bg-d-paper-deep/60">
        <div className="mx-auto grid max-w-[1260px] grid-cols-1 border-x border-d-hairline sm:grid-cols-2 md:grid-cols-4">
          <InfoCell icon={<Store size={18} />} title="Kër Awa" sub="Boutique indépendante" />
          <InfoCell icon={<MapPin size={18} />} title="Liberté 6 Extension" sub="Dakar, Sénégal" />
          <InfoCell
            icon={<Clock3 size={18} />}
            title="Lun – sam · 10 h – 19 h"
            sub="Horaires de la boutique"
          />
          <InfoCell
            icon={<PackageCheck size={18} />}
            title="Livraison à Dakar"
            sub="Frais confirmés avec Awa"
          />
        </div>
      </section>

      <section
        id="catalogue"
        className="mx-auto max-w-[1260px] border-x border-d-hairline px-5 pt-16 pb-24 sm:px-8 sm:pt-20"
      >
        <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
          <div>
            <p className="sf-eyebrow mb-4">Faits pour être aimés</p>
            <h2 className="sf-serif text-[2.75rem] leading-[1] tracking-[-0.01em] sm:text-[3.5rem]">
              La sélection d’Awa
            </h2>
            <p className="mt-3 text-d-ink-soft">
              Des trouvailles qui ont chacune leur petite histoire.
            </p>
          </div>
          <button
            type="button"
            onClick={() => openChat()}
            className="group sf-btn sf-btn-ghost w-fit"
          >
            <Sparkles size={15} /> Besoin d’un conseil ?{' '}
            <ArrowRight size={15} className="transition-transform group-hover:translate-x-1" />
          </button>
        </div>

        <div className="mt-10 flex flex-col gap-4 border-y border-d-hairline py-4 lg:flex-row lg:items-center lg:justify-between">
          <div
            className="-mx-5 flex gap-2 overflow-x-auto px-5 [scrollbar-width:none] lg:mx-0 lg:px-0"
            role="group"
            aria-label="Filtrer par catégorie"
          >
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                aria-pressed={category === c}
                className="sf-chip"
              >
                {c}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex min-h-11 min-w-[15rem] flex-1 items-center gap-3 border-b border-d-ink/30 focus-within:border-d-ink sm:flex-none">
              <Search size={17} className="text-d-ink-soft" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Un article, une envie…"
                className="w-full bg-transparent py-2 outline-none placeholder:text-d-ink-soft/70"
                aria-label="Rechercher dans la boutique"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Effacer la recherche"
                  className="grid size-9 place-items-center text-d-ink-soft"
                >
                  <X size={15} />
                </button>
              )}
            </label>
            <button
              type="button"
              onClick={() => setInStock((v) => !v)}
              aria-pressed={inStock}
              className="sf-chip"
            >
              <span className={`size-2 ${inStock ? 'bg-d-lime' : 'bg-d-ink/30'}`} /> En stock
              <ChevronDown size={14} className={inStock ? 'rotate-180' : ''} />
            </button>
          </div>
        </div>

        <div className="mt-5 mb-6 flex items-center justify-between gap-4">
          <p className="text-d-ink-soft" aria-live="polite">
            <span className="tnum font-semibold text-d-ink">{shown.length}</span>{' '}
            {shown.length > 1 ? 'trouvailles' : 'trouvaille'} · Prix en FCFA
          </p>
          <span className="hidden items-center gap-2 text-[0.9375rem] text-d-ink-soft sm:flex">
            <CircleHelp size={15} /> Touchez « Demander à Selly » pour en savoir plus
          </span>
        </div>

        {shown.length ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-6 lg:grid-cols-4">
            {shown.map((p, i) => (
              <article
                key={p.id}
                className="product-card group min-w-0 sf-rise"
                style={{ '--d': `${Math.min(i, 7) * 60}ms` } as CSSProperties}
              >
                <div className="card-media relative overflow-clip border border-d-hairline">
                  <ProductArt product={p} />
                  {p.tag && (
                    <span
                      className={`absolute top-3 left-3 px-2.5 py-1.5 text-xs font-semibold tracking-[0.16em] uppercase ${
                        p.stock === 0 ? 'bg-d-paper text-d-ink-soft' : 'bg-d-ink text-d-paper'
                      }`}
                    >
                      {p.tag}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      setFavorites((f) =>
                        f.includes(p.id) ? f.filter((x) => x !== p.id) : [...f, p.id],
                      )
                    }
                    aria-label={
                      favorites.includes(p.id) ? 'Retirer des favoris' : 'Ajouter aux favoris'
                    }
                    aria-pressed={favorites.includes(p.id)}
                    className="sf-icon-btn absolute top-2 right-2 !border-transparent !bg-d-paper/85"
                  >
                    <Heart size={17} fill={favorites.includes(p.id) ? 'currentColor' : 'none'} />
                  </button>
                  <div className="ask-action absolute right-3 bottom-3 left-3">
                    <button
                      type="button"
                      onClick={() => openChat(p)}
                      className="flex min-h-11 w-full items-center justify-center gap-2 bg-d-paper/95 px-2 font-medium backdrop-blur-sm"
                    >
                      <MessageCircle size={16} /> Demander à Selly
                    </button>
                  </div>
                  <span
                    className="sf-serif absolute bottom-3 left-3 hidden text-d-ink/40 sm:block"
                    aria-hidden="true"
                  >
                    {String(p.id).padStart(2, '0')}
                  </span>
                </div>
                <div className="pt-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="sf-serif text-xl leading-tight font-semibold sm:text-[1.375rem]">
                      {p.name}
                    </h3>
                    <span className="mt-1 shrink-0 text-sm text-d-ink-soft">
                      {p.stock ? `${p.stock} dispo` : 'Épuisé'}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[0.9375rem] leading-snug text-d-ink-soft">{p.detail}</p>
                  <div className="mt-4 flex items-end justify-between gap-2">
                    <div>
                      <span className="sf-figure block text-[1.375rem] leading-none">
                        {fcfa(p.price)}
                      </span>
                      {p.oldPrice && (
                        <span className="text-[0.9375rem] text-d-ink-soft line-through">
                          {fcfa(p.oldPrice)}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={!p.stock}
                      onClick={() => add(p)}
                      className="sf-icon-btn shrink-0 disabled:opacity-35"
                      aria-label={`Ajouter ${p.name} au panier`}
                    >
                      <Plus size={18} />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="flex min-h-72 flex-col items-center justify-center border border-dashed border-d-ink/25 px-5 text-center">
            <img
              src="/brand/selly-mascot.webp"
              alt=""
              width={800}
              height={800}
              className="size-24 object-contain"
            />
            <h3 className="sf-serif mt-4 text-2xl">Rien dans les rayons pour cette recherche</h3>
            <p className="mt-1.5 max-w-sm text-d-ink-soft">
              Essayez un autre mot ou parcourez toute la sélection d’Awa.
            </p>
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setCategory('Tout voir');
                setInStock(false);
              }}
              className="sf-btn sf-btn-primary mt-5"
            >
              Tout afficher
            </button>
          </div>
        )}
      </section>

      <section id="boutique" className="bg-d-ink text-d-paper">
        <div className="mx-auto grid max-w-[1260px] gap-10 px-5 py-16 sm:px-8 sm:py-20 md:grid-cols-[1.1fr_.9fr] md:items-center">
          <div>
            <p className="sf-eyebrow !text-d-lime">
              <MapPin size={14} /> Notre coin de Dakar
            </p>
            <h2 className="sf-serif mt-5 text-[2.5rem] leading-[1.02] sm:text-[3.25rem]">
              Une boutique de quartier,
              <br />
              <span className="italic text-d-lime">toujours à portée de main.</span>
            </h2>
            <p className="mt-5 max-w-[30rem] leading-relaxed text-d-paper/80">
              Awa déniche et confectionne des pièces qui racontent un peu la maison. Passez nous
              voir, ou écrivez à Selly pour un conseil.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => openChat()}
                className="sf-btn sf-btn-primary !border-d-lime !bg-d-lime !text-d-ink"
              >
                <MessageCircle size={15} /> Demander son chemin
              </button>
              <button
                type="button"
                onClick={share}
                className="sf-btn sf-btn-ghost !border-d-paper/40 !text-d-paper"
              >
                <ArrowUpRight size={15} /> Partager la boutique
              </button>
            </div>
          </div>
          <div className="relative overflow-clip border border-d-paper/20 p-6 sm:p-8">
            <div
              aria-hidden="true"
              className="absolute -top-16 -right-10 size-48 rounded-full border border-d-paper/10"
            />
            <div
              aria-hidden="true"
              className="absolute -top-9 -right-3 size-32 rounded-full border border-d-paper/10"
            />
            <div className="relative flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold tracking-[0.2em] text-d-lime uppercase">
                  Kër Awa · Liberté 6 Extension
                </p>
                <p className="sf-serif mt-3 text-2xl leading-snug">
                  Villa 18, derrière la pharmacie
                  <br />
                  Liberté 6, Dakar
                </p>
              </div>
              <span className="grid size-11 shrink-0 place-items-center bg-d-paper text-d-ink">
                <MapPin size={20} />
              </span>
            </div>
            <div className="relative mt-6 flex flex-wrap gap-x-10 gap-y-3 border-t border-d-paper/15 pt-5">
              <div>
                <div className="text-xs tracking-[0.2em] text-d-paper/70 uppercase">Latitude</div>
                <div className="tnum mt-1 font-mono">14.7246° N</div>
              </div>
              <div>
                <div className="text-xs tracking-[0.2em] text-d-paper/70 uppercase">Longitude</div>
                <div className="tnum mt-1 font-mono">17.4678° W</div>
              </div>
              <a
                href="https://maps.google.com/?q=14.7246,-17.4678"
                target="_blank"
                rel="noreferrer"
                className="ml-auto flex min-h-11 items-center gap-1.5 self-end font-semibold text-d-lime hover:underline"
              >
                Voir sur la carte <ArrowUpRight size={15} />
              </a>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-d-hairline">
        <div className="mx-auto flex max-w-[1260px] flex-col gap-5 border-x border-d-hairline px-5 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <Logo />
          <p className="text-[0.9375rem] text-d-ink-soft">
            Une vitrine de démonstration — panier indicatif, aucune commande ni paiement n’est
            effectué.
          </p>
          <span className="flex items-center gap-2 text-[0.9375rem] text-d-ink-soft">
            Une boutique portée par{' '}
            <img src="/brand/selly-wordmark.png" alt="Selly" className="h-5 w-auto" />
          </span>
        </div>
      </footer>

      <button
        type="button"
        onClick={() => openChat()}
        aria-label="Ouvrir Selly, votre conseillère de boutique"
        className="ask-float press fixed right-4 bottom-4 z-40 flex min-h-14 items-center gap-3 bg-d-ink px-4 text-d-paper sm:right-8 sm:bottom-7 sm:px-5"
      >
        <img src="/brand/selly-s-light.png" alt="" className="w-6" />
        <span className="hidden text-left sm:block">
          <span className="block font-semibold">Parler à Selly</span>
          <span className="block text-sm text-d-paper/75">Votre conseillère de boutique</span>
        </span>
      </button>

      {toast && (
        <div
          role="status"
          className="d-arrive fixed bottom-24 left-1/2 z-[80] -translate-x-1/2 bg-d-ink px-5 py-3 font-medium text-d-paper"
        >
          {toast}
        </div>
      )}

      {chatOpen && (
        <div
          className="sf-backdrop fixed inset-0 z-[60] flex items-end justify-center bg-d-ink/35 sm:items-center sm:p-5"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setChatOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Discussion démo avec Selly"
            className="sf-sheet flex max-h-[88dvh] w-full max-w-[440px] flex-col overflow-clip border border-d-hairline bg-d-paper"
          >
            <header className="flex items-center justify-between bg-d-ink px-5 py-4 text-d-paper">
              <div className="flex items-center gap-3">
                <span className="grid size-11 place-items-center bg-d-lime">
                  <img src="/brand/selly-s.png" alt="" className="w-6" />
                </span>
                <div>
                  <h2 className="sf-serif text-xl">Selly, la conseillère d’Awa</h2>
                  <p className="text-sm text-d-paper/70">Réponses démo · catalogue local</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setChatOpen(false)}
                aria-label="Fermer la discussion"
                className="grid size-11 place-items-center hover:bg-d-paper/10"
              >
                <X size={19} />
              </button>
            </header>
            <div
              className="flex min-h-64 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 sm:px-5"
              aria-live="polite"
            >
              <p className="border-l-2 border-d-pending bg-d-pending-soft px-3 py-2 text-[0.9375rem] text-d-pending">
                Ceci est une démonstration locale. Selly ne contacte pas une IA en direct et ne
                passe aucune commande.
              </p>
              {messages.map((m, i) => (
                <div
                  key={`${i}-${m.from}`}
                  className={`max-w-[87%] px-4 py-3 leading-relaxed ${m.from === 'you' ? 'self-end bg-d-ink text-d-paper' : 'self-start border border-d-hairline bg-d-paper-deep/50'}`}
                >
                  {m.text}
                </div>
              ))}
              <div className="mt-1 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setDraft('Qu’est-ce qui est disponible ?')}
                  className="sf-chip"
                >
                  Qu’est-ce qui est dispo ?
                </button>
                <button
                  type="button"
                  onClick={() => setDraft('Quels sont les prix ?')}
                  className="sf-chip"
                >
                  Voir les prix
                </button>
              </div>
            </div>
            <form
              onSubmit={send}
              className="flex items-center gap-2 border-t border-d-hairline p-4"
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Écrivez votre question…"
                className="min-h-11 min-w-0 flex-1 border border-d-hairline bg-d-paper px-4 outline-none placeholder:text-d-ink-soft/70 focus:border-d-ink"
                aria-label="Votre message"
              />
              <button
                type="submit"
                disabled={!draft.trim()}
                aria-label="Envoyer le message"
                className="grid size-11 shrink-0 place-items-center bg-d-ink text-d-paper disabled:opacity-40"
              >
                <Send size={17} />
              </button>
            </form>
          </section>
        </div>
      )}

      {cartOpen && (
        <div
          className="sf-backdrop fixed inset-0 z-[70] flex justify-end bg-d-ink/35"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setCartOpen(false);
          }}
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Votre panier de démonstration"
            className="sf-drawer flex h-full w-full max-w-[440px] flex-col border-l border-d-hairline bg-d-paper"
          >
            <header className="flex items-center justify-between border-b border-d-hairline px-5 py-5">
              <div>
                <p className="sf-eyebrow">Votre sélection</p>
                <h2 className="sf-serif mt-1 text-3xl">
                  Le panier <span className="tnum text-xl text-d-ink-soft">({count})</span>
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setCartOpen(false)}
                aria-label="Fermer le panier"
                className="sf-icon-btn"
              >
                <X size={19} />
              </button>
            </header>
            {count === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center px-7 text-center">
                <img
                  src="/brand/selly-mascot.webp"
                  alt=""
                  width={800}
                  height={800}
                  className="size-28 object-contain"
                />
                <h3 className="sf-serif mt-5 text-2xl">Votre panier est tout neuf</h3>
                <p className="mt-2 max-w-64 text-d-ink-soft">
                  Ajoutez une trouvaille de la sélection d’Awa pour la garder sous la main.
                </p>
                <button
                  type="button"
                  onClick={() => setCartOpen(false)}
                  className="sf-btn sf-btn-primary mt-6"
                >
                  Continuer la visite
                </button>
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto px-5">
                  {PRODUCTS.filter((p) => cart[p.id]).map((p) => (
                    <div key={p.id} className="flex gap-4 border-b border-d-hairline py-4">
                      <div className="size-20 shrink-0 overflow-clip border border-d-hairline">
                        <ProductArt product={p} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="sf-serif text-xl font-semibold">{p.name}</div>
                        <div className="sf-figure text-lg">{fcfa(p.price)}</div>
                        <div className="mt-2 flex items-center border border-d-hairline w-fit">
                          <button
                            type="button"
                            aria-label={`Retirer une unité de ${p.name}`}
                            onClick={() => change(p, -1)}
                            className="grid size-11 place-items-center"
                          >
                            <Minus size={15} />
                          </button>
                          <span className="tnum w-8 text-center font-semibold">{cart[p.id]}</span>
                          <button
                            type="button"
                            aria-label={`Ajouter une unité de ${p.name}`}
                            onClick={() => change(p, 1)}
                            className="grid size-11 place-items-center disabled:opacity-35"
                            disabled={(cart[p.id] ?? 0) >= p.stock}
                          >
                            <Plus size={15} />
                          </button>
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label={`Retirer ${p.name} du panier`}
                        onClick={() => change(p, -(cart[p.id] ?? 0))}
                        className="grid size-11 place-items-center self-start text-d-ink-soft hover:text-d-alert"
                      >
                        <X size={17} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="border-t border-d-hairline p-5">
                  <div className="flex items-baseline justify-between">
                    <span className="text-d-ink-soft">Sous-total indicatif</span>
                    <span className="sf-figure text-3xl">{fcfa(subtotal)}</span>
                  </div>
                  <p className="mt-3 border-l-2 border-d-pending bg-d-pending-soft px-3 py-2 text-[0.9375rem] text-d-pending">
                    Démo uniquement : aucune commande n’est envoyée et aucun paiement n’est
                    encaissé.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setCartOpen(false);
                      openChat();
                    }}
                    className="sf-btn sf-btn-primary mt-4 w-full"
                  >
                    Poser une question à Selly <MessageCircle size={16} />
                  </button>
                </div>
              </>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
