'use client';

// Portefeuille (architecture.md 3.6): the vendor's own Lightning wallet, linked with a receive-only Nostr Wallet
// Connect link (the same flow as the onboarding). Core checks the link's permissions, keeps it encrypted and
// never shows it again. Customer payments go straight into this wallet; Selly holds nothing.

import Link from 'next/link';
import { useState } from 'react';
import { ApiError } from '@/lib/browser-api';
import { useT } from '../../lang';
import { useDashboard, useResource } from '../data';
import { fmtAgo, fmtInt, fmtWhen, fmtXof } from '../format';
import { ArrowDownLeft, Bitcoin, Link2, TriangleAlert } from '../icons';
import type { BtcXofRate, Page, VendorOrder, Wallet } from '../types';
import { Empty, InfoRow, Loading, Modal, PageTitle, PanelHead } from '../ui';

export function WalletPage() {
  const t = useT();
  const { mutate } = useDashboard();
  const wallet = useResource<Wallet>('/vendors/me/wallet');
  const rate = useResource<BtcXofRate>('/rates/btc-xof');
  const paid = useResource<Page<VendorOrder>>('/orders?status=paid');
  const shipped = useResource<Page<VendorOrder>>('/orders?status=fulfilled');
  const [linking, setLinking] = useState(false);
  const [unlinking, setUnlinking] = useState(false);

  const missing = wallet.error instanceof ApiError && wallet.error.problem.status === 404;
  const w = wallet.data;
  const received = [...(paid.data?.data ?? []), ...(shipped.data?.data ?? [])]
    .filter((o) => o.paid_at)
    .sort((a, b) => (b.paid_at ?? '').localeCompare(a.paid_at ?? ''))
    .slice(0, 6);

  if (!w && !missing && !wallet.error) return <Loading rows={4} />;

  return (
    <>
      <PageTitle
        eyebrow="Bitcoin · Lightning"
        title={t('Portefeuille', 'Wallet')}
        description={t(
          'Les paiements des clients vont directement dans votre portefeuille. Selly ne détient pas ces fonds.',
          'Customer payments go straight into your wallet. Selly never holds these funds.',
        )}
        action={
          <button type="button" className="button primary" onClick={() => setLinking(true)}>
            <Link2 size={14} />
            {w
              ? t('Remplacer le portefeuille', 'Replace the wallet')
              : t('Lier un portefeuille', 'Link a wallet')}
          </button>
        }
      />
      {w?.status === 'degraded' && (
        <div className="banner alert" role="alert">
          <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <TriangleAlert size={16} />
            Votre portefeuille ne répond plus{w.last_error ? ` (${w.last_error})` : ''}. Ouvrez
            l’application du portefeuille et vérifiez qu’elle est en ligne.
          </span>
        </div>
      )}
      <div className="wallet-page-grid">
        <section className="panel wallet-hero">
          <img className="stamp" src="/brand/selly-s-light.png" alt="" aria-hidden="true" />
          <div className="wallet-tag">
            <Bitcoin size={15} />{' '}
            {w
              ? t('Portefeuille en réception uniquement', 'Receive-only wallet')
              : t('Aucun portefeuille lié', 'No wallet linked')}
          </div>
          <div className="wallet-amount">
            {w?.balance_sat !== null && w?.balance_sat !== undefined ? fmtInt(w.balance_sat) : '—'}{' '}
            <span style={{ fontSize: 16 }}>sats</span>
          </div>
          <div className="wallet-sats">
            {w?.balance_sat != null && rate.data
              ? `≈ ${fmtXof(Math.round(w.balance_sat * rate.data.xof_per_sat))} · ${t('estimation indicative', 'rough estimate')}`
              : w
                ? t(
                    'Ce portefeuille ne partage pas son solde',
                    'This wallet does not share its balance',
                  )
                : t(
                    'Sans portefeuille, la boutique ne peut pas encaisser.',
                    'Without a wallet, the shop cannot be paid.',
                  )}
          </div>
          {w ? (
            <button type="button" className="button" onClick={() => setUnlinking(true)}>
              {t('Délier', 'Unlink')}
            </button>
          ) : (
            <button type="button" className="button olive" onClick={() => setLinking(true)}>
              {t('Lier mon portefeuille', 'Link my wallet')}
            </button>
          )}
        </section>
        <section className="panel">
          <PanelHead
            title={t('La liaison', 'The link')}
            sub={t('Ce qu’elle permet, et ne permet pas', 'What it allows, and what it does not')}
          />
          <div className="info-list">
            <InfoRow
              label={t('État', 'Status')}
              value={
                !w
                  ? t('Non lié', 'Not linked')
                  : w.status === 'active'
                    ? t('Connecté', 'Connected')
                    : w.status === 'degraded'
                      ? t('Ne répond plus', 'Not answering')
                      : t('Révoqué', 'Revoked')
              }
            />
            {w && (
              <InfoRow
                label="Type"
                value={
                  w.kind === 'nwc'
                    ? 'Nostr Wallet Connect'
                    : t('Adresse Lightning', 'Lightning address')
                }
              />
            )}
            {w?.lud16 && (
              <InfoRow label={t('Adresse de secours', 'Backup address')} value={w.lud16} />
            )}
            <InfoRow label={t('Réception', 'Receiving')} value={w ? t('Activée', 'On') : '—'} />
            <InfoRow
              label={t('Envoi depuis Selly', 'Sending from Selly')}
              value={t('Impossible : réception seule', 'Impossible: receive only')}
            />
            <InfoRow
              label={t('Fonds détenus par Selly', 'Funds held by Selly')}
              value={t('Aucun', 'None')}
            />
            {w && (
              <InfoRow
                label={t('Dernière vérification', 'Last check')}
                value={fmtAgo(w.checked_at)}
              />
            )}
          </div>
        </section>
        <section className="panel">
          <PanelHead
            title={t('Paiements reçus', 'Payments received')}
            sub={t('Les dernières commandes payées', 'The latest paid orders')}
          />
          {received.length === 0 ? (
            <Empty
              icon={ArrowDownLeft}
              title={t('Aucun paiement pour l’instant', 'No payments yet')}
              text={t('Les commandes payées s’afficheront ici.', 'Paid orders will show here.')}
            />
          ) : (
            <div className="info-list">
              {received.map((o) => (
                <InfoRow
                  key={o.id}
                  label={
                    <Link
                      href={`/app/commandes/${o.id}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      <ArrowDownLeft size={14} /> {o.number} · {o.customer.display_name}
                      <span className="table-secondary" style={{ margin: 0 }}>
                        {fmtWhen(o.paid_at as string)}
                      </span>
                    </Link>
                  }
                  value={`+ ${fmtInt(o.total_sat)} sats`}
                />
              ))}
            </div>
          )}
        </section>
        <section className="panel">
          <PanelHead
            title={t('À propos du solde', 'About the balance')}
            sub={t('Une estimation pour vous repérer', 'An estimate to find your way')}
          />
          <div
            style={{ padding: '18px 22px', fontSize: 13, lineHeight: 1.65, color: 'var(--ink-70)' }}
          >
            {t(
              'Le montant en FCFA est indicatif et suit le cours du bitcoin. Pour vérifier un paiement ou rembourser un client, utilisez directement votre portefeuille : Selly ne déclenche ni remboursement ni transfert.',
              'The FCFA amount is a guide and follows the bitcoin price. To check a payment or refund a customer, use your wallet directly: Selly makes no refunds or transfers.',
            )}{' '}
            <a className="text-link" href="/aide/payer-en-bitcoin" target="_blank" rel="noreferrer">
              {t('Obtenir et vendre des bitcoins', 'Getting and selling bitcoin')}
            </a>
          </div>
        </section>
      </div>
      {linking && <LinkModal replacing={!!w} onClose={() => setLinking(false)} />}
      {unlinking && (
        <Modal title="Délier le portefeuille" onClose={() => setUnlinking(false)}>
          <p className="modal-copy">
            Sans portefeuille, la boutique passe hors ligne : les clients ne peuvent plus payer. Vos
            fonds restent dans votre portefeuille, Selly n’y touche pas.
          </p>
          <div className="modal-actions">
            <button type="button" className="button" onClick={() => setUnlinking(false)}>
              Garder
            </button>
            <button
              type="button"
              className="button danger"
              onClick={() =>
                mutate('/vendors/me/wallet', { method: 'DELETE' }, 'Portefeuille délié.').then(
                  () => setUnlinking(false),
                  () => {},
                )
              }
            >
              Délier
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function LinkModal({ replacing, onClose }: { replacing: boolean; onClose: () => void }) {
  const { mutate } = useDashboard();
  const [uri, setUri] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={replacing ? 'Remplacer le portefeuille' : 'Lier votre portefeuille'}
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const value = uri.trim();
          if (!value.startsWith('nostr+walletconnect://')) {
            setLocal(
              'Un lien de connexion commence par nostr+walletconnect://. Copiez-le à nouveau depuis votre portefeuille.',
            );
            return;
          }
          setLocal(null);
          setBusy(true);
          try {
            await mutate(
              '/vendors/me/wallet',
              { method: 'PUT', body: { kind: 'nwc', uri: value } },
              'Portefeuille lié et vérifié.',
            );
            onClose();
          } catch {
            setBusy(false);
          }
        }}
      >
        <p className="modal-copy">
          Dans votre portefeuille, ouvrez « Nostr Wallet Connect » (ou « Connexions »), créez une
          connexion <b>réception seulement</b>, puis collez le lien ici. Selly vérifie qu’il ne peut
          pas dépenser, le garde chiffré et ne l’affiche plus jamais.
        </p>
        <label className="form-label" htmlFor="nwc-uri">
          Lien de connexion
        </label>
        <textarea
          id="nwc-uri"
          className="form-control"
          rows={3}
          value={uri}
          onChange={(e) => setUri(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="nostr+walletconnect://…"
        />
        {local && <p className="form-error">{local}</p>}
        {replacing && (
          <p className="form-hint">
            Remplacer un portefeuille peut demander de confirmer avec votre clé Nostr.
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="button primary" disabled={busy || !uri.trim()}>
            {busy ? 'Vérification…' : 'Lier'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
