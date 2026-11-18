'use client';

// Selling in a discussion (architecture.md 6.6): when the vendor has the chat, they show products as cards and make
// the order the customer agreed to, as the agent would. The order goes to the customer as an order card; its
// « Payer » opens the payment page. Totals come from core only (POST /conversations/{id}/quotes).

import { useEffect, useMemo, useState } from 'react';
import { ApiError } from '@/lib/browser-api';
import type { ChatCard } from '@/lib/chat-types';
import { toE164 } from '@/lib/format';
import { errorText, newKey, useDashboard, useResource } from './data';
import { fmtXof, formatOptions } from './format';
import { Package, Plus, Search, X } from './icons';
import type { ConversationSummary, Money, Page, VendorProduct } from './types';
import { Modal } from './ui';

const useActiveProducts = () =>
  useResource<Page<VendorProduct>>('/inventory?status=active&limit=100');

/** Cards in a thread bubble, as the customer sees them: products with price, the order with its state. */
export function ThreadCards({ cards }: { cards: ChatCard[] }) {
  if (cards.length === 0) return null;
  return (
    <div className="thread-cards">
      {cards.map((c) =>
        c.type === 'product' ? (
          <a
            key={c.product_id}
            className="thread-card"
            href={c.url}
            target="_blank"
            rel="noreferrer"
          >
            {c.image_url ? <img src={c.image_url} alt="" /> : <Package size={18} />}
            <span>
              <b>{c.title}</b>
              {fmtXof(c.price.amount)}
            </span>
          </a>
        ) : (
          <a
            key={c.number}
            className="thread-card"
            href={c.checkout_url}
            target="_blank"
            rel="noreferrer"
          >
            <span>
              <b>Commande {c.number}</b>
              {fmtXof(c.total.amount)} · {c.status === 'paid' ? 'payée' : 'à payer'}
            </span>
          </a>
        ),
      )}
    </div>
  );
}

/** Up to three products, sent as cards with an optional word. */
export function ShowProducts({
  chat,
  onClose,
}: {
  chat: ConversationSummary;
  onClose: () => void;
}) {
  const { mutate } = useDashboard();
  const products = useActiveProducts();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const list = (products.data?.data ?? []).filter((p) =>
    p.title.toLowerCase().includes(q.trim().toLowerCase()),
  );

  async function send() {
    setBusy(true);
    try {
      await mutate(
        `/conversations/${chat.id}/messages`,
        {
          method: 'POST',
          body: {
            client_message_id: newKey(),
            product_ids: picked,
            ...(text.trim() ? { text: text.trim() } : {}),
          },
        },
        picked.length > 1 ? 'Produits envoyés au client.' : 'Produit envoyé au client.',
      );
      onClose();
    } catch {
      setBusy(false);
    }
  }

  return (
    <Modal title="Montrer des produits" onClose={onClose}>
      <p className="modal-copy">
        Le client les voit en fiches, avec photo, prix et lien. Trois au plus.
      </p>
      <label className="search-wrap" style={{ marginBottom: 10 }}>
        <Search size={14} />
        <input
          className="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Chercher un produit…"
          aria-label="Chercher un produit"
        />
      </label>
      <div className="pick-list">
        {list.map((p) => {
          const on = picked.includes(p.id);
          return (
            <label key={p.id} className={`pick-row${on ? ' on' : ''}`}>
              <input
                type="checkbox"
                checked={on}
                disabled={!on && picked.length >= 3}
                onChange={() =>
                  setPicked((all) => (on ? all.filter((x) => x !== p.id) : [...all, p.id]))
                }
              />
              {p.images[0] ? <img src={p.images[0].url} alt="" /> : <Package size={18} />}
              <span>
                <b>{p.title}</b>
                {fmtXof(p.price.amount)}
              </span>
            </label>
          );
        })}
        {products.data && list.length === 0 && <p className="form-hint">Aucun produit.</p>}
      </div>
      <label className="form-label" htmlFor="sp-text">
        Un mot, facultatif
      </label>
      <input
        id="sp-text"
        className="form-control"
        maxLength={1000}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Voici ce que j’ai en ce moment"
      />
      <div className="modal-actions">
        <button type="button" className="button" onClick={onClose}>
          Annuler
        </button>
        <button
          type="button"
          className="button primary"
          disabled={busy || picked.length === 0}
          onClick={send}
        >
          Envoyer
        </button>
      </div>
    </Modal>
  );
}

interface Line {
  variant_id: string;
  quantity: number;
}

interface Quote {
  subtotal: Money;
  delivery_fee: Money;
  discount: Money;
  total: Money;
}

/** The order the vendor and the customer agreed on: items, delivery, who; core's total; then the order card. */
export function MakeOrder({ chat, onClose }: { chat: ConversationSummary; onClose: () => void }) {
  const { request, mutate, vendor } = useDashboard();
  const products = useActiveProducts();
  const zones = vendor?.settings.delivery?.zones ?? [];
  const pickup = vendor?.settings.delivery?.pickup.available ?? false;
  const [lines, setLines] = useState<Line[]>([]);
  const [productId, setProductId] = useState('');
  const [variantId, setVariantId] = useState('');
  const [where, setWhere] = useState(zones[0]?.id ?? (pickup ? 'pickup' : ''));
  const [address, setAddress] = useState('');
  const [name, setName] = useState(chat.customer_label === 'Visiteur' ? '' : chat.customer_label);
  const [phone, setPhone] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One key per order being made: a double tap or a retry never makes two.
  const [key, setKey] = useState(newKey);
  // Bumped to ask core for the total again (after PRICE_CHANGED).
  const [requote, setRequote] = useState(0);

  const all = products.data?.data ?? [];
  const variantsOf = (id: string) => all.find((p) => p.id === id)?.variants ?? [];
  const describe = (vid: string) => {
    for (const p of all) {
      const v = p.variants.find((x) => x.id === vid);
      if (v) return { product: p, variant: v };
    }
    return null;
  };
  const delivery =
    where === 'pickup'
      ? { method: 'pickup' as const }
      : {
          method: 'delivery' as const,
          zone_id: where,
          ...(address.trim() ? { address_text: address.trim() } : {}),
        };
  const priced = useMemo(() => JSON.stringify({ lines, where, requote }), [lines, where, requote]);

  // Core's total for these lines and this place.
  useEffect(() => {
    const { lines: ls, where: w } = JSON.parse(priced) as { lines: Line[]; where: string };
    setQuote(null);
    if (ls.length === 0 || !w) return;
    let live = true;
    request<Quote>(`/conversations/${chat.id}/quotes`, {
      method: 'POST',
      body: {
        items: ls,
        delivery: w === 'pickup' ? { method: 'pickup' } : { method: 'delivery', zone_id: w },
      },
    }).then(
      (q) => {
        if (!live) return;
        setQuote(q);
        setProblem(null);
      },
      (err) => live && setProblem(errorText(err)),
    );
    return () => {
      live = false;
    };
  }, [priced, request, chat.id]);

  const e164 = toE164(phone);
  const ready =
    lines.length > 0 &&
    !!quote &&
    name.trim().length >= 2 &&
    !!e164 &&
    (where === 'pickup' || (!!where && !!address.trim()));

  async function send() {
    if (!ready || !quote) return;
    setBusy(true);
    try {
      await mutate(
        `/conversations/${chat.id}/orders`,
        {
          method: 'POST',
          idempotencyKey: key,
          body: {
            client_message_id: newKey(),
            customer: { display_name: name.trim(), phone_e164: e164 },
            items: lines,
            delivery,
            expected_total: quote.total,
          },
        },
        'Commande envoyée : le client peut payer depuis la discussion.',
      );
      onClose();
    } catch (err) {
      setBusy(false);
      setKey(newKey());
      if (err instanceof ApiError && err.problem.code === 'PRICE_CHANGED') {
        setProblem('Le prix a changé : vérifiez le nouveau total.');
        setRequote((n) => n + 1);
      }
    }
  }

  return (
    <Modal title="Créer une commande" onClose={onClose}>
      <p className="modal-copy">
        Ce que vous avez convenu avec le client. Il reçoit la commande dans la discussion et la paie
        depuis le bouton « Payer ».
      </p>

      <div className="form-label">Articles</div>
      {lines.map((l) => {
        const d = describe(l.variant_id);
        return (
          <div className="order-line" key={l.variant_id}>
            <span>
              <b>{d?.product.title ?? 'Article'}</b>
              {d && formatOptions(d.variant.options)}
            </span>
            <input
              className="form-control"
              type="number"
              min="1"
              max="50"
              aria-label="Quantité"
              value={l.quantity}
              onChange={(e) => {
                const n = Math.max(1, Math.min(50, Number(e.target.value) || 1));
                setLines((all) =>
                  all.map((x) => (x.variant_id === l.variant_id ? { ...x, quantity: n } : x)),
                );
              }}
            />
            <button
              type="button"
              className="button small ghost"
              aria-label={`Retirer ${d?.product.title ?? 'l’article'}`}
              onClick={() => setLines((all) => all.filter((x) => x.variant_id !== l.variant_id))}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
      <div className="order-add">
        <select
          className="form-control"
          aria-label="Produit"
          value={productId}
          onChange={(e) => {
            setProductId(e.target.value);
            const vs = variantsOf(e.target.value);
            setVariantId(vs.length === 1 ? (vs[0]?.id ?? '') : '');
          }}
        >
          <option value="">Choisir un produit…</option>
          {all.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title} · {fmtXof(p.price.amount)}
            </option>
          ))}
        </select>
        {variantsOf(productId).length > 1 && (
          <select
            className="form-control"
            aria-label="Taille ou variante"
            value={variantId}
            onChange={(e) => setVariantId(e.target.value)}
          >
            <option value="">Taille ou variante…</option>
            {variantsOf(productId).map((v) => (
              <option key={v.id} value={v.id} disabled={v.available <= 0}>
                {formatOptions(v.options) || 'Article unique'} ({v.available} dispo.)
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          className="button small"
          disabled={!variantId || lines.some((l) => l.variant_id === variantId)}
          onClick={() => {
            setLines((all) => [...all, { variant_id: variantId, quantity: 1 }]);
            setProductId('');
            setVariantId('');
          }}
        >
          <Plus size={12} /> Ajouter
        </button>
      </div>

      <label className="form-label" htmlFor="mo-where">
        Livraison
      </label>
      <select
        id="mo-where"
        className="form-control"
        value={where}
        onChange={(e) => setWhere(e.target.value)}
      >
        {zones.length === 0 && !pickup && (
          <option value="">Aucune zone : ajoutez-en dans Réglages</option>
        )}
        {zones.map((z) => (
          <option key={z.id} value={z.id}>
            {z.label} · {z.fee.amount ? fmtXof(z.fee.amount) : 'offerte'}
          </option>
        ))}
        {pickup && <option value="pickup">Retrait à la boutique</option>}
      </select>
      {where && where !== 'pickup' && (
        <input
          className="form-control"
          aria-label="Adresse de livraison"
          maxLength={300}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Adresse de livraison"
        />
      )}

      <div className="form-pair">
        <div>
          <label className="form-label" htmlFor="mo-name">
            Nom du client
          </label>
          <input
            id="mo-name"
            className="form-control"
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="form-label" htmlFor="mo-phone">
            Téléphone
          </label>
          <input
            id="mo-phone"
            className="form-control"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="77 123 45 67"
            aria-invalid={phone.trim() !== '' && !e164}
          />
        </div>
      </div>

      {quote && (
        <div className="info-list" style={{ padding: 0, marginTop: 12 }}>
          <div className="info-row">
            <span>Livraison</span>
            <b>{quote.delivery_fee.amount ? fmtXof(quote.delivery_fee.amount) : 'Offerte'}</b>
          </div>
          <div className="info-row">
            <span>Total</span>
            <b>{fmtXof(quote.total.amount)}</b>
          </div>
        </div>
      )}
      {problem && <p className="form-error">{problem}</p>}

      <div className="modal-actions">
        <button type="button" className="button" onClick={onClose}>
          Annuler
        </button>
        <button type="button" className="button primary" disabled={busy || !ready} onClick={send}>
          {busy ? 'Envoi…' : 'Envoyer au client'}
        </button>
      </div>
    </Modal>
  );
}
