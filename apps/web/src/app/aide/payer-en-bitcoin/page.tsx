import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Eyebrow, PageShell } from '@/components/brand/page-shell';

export const metadata: Metadata = {
  title: 'Payer en bitcoin : le guide',
  description:
    'Ce qu’est le bitcoin, pourquoi payer avec sur Selly, et comment en obtenir au Sénégal avec Orange Money ou Wave. Le guide pas à pas.',
};

// The help page the payment page links to (« Pas de bitcoin ? »), and the footer's « Get bitcoin » (architecture.md
// 3.9, step 1: no integration yet, the customer gets bitcoin elsewhere and comes back to pay). Written in French, for
// the customers who land here from a shop; the frame around it (PageShell) is the site's English one.

const SECTIONS = [
  ['quoi', 'Le bitcoin, c’est quoi ?'],
  ['pourquoi', 'Pourquoi payer en bitcoin'],
  ['obtenir', 'Obtenir du bitcoin'],
  ['payer', 'Payer une commande'],
  ['vendeurs', 'Pour les vendeurs'],
  ['prudence', 'Les bons réflexes'],
  ['questions', 'Questions fréquentes'],
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
      <article lang="fr" className="max-w-7xl mx-auto w-full border-x border-[#1111111f]">
        <header className="px-6 md:px-12 pt-16 md:pt-24 pb-14 border-b border-[#1111111f]">
          <Eyebrow>Guide · 7 minutes de lecture</Eyebrow>
          <h1 className="pv-serif text-5xl md:text-7xl lg:text-8xl font-light leading-[0.95] tracking-[-0.02em] max-w-4xl">
            Payer en bitcoin, <span className="italic text-[#8AAE4A]">sans détour.</span>
          </h1>
          <p className="pv-sans mt-8 max-w-2xl text-base md:text-lg leading-relaxed text-black/70">
            Sur Selly, vous payez les boutiques en bitcoin, directement dans le portefeuille du
            vendeur. Pas encore de bitcoin ? Voici ce que c’est, pourquoi c’est pratique, et comment
            en obtenir avec Orange Money ou Wave en quelques minutes.
          </p>
        </header>

        <div className="grid lg:grid-cols-[16rem_1fr] gap-12 px-6 md:px-12 py-14 md:py-20">
          <nav aria-label="Sommaire" className="hidden lg:block">
            <div className="sticky top-28">
              <p className="pv-sans text-[10px] uppercase tracking-[0.3em] text-black/50 mb-4">
                Sommaire
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
            <Section id="quoi" n={1} title="Le bitcoin, c’est quoi ?">
              <p>
                Le bitcoin est une monnaie numérique qui n’appartient à aucune banque ni à aucun
                État. Elle circule directement de personne à personne, sur Internet, à n’importe
                quelle heure. On la garde dans une application sur son téléphone : un{' '}
                <strong className="text-[#173B32]">portefeuille</strong> (en anglais, un « wallet
                »).
              </p>
              <p>
                Un bitcoin se divise en 100 millions de{' '}
                <strong className="text-[#173B32]">sats</strong> (satoshis). Pour vos achats, vous
                paierez quelques milliers ou dizaines de milliers de sats. Le prix est toujours
                affiché en FCFA dans la boutique : le montant en sats est calculé au moment du
                paiement.
              </p>
              <p>
                Les paiements passent par <strong className="text-[#173B32]">Lightning</strong>, le
                réseau rapide du bitcoin : ils arrivent en quelques secondes et coûtent quelques
                francs de frais au plus. C’est ce réseau qu’utilisent les factures Selly.
              </p>
            </Section>

            <Section id="pourquoi" n={2} title="Pourquoi payer en bitcoin">
              <ul className="grid sm:grid-cols-2 gap-4 !mt-6">
                {[
                  [
                    'Direct au vendeur',
                    'Votre argent va dans le portefeuille de la boutique. Selly ne le touche jamais.',
                  ],
                  [
                    'En quelques secondes',
                    'Le vendeur voit le paiement aussitôt et prépare votre commande.',
                  ],
                  [
                    'Presque sans frais',
                    'Quelques francs sur Lightning, quel que soit le montant.',
                  ],
                  ['Sans compte bancaire', 'Un téléphone suffit, de Dakar comme de la diaspora.'],
                ].map(([t, d]) => (
                  <li key={t} className="border border-[#1111111f] p-5">
                    <span className="block pv-serif text-2xl text-[#173B32]">{t}</span>
                    <span className="mt-1 block text-sm">{d}</span>
                  </li>
                ))}
              </ul>
              <p>
                Le cours du bitcoin bouge, parfois beaucoup. Pour un achat, cela compte peu : le
                montant est fixé en FCFA quand vous commandez, et vous ne gardez les sats que le
                temps de payer. Si vous en gardez plus longtemps, n’y mettez que ce que vous pouvez
                vous permettre de voir varier.
              </p>
            </Section>

            <Section id="obtenir" n={3} title="Obtenir du bitcoin">
              <p>
                Deux étapes : une application pour recevoir et payer, puis quelques sats achetés en
                FCFA.
              </p>

              <h3 className="pv-serif text-3xl !mt-8">1. Installer un portefeuille Lightning</h3>
              <p>Gratuits, en français ou en anglais, sur Android et iPhone. Un seul suffit :</p>
              <div className="grid sm:grid-cols-2 gap-4">
                <Pick name="Wallet of Satoshi" href="https://www.walletofsatoshi.com">
                  Le plus simple pour commencer : rien à configurer. L’application garde vos sats
                  pour vous.
                </Pick>
                <Pick name="Phoenix" href="https://phoenix.acinq.co">
                  Vous gardez vous-même vos sats, avec une phrase de secours. Un peu plus de frais
                  au premier dépôt.
                </Pick>
                <Pick name="Blink" href="https://www.blink.sv">
                  Pensé pour payer au quotidien, avec un compte en dollars stables en option.
                </Pick>
                <Pick name="Breez" href="https://breez.technology">
                  Vous gardez vos sats, interface claire, pour qui veut aller plus loin.
                </Pick>
              </div>

              <h3 className="pv-serif text-3xl !mt-10">
                2. Acheter des sats avec Orange Money ou Wave
              </h3>
              <div className="grid sm:grid-cols-2 gap-4">
                <Pick name="Banxaas" href="https://banxaas.com">
                  Plateforme sénégalaise : vous payez en FCFA par Orange Money ou Wave et recevez
                  des sats dans votre portefeuille.
                </Pick>
                <Pick name="Échange entre particuliers (P2P)" href="https://p2p.binance.com/fr">
                  Des vendeurs proposent des sats contre Orange Money ou Wave. Choisissez des
                  vendeurs bien notés, et ne payez qu’à travers la plateforme.
                </Pick>
              </div>
              <p>
                Le plus simple reste parfois de demander à un proche qui a déjà du bitcoin de vous
                en envoyer : donnez-lui une facture ou votre adresse de réception, et remboursez-le
                en FCFA.
              </p>
            </Section>

            <Section id="payer" n={4} title="Payer une commande">
              <ol className="space-y-6 !mt-6">
                <Step n={1} title="Commandez dans la boutique">
                  Choisissez vos articles et la livraison. Vous arrivez sur la page de paiement,
                  avec le montant en FCFA et en sats.
                </Step>
                <Step n={2} title="Ouvrez votre portefeuille">
                  Sur le téléphone, touchez « Ouvrir mon portefeuille ». Depuis un ordinateur,
                  scannez le code QR avec l’application.
                </Step>
                <Step n={3} title="Confirmez">
                  Vérifiez le montant et validez. En quelques secondes, la page affiche « Paiement
                  reçu » et le vendeur est prévenu.
                </Step>
              </ol>
              <p>
                Gardez le lien de la page de paiement : il montre l’état de votre commande jusqu’à
                la livraison. Une facture reste valable un temps limité ; si elle expire, repassez
                commande, le prix sera recalculé.
              </p>
            </Section>

            <Section id="vendeurs" n={5} title="Pour les vendeurs">
              <p>
                Votre boutique Selly reçoit les paiements dans votre propre portefeuille, relié par
                Nostr Wallet Connect (NWC). Des portefeuilles compatibles :{' '}
                <Out href="https://getalby.com">Alby Hub</Out>,{' '}
                <Out href="https://coinos.io">Coinos</Out> ou{' '}
                <Out href="https://primal.net">Primal</Out>. La page Portefeuille du tableau de bord
                vous guide pour le relier.
              </p>
              <p>
                Pour retrouver des FCFA, revendez vos sats contre Orange Money ou Wave, par exemple
                sur <Out href="https://banxaas.com">Banxaas</Out>. Votre abonnement Selly se paie
                aussi en sats, depuis le même portefeuille.
              </p>
            </Section>

            <Section id="prudence" n={6} title="Les bons réflexes">
              <ul className="list-disc pl-5 space-y-2 marker:text-[#8AAE4A]">
                <li>
                  Si votre portefeuille vous donne une{' '}
                  <strong className="text-[#173B32]">phrase de secours</strong> (12 ou 24 mots),
                  écrivez-la sur papier et rangez-la. Sans elle, un téléphone perdu, ce sont des
                  sats perdus.
                </li>
                <li>
                  Ne donnez jamais cette phrase à personne. Ni Selly ni un vendeur ne vous la
                  demandera.
                </li>
                <li>
                  Commencez petit : achetez ce dont vous avez besoin pour une commande ou deux.
                </li>
                <li>
                  Un paiement bitcoin ne s’annule pas : vérifiez le montant et la boutique avant de
                  valider.
                </li>
                <li>
                  Méfiez-vous des promesses de gains rapides : ce sont presque toujours des
                  arnaques.
                </li>
              </ul>
            </Section>

            <Section id="questions" n={7} title="Questions fréquentes">
              <div className="!mt-2">
                <Faq q="Selly garde-t-il mon argent ?">
                  Non. Le paiement va directement de votre portefeuille à celui du vendeur. Selly
                  crée la facture et suit la commande, sans jamais détenir les fonds.
                </Faq>
                <Faq q="Et si le cours change pendant que je paie ?">
                  Le montant en sats est fixé pour la durée de la facture. Si elle expire avant le
                  paiement, une nouvelle commande recalcule le montant au cours du moment.
                </Faq>
                <Faq q="Mon paiement n’apparaît pas.">
                  Patientez quelques secondes, puis touchez « J’ai payé, actualiser » sur la page de
                  paiement. Si votre portefeuille indique que le paiement est parti et que la page
                  ne bouge pas, écrivez au vendeur depuis cette même page.
                </Faq>
                <Faq q="Faut-il un compte bancaire ou une pièce d’identité ?">
                  Pas pour un portefeuille Lightning. Les plateformes d’achat de bitcoin peuvent en
                  revanche vérifier votre identité, selon le montant.
                </Faq>
                <Faq q="Je veux en savoir plus sur le bitcoin.">
                  <Out href="https://bitcoin.org/fr/">bitcoin.org</Out> explique le fonctionnement
                  en détail, en français.
                </Faq>
              </div>
            </Section>

            <div className="mt-16 border border-[#173B32] p-8 md:p-10 bg-[#173B32] text-[#F6F4F0]">
              <p className="pv-serif text-3xl md:text-4xl font-light">Prêt à payer ?</p>
              <p className="pv-sans mt-3 text-[15px] leading-relaxed text-[#F6F4F0]/75">
                Revenez à votre page de paiement : son lien est dans votre navigateur, ou
                demandez-le au vendeur. Vous vendez en ligne ? Ouvrez votre boutique Selly en
                quelques minutes.
              </p>
              <Link
                href="/app/login"
                className="mt-6 inline-block pv-sans text-xs uppercase tracking-[0.2em] font-medium border border-[#F6F4F0] px-6 py-4 hover:bg-[#F6F4F0] hover:text-[#173B32] transition-colors"
              >
                Créer ma boutique
              </Link>
            </div>
          </div>
        </div>
      </article>
    </PageShell>
  );
}
