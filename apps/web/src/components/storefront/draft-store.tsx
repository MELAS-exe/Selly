'use client';

// The Replit storefront draft ("vendor-storefront", Kër Awa), ported 1:1 from its production bundle: same markup,
// texts, demo data, classes and behaviour (local demo chat, demo cart, favourites, search and filters), so the next
// commits show exactly what the design system and core change. Shown at /dev/storefront-draft only.

import { type FormEvent, type ReactNode, useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  ChevronDown,
  CircleHelp,
  Clock3,
  Flower2,
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

const PRODUCTS: Product[] = [
  {
    id: 1,
    name: 'Cabas Noppal',
    category: 'Accessoires',
    price: 12500,
    stock: 4,
    detail: 'Raphia tressé & wax • fait main à Dakar',
    color: '#e5d9be',
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
    color: '#f1d7aa',
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
    color: '#e6b99d',
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
    color: '#c7d8cb',
    art: 'fabric',
  },
  {
    id: 5,
    name: 'Savon noir du Sénégal',
    category: 'Beauté',
    price: 3000,
    stock: 14,
    detail: '250 g • karité & cendres végétales',
    color: '#ddc7a8',
    art: 'soap',
  },
  {
    id: 6,
    name: 'Coussin Teranga',
    category: 'Maison',
    price: 18000,
    stock: 0,
    detail: 'Housse 45 × 45 cm • coton tissé',
    color: '#d7b7a5',
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
    color: '#c4c6a1',
    art: 'pouch',
  },
  {
    id: 8,
    name: 'Panier Kër',
    category: 'Maison',
    price: 22000,
    stock: 3,
    detail: 'Vannerie naturelle • format moyen',
    color: '#dfc99e',
    art: 'basket',
  },
];

const CATEGORIES = ['Tout voir', 'Accessoires', 'Beauté', 'Textiles', 'Maison'];

const fcfa = (n: number) => `${new Intl.NumberFormat('fr-SN').format(n)} FCFA`;

function Logo() {
  return (
    <div className="flex items-center gap-2.5" aria-label="Kër Awa">
      <span className="grid h-10 w-10 place-items-center rounded-[14px] bg-[#1f5b43] text-[#f8f2e6] shadow-sm">
        <Flower2 size={20} strokeWidth={1.8} />
      </span>
      <span>
        <span className="display block text-[21px] font-extrabold leading-none tracking-[-1px] text-[#1c4335]">
          Kër Awa
        </span>
        <span className="mono mt-1 block text-[8px] font-bold tracking-[.12em] text-[#788579]">
          ATELIER · DAKAR
        </span>
      </span>
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
      <span className="art-index mono">0{product.id}</span>
    </div>
  );
}

type Message = { from: 'selly' | 'you'; text: string };

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
    <main className="ker-draft grain min-h-[100dvh] bg-[#f6f3eb] text-[#21382f]">
      <div className="border-b border-[#255b4433] bg-[#204d3b] px-4 py-2.5 text-center text-[11px] font-semibold tracking-[.07em] text-[#f7f0dd] sm:text-xs">
        <span className="inline-flex items-center justify-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-[#e7a275]" /> Les trouvailles d’Awa,
          préparées avec soin à Dakar{' '}
          <span className="hidden sm:inline">· Livraison à Dakar disponible</span>
        </span>
      </div>

      <header className="sticky top-0 z-30 border-b border-[#2548381b] bg-[#f6f3eb]/95 backdrop-blur-md">
        <div className="mx-auto flex h-[76px] max-w-[1260px] items-center justify-between px-5 sm:px-8">
          <a href="#top" className="rounded-lg" aria-label="Accueil Kër Awa">
            <Logo />
          </a>
          <nav className="hidden items-center gap-8 md:flex" aria-label="Navigation principale">
            <a className="nav-link" href="#catalogue">
              La sélection
            </a>
            <a className="nav-link" href="#boutique">
              La boutique
            </a>
            <button
              type="button"
              className="nav-link flex items-center gap-1.5"
              onClick={() => openChat()}
            >
              Parler à Selly <ArrowUpRight size={14} />
            </button>
          </nav>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              className="hidden h-11 items-center gap-2 rounded-full border border-[#214c3a]/15 px-4 text-xs font-semibold text-[#345749] transition hover:bg-white sm:flex"
              onClick={share}
            >
              <ArrowUpRight size={15} /> Partager la boutique
            </button>
            <button
              type="button"
              className="relative grid h-11 w-11 place-items-center rounded-full bg-[#e8e3d7] text-[#214c3a] transition hover:bg-[#ddd6c8]"
              onClick={() => setCartOpen(true)}
              aria-label={`Ouvrir le panier, ${count} articles`}
            >
              <ShoppingBag size={19} strokeWidth={1.8} />
              {count > 0 && (
                <span className="absolute -right-1 -top-1 grid h-[19px] min-w-[19px] place-items-center rounded-full bg-[#e47a56] px-1 text-[10px] font-bold text-white">
                  {count}
                </span>
              )}
            </button>
            <button
              type="button"
              className="grid h-11 w-11 place-items-center rounded-full border border-[#214c3a]/15 md:hidden"
              aria-label="Ouvrir le menu"
              onClick={() => setMenuOpen((o) => !o)}
            >
              <Menu size={19} />
            </button>
          </div>
        </div>
        {menuOpen && (
          <div className="grid gap-1 border-t border-[#214c3a]/10 px-5 py-3 md:hidden">
            <a
              href="#catalogue"
              onClick={() => setMenuOpen(false)}
              className="rounded-xl px-3 py-3 text-sm font-semibold"
            >
              La sélection
            </a>
            <a
              href="#boutique"
              onClick={() => setMenuOpen(false)}
              className="rounded-xl px-3 py-3 text-sm font-semibold"
            >
              La boutique
            </a>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                openChat();
              }}
              className="flex items-center gap-2 rounded-xl px-3 py-3 text-left text-sm font-semibold"
            >
              <MessageCircle size={16} /> Parler à Selly
            </button>
          </div>
        )}
      </header>

      <section
        id="top"
        className="mx-auto max-w-[1260px] px-5 pb-10 pt-8 sm:px-8 sm:pt-12 lg:pb-[68px] lg:pt-[62px]"
      >
        <div className="grid items-center gap-8 lg:grid-cols-[1.02fr_.98fr] lg:gap-[72px]">
          <div className="rise">
            <div className="mb-6 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.16em] text-[#627b6c]">
              <span className="h-px w-7 bg-[#e47a56]" /> Bienvenue chez Kër Awa
            </div>
            <h1 className="display max-w-[570px] text-[43px] font-bold leading-[1.07] tracking-[-2.1px] text-[#214b39] sm:text-[58px] lg:text-[66px]">
              Des belles choses,
              <br />
              <span className="text-[#dd7956]">tout près de vous.</span>
            </h1>
            <p className="mt-5 max-w-[440px] text-[15px] leading-[1.85] text-[#64736b] sm:text-[16px]">
              Une sélection choisie avec cœur, entre artisanat sénégalais et petits essentiels du
              quotidien.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href="#catalogue"
                className="inline-flex min-h-12 items-center gap-3 rounded-full bg-[#22583f] px-6 text-[13px] font-bold text-[#fff9ee] transition hover:bg-[#164632]"
              >
                Voir la sélection <ArrowDownRight size={16} />
              </a>
              <button
                type="button"
                onClick={() => openChat()}
                className="inline-flex min-h-12 items-center gap-2.5 rounded-full border border-[#22583f]/20 bg-[#fbf9f3] px-5 text-[13px] font-bold text-[#28513f] transition hover:bg-[#eae8dc]"
              >
                <span className="grid h-6 w-6 place-items-center rounded-full bg-[#e7ede3]">
                  <Sparkles size={14} />
                </span>{' '}
                Demander à Selly
              </button>
            </div>
            <div className="mt-9 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] font-medium text-[#718077]">
              <span className="flex items-center gap-1.5">
                <BadgeCheck size={14} className="text-[#43805e]" /> Boutique vérifiée
              </span>
              <span className="h-1 w-1 rounded-full bg-[#c8bfae]" />
              <span>Fait main, ici au Sénégal</span>
            </div>
          </div>

          <div className="rise-delay relative mx-auto w-full max-w-[570px] lg:max-w-none">
            <div className="absolute -left-4 top-10 z-10 hidden rounded-[18px] border border-[#234a3720] bg-[#fbf9f2] px-4 py-3.5 shadow-[0_12px_35px_rgba(34,60,43,.10)] sm:block">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.12em] text-[#718077]">
                <span className="h-2 w-2 rounded-full bg-[#68a078]" /> Préparé à Dakar
              </div>
              <div className="mt-1.5 text-sm font-bold text-[#284c3c]">Le coup de cœur d’Awa</div>
            </div>
            <div className="relative aspect-[1.1/1] overflow-hidden rounded-[28px] bg-[#e8dcc5] sm:rounded-[34px]">
              <img
                src={PROMO_IMAGE}
                alt="Cabas en raphia et tissu wax, création artisanale"
                className="h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#1d36292a] via-transparent to-transparent" />
              <span className="absolute right-5 top-5 rounded-full bg-[#f7f0df] px-3.5 py-2 text-[10px] font-bold uppercase tracking-[.12em] text-[#375641] sm:right-7 sm:top-7">
                La pièce du moment
              </span>
              <button
                type="button"
                onClick={() => openChat(PRODUCTS[0])}
                className="absolute bottom-4 left-4 right-4 flex items-center justify-between rounded-[20px] border border-white/50 bg-[#fbf8f0]/95 p-4 text-left backdrop-blur-md transition hover:bg-white sm:bottom-5 sm:left-5 sm:right-5 sm:p-5"
              >
                <span>
                  <span className="block text-[15px] font-bold text-[#214b39] sm:text-[17px]">
                    Cabas Noppal
                  </span>
                  <span className="mt-1 block text-[11px] text-[#768078]">
                    Raphia tressé · fait main à Dakar
                  </span>
                </span>
                <span className="flex items-center gap-2.5">
                  <span className="text-right">
                    <span className="block text-[14px] font-bold text-[#214b39]">
                      {fcfa(12500)}
                    </span>
                    <span className="text-[10px] text-[#8a8e83] line-through">{fcfa(15000)}</span>
                  </span>
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-[#e47a56] text-white">
                    <MessageCircle size={17} />
                  </span>
                </span>
              </button>
            </div>
            <div className="absolute -bottom-4 -right-2 hidden h-[76px] w-[76px] flex-col items-center justify-center rounded-full border-[1px] border-[#c8815e] bg-[#f6f3eb] text-center text-[9px] font-bold uppercase leading-[1.35] tracking-[.1em] text-[#a55d40] sm:flex">
              <span>
                Une touche
                <br />
                de chez nous
              </span>
              <Flower2 size={15} className="mt-0.5" />
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-[#244e3a]/10 bg-[#ebe9dc]">
        <div className="mx-auto grid max-w-[1260px] grid-cols-2 gap-y-5 px-5 py-5 sm:px-8 md:grid-cols-4 md:py-6">
          <div className="flex items-center gap-3 md:border-r md:border-[#244e3a]/15">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-[#dce5d8] text-[#35694d]">
              <Store size={17} />
            </span>
            <div>
              <div className="text-xs font-bold">Kër Awa</div>
              <div className="mt-0.5 text-[10px] text-[#727d72]">Boutique indépendante</div>
            </div>
          </div>
          <div className="flex items-center gap-3 md:pl-7 md:border-r md:border-[#244e3a]/15">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-[#f0ddd1] text-[#b36549]">
              <MapPin size={17} />
            </span>
            <div>
              <div className="text-xs font-bold">Liberté 6 Extension</div>
              <div className="mt-0.5 text-[10px] text-[#727d72]">Dakar, Sénégal</div>
            </div>
          </div>
          <div className="flex items-center gap-3 md:pl-7 md:border-r md:border-[#244e3a]/15">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-[#e8debf] text-[#8e713f]">
              <Clock3 size={17} />
            </span>
            <div>
              <div className="text-xs font-bold">Lun – sam · 10 h – 19 h</div>
              <div className="mt-0.5 text-[10px] text-[#727d72]">Horaires de la boutique</div>
            </div>
          </div>
          <div className="flex items-center gap-3 md:pl-7">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-[#dce6dc] text-[#35694d]">
              <PackageCheck size={17} />
            </span>
            <div>
              <div className="text-xs font-bold">Livraison à Dakar</div>
              <div className="mt-0.5 text-[10px] text-[#727d72]">Frais confirmés avec Awa</div>
            </div>
          </div>
        </div>
      </section>

      <section
        id="catalogue"
        className="mx-auto max-w-[1260px] px-5 pb-20 pt-14 sm:px-8 sm:pt-[76px]"
      >
        <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
          <div>
            <div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.16em] text-[#cc7657]">
              <span className="h-px w-6 bg-[#cc7657]" /> Faits pour être aimés
            </div>
            <h2 className="display text-[34px] font-bold leading-tight tracking-[-1.3px] text-[#214b39] sm:text-[42px]">
              La sélection d’Awa
            </h2>
            <p className="mt-2 text-sm text-[#788078]">
              Des trouvailles qui ont chacune leur petite histoire.
            </p>
          </div>
          <button
            type="button"
            onClick={() => openChat()}
            className="group flex w-fit items-center gap-2.5 rounded-full border border-[#214b3a]/15 bg-[#fbf9f2] px-4 py-2.5 text-xs font-bold text-[#28513f] transition hover:border-[#214b3a]/30 hover:bg-white"
          >
            <span className="grid h-7 w-7 place-items-center rounded-full bg-[#e4ebdf] text-[#326448]">
              <Sparkles size={14} />
            </span>{' '}
            Besoin d’un conseil ?{' '}
            <ArrowRight size={14} className="transition-transform group-hover:translate-x-1" />
          </button>
        </div>

        <div className="mt-8 flex flex-col gap-4 border-y border-[#264d3b]/10 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div
            className="scrollbar-hide flex gap-2 overflow-x-auto pb-1 lg:pb-0"
            role="group"
            aria-label="Filtrer par catégorie"
          >
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                aria-pressed={category === c}
                className={`shrink-0 rounded-full px-4 py-2.5 text-[11px] font-semibold transition ${
                  category === c
                    ? 'bg-[#245a40] text-[#fff9ee]'
                    : 'bg-[#ebe9df] text-[#5e7065] hover:bg-[#e2dfd2]'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="relative flex h-10 min-w-[210px] flex-1 items-center gap-2.5 rounded-full border border-[#244e3a]/15 bg-[#fbf9f2] px-3.5 sm:min-w-[245px] sm:flex-none">
              <Search size={15} className="text-[#7e8a80]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Un article, une envie…"
                className="w-full bg-transparent text-xs text-[#254b3a] outline-none placeholder:text-[#98a096]"
                aria-label="Rechercher dans la boutique"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Effacer la recherche"
                  className="text-[#768278]"
                >
                  <X size={14} />
                </button>
              )}
            </label>
            <button
              type="button"
              onClick={() => setInStock((v) => !v)}
              aria-pressed={inStock}
              className={`flex h-10 items-center gap-2 rounded-full border px-3.5 text-[11px] font-semibold transition ${
                inStock
                  ? 'border-[#28563e] bg-[#e5eddf] text-[#28563e]'
                  : 'border-[#244e3a]/15 bg-[#fbf9f2] text-[#65746a]'
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${inStock ? 'bg-[#548c62]' : 'bg-[#a9afa6]'}`}
              />{' '}
              En stock <ChevronDown size={13} className={inStock ? 'rotate-180' : ''} />
            </button>
          </div>
        </div>

        <div className="mb-4 mt-5 flex items-center justify-between">
          <p className="text-[11px] text-[#778078]" aria-live="polite">
            {shown.length} {shown.length > 1 ? 'trouvailles' : 'trouvaille'}{' '}
            <span className="mx-1 text-[#c1bcae]">·</span> Prix en FCFA
          </p>
          <span className="hidden items-center gap-1.5 text-[10px] font-medium text-[#718077] sm:flex">
            <CircleHelp size={13} /> Touchez « Demander à Selly » pour en savoir plus
          </span>
        </div>

        {shown.length ? (
          <div className="grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-2 sm:gap-x-5 sm:gap-y-9 lg:grid-cols-4 lg:gap-x-6">
            {shown.map((p) => (
              <article key={p.id} className="product-card group min-w-0">
                <div className="relative overflow-hidden rounded-[19px] sm:rounded-[23px]">
                  <ProductArt product={p} />
                  {p.tag && (
                    <span
                      className={`absolute left-3 top-3 rounded-full px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-[.08em] ${
                        p.stock === 0
                          ? 'bg-[#f0e8db] text-[#887763]'
                          : 'bg-[#f8f3e7] text-[#496448]'
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
                    className={`absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-[#faf8f0]/90 transition hover:scale-105 ${
                      favorites.includes(p.id) ? 'text-[#d96f55]' : 'text-[#425d4b]'
                    }`}
                  >
                    <Heart size={16} fill={favorites.includes(p.id) ? 'currentColor' : 'none'} />
                  </button>
                  <div className="ask-action absolute bottom-3 left-3 right-3">
                    <button
                      type="button"
                      onClick={() => openChat(p)}
                      className="flex min-h-10 w-full items-center justify-center gap-2 rounded-full border border-white/70 bg-[#fbf9f2]/95 px-2 text-[10px] font-bold text-[#24543e] shadow-sm backdrop-blur-sm transition hover:bg-white sm:text-[11px]"
                    >
                      <MessageCircle size={14} /> Demander à Selly
                    </button>
                  </div>
                </div>
                <div className="px-0.5 pt-3">
                  <div className="flex items-start justify-between gap-1">
                    <h3 className="text-[13px] font-bold leading-snug text-[#2a4939] sm:text-[14px]">
                      {p.name}
                    </h3>
                    <span className="mt-0.5 shrink-0 text-[9px] font-medium text-[#869086]">
                      {p.stock ? `${p.stock} dispo` : 'Épuisé'}
                    </span>
                  </div>
                  <p className="mt-1.5 min-h-[30px] text-[10px] leading-[1.5] text-[#81877e] sm:text-[11px]">
                    {p.detail}
                  </p>
                  <div className="mt-3 flex items-center justify-between gap-1.5">
                    <div>
                      <span className="block text-[13px] font-bold text-[#214b39] sm:text-[14px]">
                        {fcfa(p.price)}
                      </span>
                      {p.oldPrice && (
                        <span className="text-[9px] text-[#999489] line-through">
                          {fcfa(p.oldPrice)}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={!p.stock}
                      onClick={() => add(p)}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#e8e7dc] text-[#28513f] transition hover:bg-[#d8e2d3] disabled:cursor-not-allowed disabled:opacity-40 sm:h-10 sm:w-10"
                      aria-label={`Ajouter ${p.name} au panier`}
                    >
                      <Plus size={17} />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="flex min-h-[270px] flex-col items-center justify-center rounded-[24px] border border-dashed border-[#b8c2b5] bg-[#efeee5] px-5 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-[#dfe8db] text-[#3e7653]">
              <Search size={20} />
            </span>
            <h3 className="mt-4 text-base font-bold text-[#315340]">
              Rien dans les rayons pour cette recherche
            </h3>
            <p className="mt-1.5 max-w-sm text-xs text-[#788078]">
              Essayez un autre mot ou parcourez toute la sélection d’Awa.
            </p>
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setCategory('Tout voir');
                setInStock(false);
              }}
              className="mt-4 rounded-full bg-[#245a40] px-4 py-2.5 text-xs font-bold text-white"
            >
              Tout afficher
            </button>
          </div>
        )}
      </section>

      <section id="boutique" className="bg-[#214d3b] text-[#f8f2e6]">
        <div className="mx-auto grid max-w-[1260px] gap-8 px-5 py-12 sm:px-8 sm:py-[60px] md:grid-cols-[1.1fr_.9fr] md:items-center">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.16em] text-[#d8a180]">
              <MapPin size={13} /> Notre coin de Dakar
            </div>
            <h2 className="display mt-3 text-[32px] font-bold tracking-[-1px] sm:text-[39px]">
              Une boutique de quartier,
              <br />
              toujours à portée de main.
            </h2>
            <p className="mt-3 max-w-[480px] text-[13px] leading-[1.8] text-[#d1dbce]">
              Awa déniche et confectionne des pièces qui racontent un peu la maison. Passez nous
              voir, ou écrivez à Selly pour un conseil.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => openChat()}
                className="flex min-h-11 items-center gap-2 rounded-full bg-[#e7805b] px-5 text-xs font-bold text-white transition hover:bg-[#d9714d]"
              >
                <MessageCircle size={15} /> Demander son chemin
              </button>
              <button
                type="button"
                onClick={share}
                className="flex min-h-11 items-center gap-2 rounded-full border border-white/25 px-5 text-xs font-bold text-[#f8f2e6] transition hover:bg-white/10"
              >
                <ArrowUpRight size={15} /> Partager la boutique
              </button>
            </div>
          </div>
          <div className="relative overflow-hidden rounded-[22px] border border-white/15 bg-[#2a5b45] p-5 sm:p-7">
            <div className="absolute -right-10 -top-16 h-48 w-48 rounded-full border border-white/10" />
            <div className="absolute -right-3 -top-9 h-32 w-32 rounded-full border border-white/10" />
            <div className="relative flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[.14em] text-[#d7a182]">
                  Kër Awa · Liberté 6 Extension
                </div>
                <p className="mt-2 text-[16px] font-semibold leading-[1.5]">
                  Villa 18, derrière la pharmacie
                  <br />
                  Liberté 6, Dakar
                </p>
              </div>
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#e3e4d6] text-[#2c5a41]">
                <MapPin size={20} />
              </span>
            </div>
            <div className="relative mt-5 flex flex-wrap gap-x-8 gap-y-3 border-t border-white/15 pt-4">
              <div>
                <div className="text-[9px] uppercase tracking-[.12em] text-[#c4d2c4]">Latitude</div>
                <div className="mono mt-1 text-[12px] text-[#fff7e8]">14.7246° N</div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-[.12em] text-[#c4d2c4]">
                  Longitude
                </div>
                <div className="mono mt-1 text-[12px] text-[#fff7e8]">17.4678° W</div>
              </div>
              <a
                href="https://maps.google.com/?q=14.7246,-17.4678"
                target="_blank"
                rel="noreferrer"
                className="ml-auto flex items-center gap-1.5 self-end text-[10px] font-bold text-[#f4b18f] hover:text-white"
              >
                Voir sur la carte <ArrowUpRight size={13} />
              </a>
            </div>
          </div>
        </div>
      </section>

      <footer className="bg-[#f6f3eb]">
        <div className="mx-auto flex max-w-[1260px] flex-col gap-4 px-5 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <Logo />
          <p className="text-[10px] leading-relaxed text-[#80857b]">
            Une vitrine de démonstration — panier indicatif, aucune commande ni paiement n’est
            effectué.
          </p>
          <span className="text-[10px] text-[#879087]">Une boutique portée par Selly.</span>
        </div>
      </footer>

      <button
        type="button"
        onClick={() => openChat()}
        aria-label="Ouvrir Selly, votre conseillère de boutique"
        className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center gap-2.5 rounded-full bg-[#e57b56] px-0 text-white shadow-[0_12px_35px_rgba(151,79,52,.27)] transition hover:-translate-y-1 hover:bg-[#d96e49] sm:bottom-7 sm:right-8 sm:h-[58px] sm:w-auto sm:justify-start sm:px-5"
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-white/20">
          <Sparkles size={17} />
        </span>
        <span className="hidden text-left sm:block">
          <span className="block text-xs font-bold">Parler à Selly</span>
          <span className="block text-[9px] text-white/80">Votre conseillère de boutique</span>
        </span>
      </button>

      {toast && (
        <div
          role="status"
          className="fixed bottom-[90px] left-1/2 z-[80] -translate-x-1/2 rounded-full bg-[#214d3b] px-5 py-3 text-xs font-semibold text-white shadow-lg"
        >
          {toast}
        </div>
      )}

      {chatOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-[#1a3528]/30 p-0 backdrop-blur-[2px] sm:items-center sm:p-5"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setChatOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Discussion démo avec Selly"
            className="flex max-h-[88dvh] w-full max-w-[430px] flex-col overflow-hidden rounded-t-[26px] border border-[#d8ddcf] bg-[#f9f7f0] shadow-[0_25px_80px_rgba(24,48,35,.27)] sm:rounded-[26px]"
          >
            <header className="flex items-center justify-between bg-[#214d3b] px-5 py-4 text-[#faf4e7]">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-[#e77d59]">
                  <Sparkles size={18} />
                </span>
                <div>
                  <h2 className="text-sm font-bold">Selly, la conseillère d’Awa</h2>
                  <p className="mt-0.5 text-[10px] text-[#cfdbce]">
                    Réponses démo · catalogue local
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setChatOpen(false)}
                aria-label="Fermer la discussion"
                className="grid h-9 w-9 place-items-center rounded-full transition hover:bg-white/10"
              >
                <X size={18} />
              </button>
            </header>
            <div
              className="flex min-h-[250px] flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 sm:px-5"
              aria-live="polite"
            >
              <div className="mb-1 rounded-xl border border-[#ddcdbb] bg-[#f2eadc] px-3 py-2 text-[10px] leading-relaxed text-[#776c5d]">
                Ceci est une démonstration locale. Selly ne contacte pas une IA en direct et ne
                passe aucune commande.
              </div>
              {messages.map((m, i) => (
                <div
                  key={`${i}-${m.from}`}
                  className={`max-w-[87%] rounded-[17px] px-3.5 py-3 text-[12px] leading-[1.6] ${
                    m.from === 'you'
                      ? 'self-end rounded-br-[5px] bg-[#dfe9dc] text-[#2d5140]'
                      : 'self-start rounded-bl-[5px] bg-white text-[#43574a] shadow-[0_2px_8px_rgba(27,56,37,.05)]'
                  }`}
                >
                  {m.text}
                </div>
              ))}
              <div className="mt-1 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setDraft('Qu’est-ce qui est disponible ?')}
                  className="rounded-full border border-[#d7dfd3] px-3 py-2 text-[10px] font-semibold text-[#44654e] hover:bg-[#edf1e8]"
                >
                  Qu’est-ce qui est dispo ?
                </button>
                <button
                  type="button"
                  onClick={() => setDraft('Quels sont les prix ?')}
                  className="rounded-full border border-[#d7dfd3] px-3 py-2 text-[10px] font-semibold text-[#44654e] hover:bg-[#edf1e8]"
                >
                  Voir les prix
                </button>
              </div>
            </div>
            <form
              onSubmit={send}
              className="flex items-center gap-2 border-t border-[#e2dfd5] bg-[#fdfbf6] p-3.5 sm:p-4"
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Écrivez votre question…"
                className="h-11 min-w-0 flex-1 rounded-full border border-[#e1e0d7] bg-white px-4 text-xs outline-none placeholder:text-[#9da197] focus:border-[#66816a]"
                aria-label="Votre message"
              />
              <button
                type="submit"
                disabled={!draft.trim()}
                aria-label="Envoyer le message"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#24583f] text-white transition hover:bg-[#174831] disabled:opacity-40"
              >
                <Send size={16} />
              </button>
            </form>
          </section>
        </div>
      )}

      {cartOpen && (
        <div
          className="fixed inset-0 z-[70] flex justify-end bg-[#1a3528]/35 backdrop-blur-[2px]"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setCartOpen(false);
          }}
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Votre panier de démonstration"
            className="flex h-full w-full max-w-[430px] flex-col bg-[#f9f7f0] shadow-2xl"
          >
            <header className="flex items-center justify-between border-b border-[#e4e1d6] px-5 py-5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#c47758]">
                  Votre sélection
                </p>
                <h2 className="mt-1 text-lg font-bold text-[#214b39]">
                  Le panier <span className="text-sm font-medium text-[#879087]">({count})</span>
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setCartOpen(false)}
                aria-label="Fermer le panier"
                className="grid h-10 w-10 place-items-center rounded-full bg-[#ebe9df]"
              >
                <X size={18} />
              </button>
            </header>
            {count === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center px-7 text-center">
                <span className="grid h-[72px] w-[72px] place-items-center rounded-full bg-[#e7eadf] text-[#49734f]">
                  <ShoppingCart size={27} />
                </span>
                <h3 className="mt-5 text-lg font-bold text-[#2d4d3b]">
                  Votre panier est tout neuf
                </h3>
                <p className="mt-2 max-w-[250px] text-xs leading-relaxed text-[#7b847b]">
                  Ajoutez une trouvaille de la sélection d’Awa pour la garder sous la main.
                </p>
                <button
                  type="button"
                  onClick={() => setCartOpen(false)}
                  className="mt-5 rounded-full bg-[#24583f] px-5 py-3 text-xs font-bold text-white"
                >
                  Continuer la visite
                </button>
              </div>
            ) : (
              <>
                <div className="flex-1 space-y-3 overflow-y-auto p-4">
                  {PRODUCTS.filter((p) => cart[p.id]).map((p) => (
                    <div
                      key={p.id}
                      className="flex gap-3 rounded-[18px] border border-[#e5e0d4] bg-white p-3"
                    >
                      <div className="h-[76px] w-[76px] shrink-0 overflow-hidden rounded-[13px]">
                        <ProductArt product={p} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold text-[#2e4d3b]">{p.name}</div>
                        <div className="mt-1 text-[11px] font-semibold text-[#576d5d]">
                          {fcfa(p.price)}
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            type="button"
                            aria-label={`Retirer une unité de ${p.name}`}
                            onClick={() => change(p, -1)}
                            className="grid h-7 w-7 place-items-center rounded-full bg-[#eeeee6]"
                          >
                            <Minus size={13} />
                          </button>
                          <span className="mono text-[11px]">{cart[p.id]}</span>
                          <button
                            type="button"
                            aria-label={`Ajouter une unité de ${p.name}`}
                            onClick={() => change(p, 1)}
                            className="grid h-7 w-7 place-items-center rounded-full bg-[#eeeee6] disabled:opacity-35"
                            disabled={(cart[p.id] ?? 0) >= p.stock}
                          >
                            <Plus size={13} />
                          </button>
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label={`Retirer ${p.name} du panier`}
                        onClick={() => change(p, -(cart[p.id] ?? 0))}
                        className="self-start p-1 text-[#98a097] hover:text-[#bd664c]"
                      >
                        <X size={15} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="border-t border-[#e1ded3] bg-[#f5f2e9] p-5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[#758078]">Sous-total indicatif</span>
                    <span className="text-lg font-bold text-[#214b39]">{fcfa(subtotal)}</span>
                  </div>
                  <div className="mt-3 rounded-xl bg-[#ece8dc] px-3 py-2.5 text-[10px] leading-relaxed text-[#746d5f]">
                    Démo uniquement : aucune commande n’est envoyée et aucun paiement n’est
                    encaissé.
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setCartOpen(false);
                      openChat();
                    }}
                    className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-[#24583f] text-xs font-bold text-white transition hover:bg-[#174831]"
                  >
                    Poser une question à Selly <MessageCircle size={15} />
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
