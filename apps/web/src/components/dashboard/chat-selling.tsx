'use client';

// Selling in a discussion (architecture.md 6.6): when the vendor has the chat, they show products as cards, or
// propose a cart of what they agreed on. The customer completes the cart in the shop (quantities, delivery, name and
// phone) and pays on the payment page. Both tools pick from the active products, with search and filters.

import { useState } from 'react';
import type { ChatCard } from '@/lib/chat-types';
import { newKey, useDashboard, useResource } from './data';
import { fmtXof, formatOptions } from './format';
import { Package, Search, X } from './icons';
import type { Category, ConversationSummary, Page, VendorProduct } from './types';
import { Modal } from './ui';

const useActiveProducts = () =>
  useResource<Page<VendorProduct>>('/inventory?status=active&limit=100');

/** Cards in a thread bubble, as the customer sees them: products with price, the order with its state. */
export function ThreadCards({ cards }: { cards: ChatCard[] }) {
  if (cards.length === 0) return null;
  return (
    <div className="thread-cards">
      {cards.map((c) =>
        c.type === 'cart' ? (
          <div key="cart" className="thread-card">
            <span>
              <b>Panier proposé</b>
              {c.lines.map((l) => `${l.title} ${formatOptions(l.options)}`.trim()).join(', ')}
            </span>
          </div>
        ) : c.type === 'product' ? (
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

/** Search, categories and stock, over the shop's active products: the list both tools pick from. */
function ProductPicker({ render }: { render: (p: VendorProduct) => React.ReactNode }) {
  const products = useActiveProducts();
  const categories = useResource<{ data: Category[] }>('/vendors/me/categories');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [inStock, setInStock] = useState(false);
  const cats = categories.data?.data ?? [];
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const list = (products.data?.data ?? []).filter(
    (p) =>
      words.every((w) => `${p.title} ${p.description}`.toLowerCase().includes(w)) &&
      (!category || p.category_id === category) &&
      (!inStock || p.variants.some((v) => v.available > 0)),
  );
  return (
    <div className="picker">
      <label className="search-wrap">
        <Search size={14} />
        <input
          className="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Chercher un produit…"
          aria-label="Chercher un produit"
        />
      </label>
      <div className="picker-filters" role="group" aria-label="Filtres">
        {cats.length > 0 && (
          <>
            <button
              type="button"
              className={`chip${category === '' ? ' on' : ''}`}
              aria-pressed={category === ''}
              onClick={() => setCategory('')}
            >
              Tout
            </button>
            {cats.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`chip${category === c.id ? ' on' : ''}`}
                aria-pressed={category === c.id}
                onClick={() => setCategory(category === c.id ? '' : c.id)}
              >
                {c.name}
              </button>
            ))}
          </>
        )}
        <button
          type="button"
          className={`chip${inStock ? ' on' : ''}`}
          aria-pressed={inStock}
          onClick={() => setInStock((v) => !v)}
        >
          En stock
        </button>
      </div>
      <div className="pick-list">
        {list.map((p) => (
          <div key={p.id}>{render(p)}</div>
        ))}
        {!products.data && <p className="form-hint">Chargement…</p>}
        {products.data && list.length === 0 && (
          <p className="form-hint">Aucun produit ne correspond.</p>
        )}
      </div>
    </div>
  );
}

const stockOf = (p: VendorProduct) => p.variants.reduce((n, v) => n + Math.max(0, v.available), 0);

function ProductLine({ p }: { p: VendorProduct }) {
  return (
    <>
      {p.images[0] ? <img src={p.images[0].url} alt="" /> : <Package size={18} />}
      <span>
        <b>{p.title}</b>
        {fmtXof(p.price.amount)} · {stockOf(p)} en stock
      </span>
    </>
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
  const [picked, setPicked] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

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
      <ProductPicker
        render={(p) => {
          const on = picked.includes(p.id);
          return (
            <label className={`pick-row${on ? ' on' : ''}`}>
              <input
                type="checkbox"
                checked={on}
                disabled={!on && picked.length >= 3}
                onChange={() =>
                  setPicked((all) => (on ? all.filter((x) => x !== p.id) : [...all, p.id]))
                }
              />
              <ProductLine p={p} />
            </label>
          );
        }}
      />
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
          Envoyer ({picked.length})
        </button>
      </div>
    </Modal>
  );
}

interface Pick {
  product: VendorProduct;
  variant_id: string;
}

/**
 * The items the vendor and the customer agreed on, as a proposed cart. The customer opens it in the shop's cart and
 * chooses the quantities, the delivery and their details there, then pays: the vendor only picks what and which size.
 */
export function ProposeCart({ chat, onClose }: { chat: ConversationSummary; onClose: () => void }) {
  const { mutate } = useDashboard();
  const [picks, setPicks] = useState<Pick[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const has = (vid: string) => picks.some((x) => x.variant_id === vid);
  const toggle = (product: VendorProduct, variant_id: string) =>
    setPicks((all) =>
      has(variant_id)
        ? all.filter((x) => x.variant_id !== variant_id)
        : all.length >= 10
          ? all
          : [...all, { product, variant_id }],
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
            cart: picks.map((x) => ({ product_id: x.product.id, variant_id: x.variant_id })),
            ...(text.trim() ? { text: text.trim() } : {}),
          },
        },
        'Panier envoyé : le client choisit les quantités et la livraison, puis paie.',
      );
      onClose();
    } catch {
      setBusy(false);
    }
  }

  return (
    <Modal title="Proposer un panier" onClose={onClose}>
      <p className="modal-copy">
        Choisissez les articles et leur taille. Le client reçoit le panier dans la discussion,
        choisit les quantités et la livraison, donne ses coordonnées, puis paie.
      </p>
      <ProductPicker
        render={(p) => {
          const single = p.variants.length === 1 ? p.variants[0] : undefined;
          return (
            <div className={`pick-row${p.variants.some((v) => has(v.id)) ? ' on' : ''}`}>
              {single ? (
                <input
                  type="checkbox"
                  aria-label={`Ajouter ${p.title}`}
                  checked={has(single.id)}
                  disabled={single.available <= 0 && !has(single.id)}
                  onChange={() => toggle(p, single.id)}
                />
              ) : (
                <span aria-hidden="true" />
              )}
              <ProductLine p={p} />
              {!single && (
                <div className="variant-chips" role="group" aria-label={`Tailles de ${p.title}`}>
                  {p.variants.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      className={`chip${has(v.id) ? ' on' : ''}`}
                      aria-pressed={has(v.id)}
                      disabled={v.available <= 0 && !has(v.id)}
                      onClick={() => toggle(p, v.id)}
                    >
                      {formatOptions(v.options) || 'Unique'}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        }}
      />
      {picks.length > 0 && (
        <div className="info-list" style={{ padding: 0, marginTop: 10 }}>
          {picks.map((x) => {
            const v = x.product.variants.find((y) => y.id === x.variant_id);
            return (
              <div className="info-row" key={x.variant_id}>
                <span>
                  {x.product.title} {v ? formatOptions(v.options) : ''}
                </span>
                <button
                  type="button"
                  className="button small ghost"
                  aria-label={`Retirer ${x.product.title}`}
                  onClick={() => toggle(x.product, x.variant_id)}
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <label className="form-label" htmlFor="pc-text">
        Un mot, facultatif
      </label>
      <input
        id="pc-text"
        className="form-control"
        maxLength={1000}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Comme convenu, voici votre panier"
      />
      <div className="modal-actions">
        <button type="button" className="button" onClick={onClose}>
          Annuler
        </button>
        <button
          type="button"
          className="button primary"
          disabled={busy || picks.length === 0}
          onClick={send}
        >
          Envoyer le panier ({picks.length})
        </button>
      </div>
    </Modal>
  );
}
