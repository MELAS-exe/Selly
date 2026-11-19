import type { Metadata } from 'next';
import type { CSSProperties, ReactNode } from 'react';
import { AskSelly } from '@/components/chat/ask-selly';
import { LangProvider } from '@/components/lang';
import { AskButton } from '@/components/storefront/ask-button';
import { CartDrawer } from '@/components/storefront/cart-drawer';
import { ArrowUpRight } from '@/components/storefront/draft-icons';
import { deliveryLabel } from '@/components/storefront/facts';
import { storefrontSerif } from '@/components/storefront/fonts';
import { ShareButton } from '@/components/storefront/share-button';
import { ShopMark } from '@/components/storefront/shop-mark';
import { ShopMenu } from '@/components/storefront/shop-menu';
import { storefrontStyle } from '@/lib/brand-colors';
import { getStore } from '@/lib/core';
import { langOf, type T, translator } from '@/lib/i18n';
import '@/components/storefront/storefront.css';
// The turning rings (pv-spin) take their keyframes from the landing page's styles.
import '@/components/landing/landing.css';

// The shop's own logo in the browser tab, on every page of the shop; Selly's icon when it has none.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { store } = await getStore(slug);
  const logo = store.branding?.logo_url;
  return logo ? { icons: { icon: logo, apple: logo } } : {};
}

export default async function ShopLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { store, preview } = await getStore(slug);
  const unpublished = store.ordering?.reason === 'wallet_missing';
  // The shop speaks its vendor's language (lib/i18n.ts): the layout here, its client components through LangProvider.
  const lang = langOf(store.locale);
  const t = translator(lang);
  // Not published (no wallet yet) or closed (trial over, plan suspended): customers get this notice only, nothing
  // of the shop behind it. The owner sees the whole shop, with the preview bar.
  if (store.status !== 'active' && !preview)
    return <ClosedShop name={store.display_name} soon={unpublished} t={t} />;
  const banner = store.branding?.banner;
  const delivery = deliveryLabel(store, lang);
  const announce =
    banner?.text ??
    (delivery
      ? `${delivery.title}, ${delivery.sub}`
      : t(
          'Paiement en bitcoin, directement à la boutique',
          'Pay in bitcoin, straight to the shop',
        ));

  return (
    <LangProvider lang={lang}>
      <div
        lang={lang}
        className={`sf ${storefrontSerif.variable} min-h-dvh text-[var(--sf-ink)]`}
        style={storefrontStyle(store.branding) as CSSProperties}
      >
        <div aria-hidden="true" className="sf-progress" />
        {preview && <PreviewBar unpublished={unpublished} t={t} />}
        <div className="bg-[var(--sf-ink)] px-4 py-2.5 text-center text-[0.9375rem] text-d-paper">
          <span className="inline-flex items-center justify-center gap-2.5">
            <span aria-hidden="true" className="size-1.5 shrink-0 bg-[var(--sf-accent)]" />
            {banner?.href ? (
              <a href={banner.href} className="underline underline-offset-4">
                {announce}
              </a>
            ) : (
              announce
            )}
          </span>
        </div>

        <header
          className="sticky top-0 z-30 border-b border-d-hairline bg-d-paper/90 backdrop-blur-md"
          style={{ viewTransitionName: 'shop-header' }}
        >
          <span aria-hidden="true" className="header-shade" />
          <div className="relative mx-auto flex h-20 max-w-[1260px] items-center justify-between gap-4 px-5 sm:px-8">
            <a
              href={`/s/${slug}`}
              aria-label={`${store.display_name}, ${t('accueil de la boutique', 'shop home')}`}
              className="min-w-0"
            >
              <ShopMark name={store.display_name} logo={store.branding?.logo_url ?? null} />
            </a>
            <nav
              className="hidden items-center gap-9 md:flex"
              aria-label={t('Navigation de la boutique', 'Shop navigation')}
            >
              <a
                className="min-h-11 content-center font-medium hover:underline hover:underline-offset-8"
                href={`/s/${slug}#catalogue`}
              >
                {t('La sélection', 'The selection')}
              </a>
              <a
                className="min-h-11 content-center font-medium hover:underline hover:underline-offset-8"
                href={`/s/${slug}#boutique`}
              >
                {t('La boutique', 'The shop')}
              </a>
              {store.chat.enabled && (
                <AskButton className="flex min-h-11 items-center gap-1.5 font-medium hover:underline hover:underline-offset-8">
                  {t('Parler à Selly', 'Talk to Selly')} <ArrowUpRight size={15} />
                </AskButton>
              )}
            </nav>
            <div className="flex items-center gap-2">
              <ShareButton
                url={`/s/${slug}`}
                title={store.display_name}
                className="sf-btn sf-btn-ghost hidden !min-h-11 sm:inline-flex"
              >
                <ArrowUpRight size={15} /> {t('Partager', 'Share')}
              </ShareButton>
              <CartDrawer
                slug={slug}
                delivery={store.delivery}
                ordersOpen={store.ordering?.enabled !== false}
              />
              <ShopMenu />
            </div>
          </div>
        </header>

        {children}

        <footer className="border-t border-d-hairline">
          <div className="mx-auto flex max-w-[1260px] flex-col gap-5 border-x border-d-hairline px-5 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <ShopMark name={store.display_name} logo={store.branding?.logo_url ?? null} />
            <p className="text-[0.9375rem] text-d-ink-soft">
              {t(
                'Paiement en bitcoin, directement à la boutique.',
                'Paid in bitcoin, straight to the shop.',
              )}{' '}
              <a
                href="/aide/payer-en-bitcoin"
                className="font-medium text-[var(--sf-ink)] underline underline-offset-4"
              >
                {t('Comment payer', 'How to pay')}
              </a>
            </p>
            {store.powered_by_badge && (
              <a
                href="/"
                className="flex min-h-11 items-center gap-2 text-[0.9375rem] text-d-ink-soft"
              >
                {t('Une boutique portée par', 'A shop powered by')}{' '}
                <img src="/brand/selly-wordmark.png" alt="Selly" className="h-5 w-auto" />
              </a>
            )}
          </div>
        </footer>

        {store.chat.enabled && (
          <AskSelly slug={slug} storeName={store.display_name} whatsappLink={store.whatsapp_link} />
        )}
      </div>
    </LangProvider>
  );
}

/** Only the owner sees this: what customers see instead, and how to publish. */
function PreviewBar({ unpublished, t }: { unpublished: boolean; t: T }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-[#E3342F] px-4 py-2.5 text-center text-[0.9375rem] text-white">
      <span>
        <strong>{t('Aperçu.', 'Preview.')}</strong>{' '}
        {unpublished
          ? t(
              'Vos clients ne voient pas encore la boutique : liez un portefeuille pour la publier.',
              'Your customers cannot see the shop yet: link a wallet to publish it.',
            )
          : t(
              'La boutique est fermée au public : choisissez une formule pour la rouvrir.',
              'The shop is closed to the public: choose a plan to reopen it.',
            )}
      </span>
      <a
        href={unpublished ? '/app/portefeuille' : '/app/abonnement'}
        className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
      >
        {unpublished
          ? t('Lier un portefeuille', 'Link a wallet')
          : t('Voir les formules', 'See the plans')}
      </a>
    </div>
  );
}

function ClosedShop({ name, soon, t }: { name: string; soon: boolean; t: T }) {
  return (
    <div className={`sf ${storefrontSerif.variable} min-h-dvh text-[var(--sf-ink)]`}>
      <main className="mx-auto max-w-xl px-5 pt-24 pb-20">
        <h1 className="text-[1.75rem] leading-tight font-bold">
          {soon
            ? t('Bientôt en ligne', 'Opening soon')
            : t('Boutique momentanément fermée', 'Shop closed for now')}
        </h1>
        <p className="mt-3 text-d-ink-soft">
          {soon
            ? t(
                `${name} prépare sa boutique. Revenez très bientôt.`,
                `${name} is getting the shop ready. Come back soon.`,
              )
            : t(
                `${name} ne reçoit pas de visites pour le moment. Revenez un peu plus tard.`,
                `${name} is not open to visits right now. Come back a little later.`,
              )}
        </p>
        <a href="/" className="mt-8 inline-flex min-h-11 items-center gap-2 text-[0.9375rem]">
          {t('Une boutique portée par', 'A shop powered by')}{' '}
          <img src="/brand/selly-wordmark.png" alt="Selly" className="h-5 w-auto" />
        </a>
      </main>
    </div>
  );
}
