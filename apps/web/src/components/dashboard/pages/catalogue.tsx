'use client';

// Catalogue: products with their variants (size, colour) and stock. Available = on hand − reserved by orders
// waiting for payment (architecture.md 4.6); − and + change what is on hand, never below what is reserved.

import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { newKey, useDashboard, useResource } from '../data';
import { fmtXof, formatOptions } from '../format';
import { Eye, ImagePlus, Minus, Package, Plus, Search } from '../icons';
import type { Category, Page, VendorProduct } from '../types';
import { Badge, Empty, Failed, Loading, Modal, PageTitle } from '../ui';

export function Catalogue() {
  const { mutate } = useDashboard();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [adding, setAdding] = useState(false);
  const products = useResource<Page<VendorProduct>>(
    search.trim() ? `/inventory?q=${encodeURIComponent(search.trim())}` : '/inventory',
  );
  const categories = useResource<{ data: Category[] }>('/vendors/me/categories');
  const cats = categories.data?.data ?? [];
  const catName = (id: string | null) => cats.find((c) => c.id === id)?.name ?? 'Sans catégorie';
  const shown = (products.data?.data ?? []).filter(
    (p) => p.status !== 'archived' && (!category || p.category_id === category),
  );

  const adjust = (variantId: string, delta: number) =>
    mutate(`/inventory/variants/${variantId}/adjustments`, {
      method: 'POST',
      body: { delta, reason: delta > 0 ? 'restock' : 'adjustment' },
    }).catch(() => {});

  return (
    <>
      <PageTitle
        eyebrow="Votre boutique · inventaire"
        title="Catalogue"
        description="Le stock disponible tient compte des articles réservés par les commandes en attente de paiement."
        action={
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Link href="/app/brouillons?photo=1" className="button">
              <ImagePlus size={15} /> Depuis une photo
            </Link>
            <button type="button" className="button primary" onClick={() => setAdding(true)}>
              <Plus size={15} /> Nouveau produit
            </button>
          </div>
        }
      />
      <div className="toolbar">
        <label className="search-wrap">
          <Search size={15} />
          <input
            className="search"
            aria-label="Rechercher dans le catalogue"
            placeholder="Chercher un produit…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        {cats.length > 0 && (
          <select
            className="select"
            aria-label="Filtrer par catégorie"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">Toutes les catégories</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <span className="demo-chip">
          {shown.length} produit{shown.length > 1 ? 's' : ''}
        </span>
      </div>
      {products.error && !products.data ? (
        <Failed error={products.error} retry={products.reload} />
      ) : !products.data ? (
        <Loading />
      ) : shown.length === 0 ? (
        <div className="panel">
          <Empty
            icon={Package}
            title={products.data.data.length ? 'Aucun produit correspondant' : 'Catalogue vide'}
            text={
              products.data.data.length
                ? 'Essayez une autre recherche ou catégorie.'
                : 'Ajoutez votre premier produit, ou prenez-le en photo : Selly prépare la fiche.'
            }
          />
        </div>
      ) : (
        <div className="product-grid">
          {shown.map((p) => (
            <article className="product-card" key={p.id}>
              <div className={`product-art ${p.images[0] ? '' : 'no-image'}`}>
                {p.images[0] ? (
                  <img
                    src={p.images[0].url}
                    alt=""
                    loading="lazy"
                    style={{ background: p.images[0].dominant }}
                  />
                ) : (
                  <Package size={32} strokeWidth={1.2} />
                )}
                <span className="art-label">{catName(p.category_id)}</span>
                {p.status === 'hidden' && <Badge tone="muted">Masqué</Badge>}
              </div>
              <div className="product-info">
                <h3>{p.title}</h3>
                <p>{fmtXof(p.price.amount)}</p>
                <ul className="variant-list">
                  {p.variants.map((v) => (
                    <li key={v.id}>
                      <span>
                        {formatOptions(v.options) || 'Article unique'}
                        <span className="table-secondary" style={{ display: 'block' }}>
                          {v.reserved > 0
                            ? `${v.reserved} réservé${v.reserved > 1 ? 's' : ''} · `
                            : ''}
                          {v.on_hand} en stock
                        </span>
                      </span>
                      <span className="table-actions" style={{ alignItems: 'center' }}>
                        <button
                          type="button"
                          className="button small ghost"
                          aria-label={`Retirer une unité : ${p.title} ${formatOptions(v.options)}`}
                          disabled={v.on_hand <= v.reserved}
                          onClick={() => adjust(v.id, -1)}
                        >
                          <Minus size={12} />
                        </button>
                        <span
                          className={`qty ${v.available <= 3 ? 'low' : ''}`}
                          title="Disponibles"
                        >
                          {v.available}
                        </span>
                        <button
                          type="button"
                          className="button small ghost"
                          aria-label={`Ajouter une unité : ${p.title} ${formatOptions(v.options)}`}
                          onClick={() => adjust(v.id, 1)}
                        >
                          <Plus size={12} />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="product-meta">
                  <span className="table-secondary">
                    {p.variants.reduce((n, v) => n + v.available, 0)} disponibles
                  </span>
                  <button
                    type="button"
                    className="text-link"
                    onClick={() =>
                      mutate(
                        `/inventory/${p.id}`,
                        {
                          method: 'PATCH',
                          body: { status: p.status === 'hidden' ? 'active' : 'hidden' },
                        },
                        p.status === 'hidden'
                          ? `${p.title} est de nouveau visible.`
                          : `${p.title} est masqué de la boutique.`,
                      ).catch(() => {})
                    }
                  >
                    <Eye size={12} /> {p.status === 'hidden' ? 'Afficher' : 'Masquer'}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      {adding && <NewProduct categories={cats} onClose={() => setAdding(false)} />}
    </>
  );
}

/** Option names core accepts: lowercase letters and _ (drafts.ts). "Tailles" become { size }. */
function NewProduct({ categories, onClose }: { categories: Category[]; onClose: () => void }) {
  const { mutate } = useDashboard();
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState(categories[0]?.id ?? '');
  const [description, setDescription] = useState('');
  const [sizes, setSizes] = useState('');
  const [stock, setStock] = useState('1');
  const [busy, setBusy] = useState(false);
  // One key per opened form: a double tap or a retry never creates the product twice.
  const [key] = useState(newKey);

  const sizeList = sizes
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const onHand = Math.max(0, Number(stock) || 0);
    try {
      await mutate(
        '/inventory',
        {
          method: 'POST',
          idempotencyKey: key,
          body: {
            title: title.trim(),
            ...(description.trim() ? { description: description.trim() } : {}),
            ...(category ? { category_id: category } : {}),
            price: { amount: Number(price), currency: 'XOF' },
            variants: sizeList.length
              ? sizeList.map((size) => ({ options: { size }, on_hand: onHand }))
              : [{ options: {}, on_hand: onHand }],
          },
        },
        `${title.trim()} ajouté au catalogue.`,
      );
      onClose();
    } catch {
      setBusy(false);
    }
  }

  return (
    <Modal title="Ajouter un produit" onClose={onClose}>
      <form onSubmit={submit}>
        <p className="modal-copy">
          Le produit est visible sur votre boutique dès que vous l’ajoutez, et l’assistant peut le
          proposer.
        </p>
        <label className="form-label" htmlFor="np-title">
          Nom du produit
        </label>
        <input
          id="np-title"
          className="form-control"
          required
          minLength={2}
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ex. Robe wax noire"
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label className="form-label" htmlFor="np-price">
              Prix (FCFA)
            </label>
            <input
              id="np-price"
              className="form-control"
              type="number"
              inputMode="numeric"
              min="1"
              required
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="15000"
            />
          </div>
          <div>
            <label className="form-label" htmlFor="np-stock">
              {sizeList.length ? 'Stock par taille' : 'Stock'}
            </label>
            <input
              id="np-stock"
              className="form-control"
              type="number"
              inputMode="numeric"
              min="0"
              value={stock}
              onChange={(e) => setStock(e.target.value)}
            />
          </div>
        </div>
        <label className="form-label" htmlFor="np-sizes">
          Tailles ou pointures, facultatif
        </label>
        <input
          id="np-sizes"
          className="form-control"
          value={sizes}
          onChange={(e) => setSizes(e.target.value)}
          placeholder="Ex. 40, 41, 42 ou S, M, L"
        />
        {categories.length > 0 && (
          <>
            <label className="form-label" htmlFor="np-cat">
              Catégorie
            </label>
            <select
              id="np-cat"
              className="form-control"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">Sans catégorie</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </>
        )}
        <label className="form-label" htmlFor="np-desc">
          Description, facultatif
        </label>
        <textarea
          id="np-desc"
          className="form-control"
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Matière, coupe, conseils d’entretien…"
        />
        <div className="modal-actions">
          <button type="button" className="button" onClick={onClose}>
            Annuler
          </button>
          <button
            className="button primary"
            type="submit"
            disabled={busy || !title.trim() || !price}
          >
            <Plus size={14} /> Ajouter au catalogue
          </button>
        </div>
      </form>
    </Modal>
  );
}
