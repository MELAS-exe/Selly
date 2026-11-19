import type { Metadata } from 'next';
import type { CSSProperties } from 'react';
import { CheckoutLive } from '@/components/checkout/checkout-live';
import { LangProvider } from '@/components/lang';
import { ArrowRight, MessageCircle } from '@/components/storefront/draft-icons';
import { storefrontSerif } from '@/components/storefront/fonts';
import { ShopMark } from '@/components/storefront/shop-mark';
import { storefrontStyle } from '@/lib/brand-colors';
import { getCheckout, getStore } from '@/lib/core';
import { formatOptions, moneyIn } from '@/lib/format';
import { langOf, translator } from '@/lib/i18n';
import '@/components/storefront/storefront.css';

// Checkout and order page (architecture.md 3.4): server-rendered, never cached, not indexed. The QR is inline SVG
// from core, so paying works before JavaScript; live status (SSE) comes with the client part.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Paiement de votre commande',
  robots: { index: false, follow: false },
};

export default async function CheckoutPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await getCheckout(token);
  const { order, store } = view;
  // The shop's colours and logo; the checkout still works if the shop page cannot be read.
  const shop = await getStore(store.slug)
    .then((s) => s.store)
    .catch(() => null);
  const paid = order.status === 'paid' || order.status === 'fulfilled';
  // The shop's language (lib/i18n.ts), read from the shop page's data.
  const lang = langOf(shop?.locale);
  const t = translator(lang);
  const { money } = moneyIn(lang);

  return (
    <LangProvider lang={lang}>
      <div
        lang={lang}
        className={`sf ${storefrontSerif.variable} min-h-dvh text-[var(--sf-ink)]`}
        style={storefrontStyle(shop?.branding) as CSSProperties}
      >
        <header className="border-b border-d-hairline">
          <div className="mx-auto flex h-20 max-w-[1100px] items-center justify-between gap-4 px-5 sm:px-8">
            <a
              href={`/s/${store.slug}`}
              className="min-w-0"
              aria-label={`${store.display_name}, ${t('retour à la boutique', 'back to the shop')}`}
            >
              <ShopMark name={store.display_name} logo={shop?.branding?.logo_url ?? null} />
            </a>
          </div>
        </header>

        <main className="mx-auto grid max-w-[1100px] gap-10 px-5 py-10 sm:px-8 lg:grid-cols-[1.15fr_1fr] lg:gap-14 lg:py-16">
          <div>
            <p className="sf-eyebrow">
              {t('Commande', 'Order')} {order.number}
            </p>
            <CheckoutLive view={view} />
          </div>

          <aside className="space-y-8 lg:pt-[7.5rem]">
            <section aria-labelledby="recap" className="border border-d-hairline">
              <h2 id="recap" className="sf-eyebrow border-b border-d-hairline px-5 py-4">
                {t('Votre commande', 'Your order')}
              </h2>
              <ul className="px-5">
                {order.items.map((it) => (
                  <li
                    key={`${it.title}-${formatOptions(it.options)}`}
                    className="flex items-start justify-between gap-4 border-b border-d-hairline py-4 last:border-0"
                  >
                    <span className="min-w-0">
                      <span className="sf-serif block text-xl leading-tight font-semibold">
                        {it.title}
                      </span>
                      <span className="text-[0.9375rem] text-d-ink-soft">
                        {[
                          formatOptions(it.options, lang),
                          it.quantity > 1 ? `× ${it.quantity}` : '',
                        ]
                          .filter(Boolean)
                          .join(' · ') || t('Pièce unique', 'One of a kind')}
                      </span>
                    </span>
                    <span className="sf-figure text-lg whitespace-nowrap">
                      {money({
                        ...it.unit_price,
                        amount: it.unit_price.amount * it.quantity,
                      })}
                    </span>
                  </li>
                ))}
              </ul>
              <dl className="space-y-2 border-t border-d-hairline bg-d-paper-deep/60 px-5 py-4">
                <Row label={t('Sous-total', 'Subtotal')} value={money(order.subtotal)} />
                <Row
                  label={t('Livraison', 'Delivery')}
                  value={
                    order.delivery_fee.amount > 0 ? money(order.delivery_fee) : t('Offerte', 'Free')
                  }
                />
                {order.discount.amount > 0 && (
                  <Row label={t('Remise', 'Discount')} value={`− ${money(order.discount)}`} />
                )}
                <div className="flex items-baseline justify-between border-t border-d-hairline pt-3">
                  <dt className="font-semibold">Total</dt>
                  <dd className="sf-figure text-2xl">{money(order.total)}</dd>
                </div>
              </dl>
            </section>

            {!paid && (
              <a
                href={view.help_url}
                className="group flex items-center justify-between gap-4 border border-d-hairline p-5 transition-colors hover:bg-d-paper-deep"
              >
                <span>
                  <span className="sf-serif block text-2xl">
                    {t('Pas de bitcoin ?', 'No bitcoin?')}
                  </span>
                  <span className="text-d-ink-soft">
                    {t(
                      'Voir comment en obtenir avec Orange Money ou Wave.',
                      'See how to get some with Orange Money or Wave.',
                    )}
                  </span>
                </span>
                <ArrowRight
                  size={20}
                  className="shrink-0 transition-transform duration-[var(--dur-ui)] group-hover:translate-x-1"
                />
              </a>
            )}

            <div className="flex flex-wrap gap-3">
              <a href={`/s/${store.slug}`} className="sf-btn sf-btn-ghost">
                {t('Retour à la boutique', 'Back to the shop')}
              </a>
              {store.whatsapp_link && (
                <a href={store.whatsapp_link} rel="noopener" className="sf-btn sf-btn-ghost">
                  <MessageCircle size={16} /> {t('Écrire au vendeur', 'Write to the seller')}
                </a>
              )}
            </div>
            <p className="text-[0.9375rem] text-d-ink-soft">
              {t(
                `Le paiement va directement au portefeuille de ${store.display_name}. Selly ne garde jamais votre argent. Gardez ce lien : il montre l’état de votre commande.`,
                `The payment goes straight to ${store.display_name}’s wallet. Selly never holds your money. Keep this link: it shows your order’s progress.`,
              )}
            </p>
          </aside>
        </main>
      </div>
    </LangProvider>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-d-ink-soft">{label}</dt>
      <dd className="tnum">{value}</dd>
    </div>
  );
}
