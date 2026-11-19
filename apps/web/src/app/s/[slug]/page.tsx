import type { Metadata } from 'next';
import Link from 'next/link';
import { type CSSProperties, ViewTransition } from 'react';
import { AskButton } from '@/components/storefront/ask-button';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Clock3,
  MapPin,
  MessageCircle,
  PackageCheck,
  Search,
  ShoppingBag,
  Sparkles,
  Store,
  X,
} from '@/components/storefront/draft-icons';
import { deliveryLabel, hoursLabel, mapsUrl, pickupAddress } from '@/components/storefront/facts';
import { QuickAdd } from '@/components/storefront/quick-add';
import { ShareButton } from '@/components/storefront/share-button';
import { Visual } from '@/components/storefront/visual';
import { getStore, searchProducts } from '@/lib/core';
import { availabilityIn, moneyIn } from '@/lib/format';
import { heroCopy } from '@/lib/hero';
import { type Lang, langOf, type T, translator } from '@/lib/i18n';
import type { ProductSummary, StorePublic } from '@/lib/types';

type Params = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ category?: string; q?: string; stock?: string }>;
};

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const { store, products } = await getStore(slug);
  const t = translator(langOf(store.locale));
  const n = products.length;
  const description = t(
    `${n} article${n > 1 ? 's' : ''}, livraison à Dakar, paiement en bitcoin.`,
    `${n} item${n > 1 ? 's' : ''}, delivery in Dakar, payment in bitcoin.`,
  );
  const image = products.find((p) => p.image)?.image;
  return {
    title: store.display_name,
    description,
    openGraph: {
      title: store.display_name,
      description,
      type: 'website',
      images: image ? [{ url: image.url, width: image.width, height: image.height }] : undefined,
    },
  };
}

function InfoCell({
  icon,
  title,
  sub,
  n = 0,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
  n?: number;
}) {
  return (
    <div
      className="sf-cell flex items-center gap-3 border-b border-d-hairline px-4 py-4 min-[480px]:odd:border-r md:gap-4 md:border-r md:border-b-0 md:px-5 md:py-5 md:last:border-r-0"
      style={{ '--n': n } as CSSProperties}
    >
      <span className="grid size-11 shrink-0 place-items-center border border-d-hairline">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="font-semibold">{title}</div>
        <div className="text-[0.9375rem] text-d-ink-soft">{sub}</div>
      </div>
    </div>
  );
}

/** Low stock and sold out say it on the card; core gives availability in words, never a count. */
function tagFor(p: ProductSummary, t: T): { text: string; quiet: boolean } | null {
  if (p.availability === 'out_of_stock') return { text: t('Épuisé', 'Sold out'), quiet: true };
  if (p.availability === 'low') return { text: t('Dernières pièces', 'Last few'), quiet: false };
  return null;
}

function href(slug: string, q: { category?: string; q?: string; stock?: string }) {
  const s = new URLSearchParams();
  if (q.category) s.set('category', q.category);
  if (q.q) s.set('q', q.q);
  if (q.stock) s.set('stock', q.stock);
  const qs = s.toString();
  return `/s/${slug}${qs ? `?${qs}` : ''}#catalogue`;
}

function Hero({
  store,
  slug,
  featured,
  second,
  t,
  lang,
}: {
  store: StorePublic;
  slug: string;
  featured: ProductSummary | undefined;
  second: ProductSummary | undefined;
  t: T;
  lang: Lang;
}) {
  const { money } = moneyIn(lang);
  const address = pickupAddress(store);
  const hero = heroCopy(store.display_name, store.branding?.hero);
  return (
    <section
      id="top"
      className="mx-auto max-w-[1260px] border-x border-d-hairline px-5 pt-10 pb-16 sm:px-8 lg:pt-16 lg:pb-20"
    >
      <div className="grid items-center gap-10 lg:grid-cols-[1.02fr_.98fr] lg:gap-16">
        <div>
          <p className="sf-eyebrow sf-rise mb-7">{hero.eyebrow}</p>
          <h1 className="sf-serif text-[clamp(2.375rem,12vw,3.25rem)] leading-[0.95] font-normal tracking-[-0.02em] [overflow-wrap:anywhere] sm:text-[4.5rem] lg:text-[5.5rem]">
            <span className="sf-line [--i:0]">{hero.title[0]}</span>
            {hero.title[1] && (
              <span className="sf-line italic text-[var(--sf-accent-text)] [--i:1]">
                {hero.title[1]}
              </span>
            )}
          </h1>
          <p className="sf-rise mt-6 max-w-[28rem] text-[1.0625rem] leading-relaxed text-d-ink-soft [--d:300ms]">
            {hero.text}
          </p>
          <div className="sf-rise mt-9 flex flex-wrap gap-3 [--d:400ms]">
            <a href="#catalogue" className="sf-btn sf-btn-primary">
              {hero.cta} <ArrowDownRight size={16} />
            </a>
            {store.chat.enabled && (
              <AskButton className="sf-btn sf-btn-ghost">
                <Sparkles size={15} /> {t('Demander à Selly', 'Ask Selly')}
              </AskButton>
            )}
          </div>
          {address && (
            <p className="sf-rise mt-10 text-[0.9375rem] text-d-ink-soft [--d:500ms]">
              {t('Retrait gratuit', 'Free pickup')}
            </p>
          )}
        </div>

        {featured && (
          <div className="sf-hero-photo relative mx-auto w-full max-w-[570px] lg:max-w-none">
            <div
              aria-hidden="true"
              className="absolute inset-0 translate-x-3 translate-y-3 border border-d-hairline"
            />
            <div className="absolute top-8 -left-3 z-10 hidden border border-d-hairline bg-d-paper px-5 py-4 sm:block">
              <p className="flex items-center gap-2 text-xs font-semibold tracking-[0.2em] text-d-ink-soft uppercase">
                <span aria-hidden="true" className="size-1.5 bg-[var(--sf-accent)]" />{' '}
                {t('La pièce du moment', 'Piece of the moment')}
              </p>
              <p className="sf-serif mt-1 text-xl font-semibold">
                {t('Le coup de cœur de la boutique', 'The shop’s favourite')}
              </p>
            </div>
            <Link
              href={`/s/${slug}/p/${featured.slug}`}
              className="sf-unveil relative block overflow-clip bg-d-paper-deep"
            >
              <Visual
                image={featured.image}
                title={featured.title}
                sizes="(min-width: 1024px) 560px, 100vw"
                priority
                ratio="aspect-[1.1/1]"
              />
              <span
                aria-hidden="true"
                className="absolute inset-0 bg-gradient-to-t from-d-ink/25 via-transparent to-transparent"
              />
              <span className="absolute right-3 bottom-3 left-3 flex items-center justify-between gap-3 border border-d-hairline bg-d-paper/95 p-3 backdrop-blur-md sm:right-4 sm:bottom-4 sm:left-4 sm:gap-4 sm:p-5">
                <span className="min-w-0">
                  <span className="sf-serif block text-lg leading-tight font-semibold sm:text-2xl">
                    {featured.title}
                  </span>
                  <span className="mt-0.5 block text-[0.9375rem] text-d-ink-soft">
                    {availabilityIn(lang)[featured.availability]}
                  </span>
                  {/* On a phone the price goes under the name: beside it, the two collide. */}
                  <span className="sf-figure mt-1 block text-lg sm:hidden">
                    {money(featured.price)}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="sf-figure hidden text-2xl whitespace-nowrap sm:inline">
                    {money(featured.price)}
                  </span>
                  <span
                    aria-hidden="true"
                    className="grid size-11 place-items-center bg-[var(--sf-ink)] text-d-paper"
                  >
                    <ArrowRight size={18} />
                  </span>
                </span>
              </span>
            </Link>
            {second && (
              <div className="sf-float-card-wrap absolute -top-8 -right-5 z-20 hidden w-40 md:block lg:-right-8 lg:w-48">
                <Link
                  href={`/s/${slug}/p/${second.slug}`}
                  className="sf-float-card block border border-d-hairline bg-d-paper p-2 shadow-[0_18px_40px_rgb(23_59_50/0.14)]"
                >
                  <span className="block overflow-clip">
                    <Visual
                      image={second.image}
                      title={second.title}
                      sizes="200px"
                      ratio="aspect-square"
                    />
                  </span>
                  <span className="sf-serif mt-2 block truncate px-1 text-lg leading-tight font-semibold">
                    {second.title}
                  </span>
                  <span className="sf-figure block px-1 pb-1 text-base">{money(second.price)}</span>
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function InfoBand({ store, t, lang }: { store: StorePublic; t: T; lang: Lang }) {
  const hours = hoursLabel(store, lang);
  const delivery = deliveryLabel(store, lang);
  const address = pickupAddress(store);
  return (
    <section
      aria-label={t('La boutique en bref', 'The shop at a glance')}
      className="border-y border-d-hairline bg-d-paper-deep/60"
    >
      {/* One column on a small phone: two would leave a word per line. */}
      <div className="mx-auto grid max-w-[1260px] grid-cols-1 border-x border-d-hairline min-[480px]:grid-cols-2 md:grid-cols-4">
        <InfoCell
          icon={<Store size={18} />}
          title={store.display_name}
          sub={t('Boutique sur Selly', 'A shop on Selly')}
        />
        {address && (
          <InfoCell
            n={1}
            icon={<MapPin size={18} />}
            title={address}
            sub={t('Retrait gratuit', 'Free pickup')}
          />
        )}
        {hours && (
          <InfoCell
            n={2}
            icon={<Clock3 size={18} />}
            title={hours}
            sub={t('Horaires de la boutique', 'Opening hours')}
          />
        )}
        {delivery && (
          <InfoCell
            n={3}
            icon={<PackageCheck size={18} />}
            title={delivery.title}
            sub={delivery.sub}
          />
        )}
      </div>
    </section>
  );
}

/** A band of the shop's real facts, scrolling (decorative: the same facts are in the band above). */
function Card({
  p,
  slug,
  index,
  category,
  chat,
  t,
  lang,
}: {
  p: ProductSummary;
  slug: string;
  index: number;
  category?: string;
  chat: boolean;
  t: T;
  lang: Lang;
}) {
  const { money } = moneyIn(lang);
  const tag = tagFor(p, t);
  const soldOut = p.availability === 'out_of_stock';
  return (
    <article className="sf-card product-card group min-w-0">
      <div className="card-media relative overflow-clip border border-d-hairline">
        <Link href={`/s/${slug}/p/${p.slug}`} className="block" aria-label={p.title}>
          <ViewTransition name={`product-${p.slug}`} share="morph" default="none">
            <Visual
              image={p.image}
              title={p.title}
              sizes="(min-width: 1024px) 300px, 50vw"
              priority={index < 2}
            />
          </ViewTransition>
        </Link>
        {tag && (
          <span
            className={`pointer-events-none absolute top-2 left-2 px-2 py-1.5 text-xs font-semibold tracking-[0.08em] whitespace-nowrap uppercase sm:top-3 sm:left-3 sm:px-2.5 sm:tracking-[0.16em] ${
              tag.quiet ? 'bg-d-paper text-d-ink-soft' : 'bg-[var(--sf-ink)] text-d-paper'
            }`}
          >
            {tag.text}
          </span>
        )}
        {chat && (
          <div className="ask-action absolute right-3 bottom-3 left-3">
            <AskButton
              productId={p.id}
              productTitle={p.title}
              label={t(`Demander à Selly à propos de ${p.title}`, `Ask Selly about ${p.title}`)}
              className="flex min-h-11 w-full items-center justify-center gap-2 bg-d-paper/95 px-2 font-medium backdrop-blur-sm"
            >
              <MessageCircle size={16} /> {t('Demander à Selly', 'Ask Selly')}
            </AskButton>
          </div>
        )}
      </div>
      <div className="card-text pt-4">
        <Link href={`/s/${slug}/p/${p.slug}`} className="hover:underline hover:underline-offset-4">
          <h3 className="sf-serif text-lg leading-tight font-semibold sm:text-[1.375rem]">
            {p.title}
          </h3>
        </Link>
        <p className="mt-1 text-sm text-d-ink-soft sm:text-[0.9375rem]">
          {category ? `${category} · ` : ''}
          <span className={p.availability === 'low' ? 'font-medium text-d-alert' : ''}>
            {availabilityIn(lang)[p.availability]}
          </span>
        </p>
        {/* A narrow card puts the button under the price rather than past its edge. */}
        <div className="mt-4 flex flex-wrap items-end justify-between gap-x-2 gap-y-3">
          <span className="sf-figure text-lg leading-none whitespace-nowrap sm:text-[1.375rem]">
            {money(p.price)}
          </span>
          <QuickAdd
            slug={slug}
            productSlug={p.slug}
            title={p.title}
            hasOptions={Object.values(p.options).some((v) => v.length > 1)}
            soldOut={soldOut}
          />
        </div>
      </div>
    </article>
  );
}

export default async function StorePage({ params, searchParams }: Params) {
  const { slug } = await params;
  const filters = await searchParams;
  const q = filters.q?.trim() || undefined;
  const stockOnly = filters.stock === '1';
  const { store, products: all } = await getStore(slug, { category: filters.category });
  const listed = q ? (await searchProducts(slug, { q, category: filters.category })).data : all;
  const products = stockOnly ? listed.filter((p) => p.availability !== 'out_of_stock') : listed;
  // The piece of the moment: a product with a photo, in plain stock first (a nearly sold-out one only if needed).
  const withPhoto = (await getStore(slug)).products.filter((p) => p.image);
  const featured =
    withPhoto.find((p) => p.availability === 'in_stock') ??
    withPhoto.find((p) => p.availability === 'low');
  const second = withPhoto.find((p) => p.id !== featured?.id && p.availability !== 'out_of_stock');
  const categories = store.categories ?? [];
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const address = pickupAddress(store);
  const filtered = Boolean(q || stockOnly || filters.category);
  const lang = langOf(store.locale);
  const t = translator(lang);

  return (
    <main>
      {store.branding?.banner?.image_url && (
        <div className="mx-auto max-w-[1260px] border-x border-d-hairline">
          <img
            src={store.branding.banner.image_url}
            alt=""
            className="block aspect-[8/3] w-full object-cover sm:aspect-[16/5]"
          />
        </div>
      )}
      <Hero store={store} slug={slug} featured={featured} second={second} t={t} lang={lang} />
      <InfoBand store={store} t={t} lang={lang} />

      <section
        id="catalogue"
        aria-labelledby="catalogue-title"
        className="mx-auto max-w-[1260px] scroll-mt-24 border-x border-d-hairline px-5 pt-16 pb-24 sm:px-8 sm:pt-20"
      >
        <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
          <div>
            <p className="sf-eyebrow mb-4">{t('Faits pour être aimés', 'Made to be loved')}</p>
            <h2
              id="catalogue-title"
              className="sf-curtain sf-serif text-[2.75rem] leading-[1] tracking-[-0.01em] sm:text-[3.5rem]"
            >
              {t('La sélection', 'The selection')}
            </h2>
            <p className="mt-3 text-d-ink-soft">
              {t(
                'Des trouvailles qui ont chacune leur petite histoire.',
                'Finds that each have their own little story.',
              )}
            </p>
          </div>
          {store.chat.enabled && (
            <AskButton className="group sf-btn sf-btn-ghost w-fit">
              <Sparkles size={15} /> {t('Besoin d’un conseil ?', 'Need some advice?')}{' '}
              <ArrowRight size={15} className="transition-transform group-hover:translate-x-1" />
            </AskButton>
          )}
        </div>

        <div className="mt-10 flex flex-col gap-4 border-y border-d-hairline py-4 lg:flex-row lg:items-center lg:justify-between">
          {categories.length > 0 ? (
            <nav
              aria-label={t('Catégories', 'Categories')}
              className="-mx-5 flex gap-2 overflow-x-auto px-5 [scrollbar-width:none] lg:mx-0 lg:px-0"
            >
              <Link
                href={href(slug, { q, stock: filters.stock })}
                aria-current={!filters.category ? 'true' : undefined}
                className="chip sf-chip"
              >
                {t('Tout voir', 'See all')}
              </Link>
              {categories.map((c) => (
                <Link
                  key={c.id}
                  href={href(slug, { category: c.slug, q, stock: filters.stock })}
                  aria-current={filters.category === c.slug ? 'true' : undefined}
                  className="chip sf-chip"
                >
                  {c.name}
                </Link>
              ))}
            </nav>
          ) : (
            <span />
          )}
          <div className="flex flex-wrap items-center gap-3">
            <form
              action={`/s/${slug}#catalogue`}
              role="search"
              className="flex min-h-11 min-w-[15rem] flex-1 items-center gap-3 border-b border-d-ink/30 focus-within:border-d-ink sm:flex-none"
            >
              <Search size={17} className="text-d-ink-soft" />
              {filters.category && <input type="hidden" name="category" value={filters.category} />}
              {stockOnly && <input type="hidden" name="stock" value="1" />}
              <input
                name="q"
                defaultValue={q}
                placeholder={t('Un article, une envie…', 'An item, an idea…')}
                className="w-full bg-transparent py-2 outline-none placeholder:text-d-ink-soft/70"
                aria-label={t('Rechercher dans la boutique', 'Search the shop')}
              />
              {q && (
                <Link
                  href={href(slug, { category: filters.category, stock: filters.stock })}
                  aria-label={t('Effacer la recherche', 'Clear the search')}
                  className="grid size-9 place-items-center text-d-ink-soft"
                >
                  <X size={15} />
                </Link>
              )}
            </form>
            <Link
              href={href(slug, {
                category: filters.category,
                q,
                stock: stockOnly ? undefined : '1',
              })}
              aria-current={stockOnly ? 'true' : undefined}
              className="chip sf-chip"
            >
              <span
                aria-hidden="true"
                className={`size-2 ${stockOnly ? 'bg-[var(--sf-accent)]' : 'bg-d-ink/30'}`}
              />{' '}
              {t('En stock', 'In stock')}
            </Link>
          </div>
        </div>

        <div className="mt-5 mb-6 flex items-center justify-between gap-4">
          <p className="text-d-ink-soft" aria-live="polite">
            <span className="tnum font-semibold text-[var(--sf-ink)]">{products.length}</span>{' '}
            {products.length > 1 ? t('trouvailles', 'finds') : t('trouvaille', 'find')} ·{' '}
            {t('Prix en FCFA', 'Prices in FCFA')}
          </p>
          {store.chat.enabled && (
            <span className="hidden text-[0.9375rem] text-d-ink-soft sm:block">
              {t(
                'Touchez « Demander à Selly » pour en savoir plus',
                'Tap “Ask Selly” to find out more',
              )}
            </span>
          )}
        </div>

        {products.length ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-6 lg:grid-cols-4">
            {products.map((p, i) => (
              <Card
                key={p.id}
                p={p}
                slug={slug}
                index={i}
                category={p.category_id ? categoryName.get(p.category_id) : undefined}
                chat={store.chat.enabled}
                t={t}
                lang={lang}
              />
            ))}
          </div>
        ) : (
          <div className="flex min-h-72 flex-col items-center justify-center border border-dashed border-d-ink/25 px-5 py-10 text-center">
            <ShoppingBag size={40} className="text-[var(--sf-accent-text)]" aria-hidden="true" />
            <p className="sf-serif mt-4 text-2xl">
              {filtered
                ? t(
                    'Rien dans les rayons pour cette recherche',
                    'Nothing on the shelves for this search',
                  )
                : t('La sélection arrive bientôt', 'The selection is coming soon')}
            </p>
            <p className="mt-1.5 max-w-sm text-d-ink-soft">
              {filtered
                ? t(
                    'Essayez un autre mot ou parcourez toute la sélection.',
                    'Try another word or browse the whole selection.',
                  )
                : t(
                    'Revenez bientôt, ou écrivez à la boutique.',
                    'Come back soon, or write to the shop.',
                  )}
            </p>
            {filtered && (
              <Link href={`/s/${slug}#catalogue`} className="sf-btn sf-btn-primary mt-5">
                {t('Tout afficher', 'Show everything')}
              </Link>
            )}
          </div>
        )}
      </section>

      <section
        id="boutique"
        aria-labelledby="boutique-title"
        className="scroll-mt-20 bg-[var(--sf-ink)] text-d-paper"
      >
        <div className="mx-auto grid max-w-[1260px] gap-10 px-5 py-16 sm:px-8 sm:py-20 md:grid-cols-[1.1fr_.9fr] md:items-center">
          <div>
            <p className="sf-eyebrow !text-[var(--sf-accent)]">{t('Notre coin', 'Our corner')}</p>
            <h2
              id="boutique-title"
              className="sf-curtain sf-serif mt-5 text-[2.5rem] leading-[1.02] sm:text-[3.25rem]"
            >
              {t('Une boutique de quartier,', 'A neighbourhood shop,')}
              <br />
              <span className="italic text-[var(--sf-accent)]">
                {t('toujours à portée de main.', 'always close at hand.')}
              </span>
            </h2>
            <p className="mt-5 max-w-[30rem] leading-relaxed text-d-paper/80">
              {address
                ? t(
                    'Passez nous voir, ou écrivez à Selly pour un conseil.',
                    'Drop by, or write to Selly for advice.',
                  )
                : t(
                    'Commandez en ligne, ou écrivez à Selly pour un conseil.',
                    'Order online, or write to Selly for advice.',
                  )}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {store.chat.enabled && (
                <AskButton className="sf-btn sf-btn-primary !border-[var(--sf-accent)] !bg-[var(--sf-accent)] !text-d-ink">
                  <MessageCircle size={15} />{' '}
                  {address
                    ? t('Demander son chemin', 'Ask the way')
                    : t('Écrire à Selly', 'Write to Selly')}
                </AskButton>
              )}
              {store.whatsapp_link && (
                <a
                  href={store.whatsapp_link}
                  rel="noopener"
                  className="sf-btn sf-btn-ghost !border-d-paper/40 !text-d-paper"
                >
                  WhatsApp
                </a>
              )}
              <ShareButton
                url={`/s/${slug}`}
                title={store.display_name}
                className="sf-btn sf-btn-ghost !border-d-paper/40 !text-d-paper"
              >
                <ArrowUpRight size={15} /> {t('Partager la boutique', 'Share the shop')}
              </ShareButton>
            </div>
          </div>
          <div className="relative overflow-clip border border-d-paper/20 p-6 sm:p-8">
            <div
              aria-hidden="true"
              className="sf-ring absolute -top-16 -right-10 size-48 rounded-full border border-dashed border-d-paper/20"
            />
            <div
              aria-hidden="true"
              className="sf-ring absolute -top-9 -right-3 size-32 rounded-full border border-d-paper/10 [animation-direction:reverse]"
            />
            <div className="relative flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold tracking-[0.2em] text-[var(--sf-accent)] uppercase">
                  {store.display_name}
                </p>
                <p className="sf-serif mt-3 text-2xl leading-snug">
                  {address ?? t('Livraison à domicile', 'Home delivery')}
                </p>
              </div>
              <span
                aria-hidden="true"
                className="grid size-11 shrink-0 place-items-center bg-d-paper text-[var(--sf-ink)]"
              >
                <MapPin size={20} />
              </span>
            </div>
            <dl className="relative mt-6 grid gap-x-10 gap-y-4 border-t border-d-paper/15 pt-5 sm:grid-cols-2">
              {hoursLabel(store, lang) && (
                <div>
                  <dt className="text-xs tracking-[0.2em] text-d-paper/70 uppercase">
                    {t('Horaires', 'Hours')}
                  </dt>
                  <dd className="mt-1">{hoursLabel(store, lang)}</dd>
                </div>
              )}
              {deliveryLabel(store, lang) && (
                <div>
                  <dt className="text-xs tracking-[0.2em] text-d-paper/70 uppercase">
                    {t('Livraison', 'Delivery')}
                  </dt>
                  <dd className="mt-1">{deliveryLabel(store, lang)?.sub}</dd>
                </div>
              )}
            </dl>
            {address && (
              <a
                href={mapsUrl(address)}
                target="_blank"
                rel="noreferrer"
                className="relative mt-5 flex min-h-11 w-fit items-center gap-1.5 font-semibold text-[var(--sf-accent)] hover:underline"
              >
                {t('Voir sur la carte', 'See on the map')} <ArrowUpRight size={15} />
              </a>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
