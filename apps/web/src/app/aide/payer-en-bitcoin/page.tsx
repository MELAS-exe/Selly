import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Eyebrow, PageShell } from '@/components/brand/page-shell';

export const metadata: Metadata = {
  title: 'Paying with bitcoin: the guide',
  description:
    'What bitcoin is, why pay with it on Selly, and how to get some in Senegal with Orange Money or Wave. A step-by-step guide.',
};

// The help page the payment page links to (« Pas de bitcoin ? »), and the footer's « Get bitcoin » (architecture.md
// 3.9, step 1: no integration yet, the customer gets bitcoin elsewhere and comes back to pay). In English, like the
// rest of the public site (PageShell).

const SECTIONS = [
  ['what', 'What is bitcoin?'],
  ['why', 'Why pay with bitcoin'],
  ['get', 'Getting bitcoin'],
  ['pay', 'Paying for an order'],
  ['vendors', 'For vendors'],
  ['safety', 'Staying safe'],
  ['faq', 'Common questions'],
] as const;

/** A link out of Selly: new tab, no referrer. */
function Out({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline decoration-[#8AAE4A] decoration-2 underline-offset-4 hover:text-[#719541] transition-colors"
    >
      {children}
    </a>
  );
}

function Section({
  id,
  n,
  title,
  children,
}: {
  id: string;
  n: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-28 border-t border-[#1111111f] pt-12 mt-12 first:mt-0 first:border-0 first:pt-0"
    >
      <p className="pv-sans text-xs uppercase tracking-[0.3em] font-medium text-[#E3342F] mb-3">
        {String(n).padStart(2, '0')}
      </p>
      <h2 className="pv-serif text-4xl md:text-5xl font-light leading-tight mb-6">{title}</h2>
      <div className="pv-sans text-[15px] md:text-base leading-relaxed text-black/75 space-y-4">
        {children}
      </div>
    </section>
  );
}

/** A wallet or service, with what it is good for. */
function Pick({ name, href, children }: { name: string; href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group block border border-[#1111111f] p-5 bg-[#F6F4F0] hover:border-[#173B32] transition-colors"
    >
      <span className="flex items-center justify-between gap-3">
        <span className="pv-serif text-2xl">{name}</span>
        <span
          aria-hidden="true"
          className="text-[#719541] transition-transform group-hover:translate-x-1"
        >
          ↗
        </span>
      </span>
      <span className="mt-2 block pv-sans text-sm leading-relaxed text-black/65">{children}</span>
    </a>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[2.5rem_1fr] gap-4">
      <span className="pv-serif grid size-10 place-items-center border border-[#173B32] text-xl">
        {n}
      </span>
      <span>
        <span className="block pv-sans font-medium text-[#173B32]">{title}</span>
        <span className="mt-1 block">{children}</span>
      </span>
    </li>
  );
}

function Faq({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="group border-b border-[#1111111f] py-5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 pv-serif text-2xl">
        {q}
        <span
          aria-hidden="true"
          className="pv-sans text-xl text-[#719541] transition-transform group-open:rotate-45"
        >
          +
        </span>
      </summary>
      <div className="mt-3 pv-sans text-[15px] leading-relaxed text-black/70">{children}</div>
    </details>
  );
}

export default function Page() {
  return (
    <PageShell>
      <article className="max-w-7xl mx-auto w-full border-x border-[#1111111f]">
        <header className="px-6 md:px-12 pt-16 md:pt-24 pb-14 border-b border-[#1111111f]">
          <Eyebrow>Guide · 7 minute read</Eyebrow>
          <h1 className="pv-serif text-5xl md:text-7xl lg:text-8xl font-light leading-[0.95] tracking-[-0.02em] max-w-4xl">
            Paying with bitcoin, <span className="italic text-[#8AAE4A]">made simple.</span>
          </h1>
          <p className="pv-sans mt-8 max-w-2xl text-base md:text-lg leading-relaxed text-black/70">
            On Selly, you pay shops in bitcoin, straight into the vendor’s wallet. No bitcoin yet?
            Here is what it is, why it is handy, and how to get some with Orange Money or Wave in a
            few minutes.
          </p>
        </header>

        <div className="grid lg:grid-cols-[16rem_1fr] gap-12 px-6 md:px-12 py-14 md:py-20">
          <nav aria-label="Contents" className="hidden lg:block">
            <div className="sticky top-28">
              <p className="pv-sans text-[10px] uppercase tracking-[0.3em] text-black/50 mb-4">
                Contents
              </p>
              <ol className="space-y-3 pv-sans text-sm">
                {SECTIONS.map(([id, label], i) => (
                  <li key={id}>
                    <a
                      href={`#${id}`}
                      className="flex gap-3 text-black/65 hover:text-[#173B32] transition-colors"
                    >
                      <span className="text-[#719541] tabular-nums">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      {label}
                    </a>
                  </li>
                ))}
              </ol>
            </div>
          </nav>

          <div className="max-w-2xl">
            <Section id="what" n={1} title="What is bitcoin?">
              <p>
                Bitcoin is a digital currency that belongs to no bank and no government. It moves
                directly from person to person, over the Internet, at any hour. You keep it in an
                app on your phone: a <strong className="text-[#173B32]">wallet</strong>.
              </p>
              <p>
                One bitcoin divides into 100 million{' '}
                <strong className="text-[#173B32]">sats</strong> (satoshis). For your purchases, you
                will pay a few thousand to a few tens of thousands of sats. Shops always show prices
                in FCFA: the amount in sats is worked out when you pay.
              </p>
              <p>
                Payments go over <strong className="text-[#173B32]">Lightning</strong>, bitcoin’s
                fast network: they arrive in seconds and cost a few francs in fees at most. Selly’s
                invoices use this network.
              </p>
            </Section>

            <Section id="why" n={2} title="Why pay with bitcoin">
              <ul className="grid sm:grid-cols-2 gap-4 !mt-6">
                {[
                  [
                    'Straight to the vendor',
                    'Your money goes into the shop’s wallet. Selly never touches it.',
                  ],
                  ['In seconds', 'The vendor sees the payment at once and prepares your order.'],
                  ['Almost no fees', 'A few francs on Lightning, whatever the amount.'],
                  ['No bank account needed', 'A phone is enough, from Dakar or abroad.'],
                ].map(([t, d]) => (
                  <li key={t} className="border border-[#1111111f] p-5">
                    <span className="block pv-serif text-2xl text-[#173B32]">{t}</span>
                    <span className="mt-1 block text-sm">{d}</span>
                  </li>
                ))}
              </ul>
              <p>
                The price of bitcoin moves, sometimes a lot. For a purchase, that matters little:
                the amount is set in FCFA when you order, and you only hold the sats long enough to
                pay. If you keep some for longer, only put in what you can afford to see go up and
                down.
              </p>
            </Section>

            <Section id="get" n={3} title="Getting bitcoin">
              <p>Two steps: an app to receive and pay, then a few sats bought with FCFA.</p>

              <h3 className="pv-serif text-3xl !mt-8">1. Install a Lightning wallet</h3>
              <p>All free, on Android and iPhone. One is enough:</p>
              <div className="grid sm:grid-cols-2 gap-4">
                <Pick name="Wallet of Satoshi" href="https://www.walletofsatoshi.com">
                  The simplest way to start: nothing to set up. The app holds your sats for you.
                </Pick>
                <Pick name="Phoenix" href="https://phoenix.acinq.co">
                  You hold your sats yourself, with a recovery phrase. A slightly higher fee on the
                  first deposit.
                </Pick>
                <Pick name="Blink" href="https://www.blink.sv">
                  Made for everyday payments, with an optional stable dollar account.
                </Pick>
                <Pick name="Breez" href="https://breez.technology">
                  You hold your sats, with a clear interface, for those who want to go further.
                </Pick>
              </div>

              <h3 className="pv-serif text-3xl !mt-10">2. Buy sats with Orange Money or Wave</h3>
              <div className="grid sm:grid-cols-2 gap-4">
                <Pick name="Banxaas" href="https://banxaas.com">
                  A Senegalese platform: you pay in FCFA with Orange Money or Wave and receive sats
                  in your wallet.
                </Pick>
                <Pick name="Peer-to-peer exchange (P2P)" href="https://p2p.binance.com/en">
                  Sellers offer sats for Orange Money or Wave. Pick well-rated sellers, and only pay
                  through the platform.
                </Pick>
              </div>
              <p>
                Sometimes the simplest is to ask someone close who already has bitcoin to send you
                some: give them an invoice or your receiving address, and pay them back in FCFA.
              </p>
            </Section>

            <Section id="pay" n={4} title="Paying for an order">
              <ol className="space-y-6 !mt-6">
                <Step n={1} title="Order in the shop">
                  Choose your items and the delivery. You reach the payment page, with the amount in
                  FCFA and in sats.
                </Step>
                <Step n={2} title="Open your wallet">
                  On your phone, tap « Ouvrir mon portefeuille » (open my wallet). From a computer,
                  scan the QR code with the app.
                </Step>
                <Step n={3} title="Confirm">
                  Check the amount and approve. Within seconds, the page shows « Paiement reçu »
                  (payment received) and the vendor is notified.
                </Step>
              </ol>
              <p>
                Keep the link to the payment page: it shows your order’s status until delivery. An
                invoice is valid for a limited time; if it expires, order again and the price is
                worked out afresh.
              </p>
            </Section>

            <Section id="vendors" n={5} title="For vendors">
              <p>
                Your Selly shop receives payments in your own wallet, linked with Nostr Wallet
                Connect (NWC). Compatible wallets include{' '}
                <Out href="https://getalby.com">Alby Hub</Out>,{' '}
                <Out href="https://coinos.io">Coinos</Out> and{' '}
                <Out href="https://primal.net">Primal</Out>. The Wallet page of the dashboard walks
                you through linking it.
              </p>
              <p>
                To get FCFA back, sell your sats for Orange Money or Wave, for example on{' '}
                <Out href="https://banxaas.com">Banxaas</Out>. Your Selly subscription is paid in
                sats too, from the same wallet.
              </p>
            </Section>

            <Section id="safety" n={6} title="Staying safe">
              <ul className="list-disc pl-5 space-y-2 marker:text-[#8AAE4A]">
                <li>
                  If your wallet gives you a{' '}
                  <strong className="text-[#173B32]">recovery phrase</strong> (12 or 24 words),
                  write it on paper and keep it safe. Without it, a lost phone means lost sats.
                </li>
                <li>
                  Never give that phrase to anyone. Neither Selly nor a vendor will ever ask for it.
                </li>
                <li>Start small: buy what you need for an order or two.</li>
                <li>
                  A bitcoin payment cannot be reversed: check the amount and the shop before you
                  approve.
                </li>
                <li>Beware of promises of quick gains: they are almost always scams.</li>
              </ul>
            </Section>

            <Section id="faq" n={7} title="Common questions">
              <div className="!mt-2">
                <Faq q="Does Selly hold my money?">
                  No. The payment goes straight from your wallet to the vendor’s. Selly creates the
                  invoice and follows the order, without ever holding the funds.
                </Faq>
                <Faq q="What if the price changes while I pay?">
                  The amount in sats is fixed for as long as the invoice is valid. If it expires
                  before you pay, a new order works out the amount at the current rate.
                </Faq>
                <Faq q="My payment doesn’t show up.">
                  Wait a few seconds, then tap « J’ai payé, actualiser » (I have paid, refresh) on
                  the payment page. If your wallet says the payment went through and the page does
                  not change, write to the vendor from that same page.
                </Faq>
                <Faq q="Do I need a bank account or an ID?">
                  Not for a Lightning wallet. Platforms that sell bitcoin may check your identity,
                  depending on the amount.
                </Faq>
                <Faq q="I want to learn more about bitcoin.">
                  <Out href="https://bitcoin.org/en/">bitcoin.org</Out> explains how it works in
                  detail.
                </Faq>
              </div>
            </Section>

            <div className="mt-16 border border-[#173B32] p-8 md:p-10 bg-[#173B32] text-[#F6F4F0]">
              <p className="pv-serif text-3xl md:text-4xl font-light">Ready to pay?</p>
              <p className="pv-sans mt-3 text-[15px] leading-relaxed text-[#F6F4F0]/75">
                Go back to your payment page: its link is in your browser, or ask the vendor for it.
                Selling online? Open your Selly shop in a few minutes.
              </p>
              <Link
                href="/app/login"
                className="mt-6 inline-block pv-sans text-xs uppercase tracking-[0.2em] font-medium border border-[#F6F4F0] px-6 py-4 hover:bg-[#F6F4F0] hover:text-[#173B32] transition-colors"
              >
                Create my shop
              </Link>
            </div>
          </div>
        </div>
      </article>
    </PageShell>
  );
}
