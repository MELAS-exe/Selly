'use client';

// Catalogue: products with their variants (size, colour) and stock. Available = on hand − reserved by orders
// waiting for payment (architecture.md 4.6); − and + change what is on hand, never below what is reserved.

import Link from 'next/link';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/browser-api';
import { newKey, uploadImages, useDashboard, useResource } from '../data';
import { fmtXof, formatOptions } from '../format';
import { Camera, Eye, ImagePlus, Minus, Package, Pencil, Plus, Search, X } from '../icons';
import { openSelly } from '../selly-assistant';
import type { Category, Page, VendorProduct } from '../types';
import { Badge, Empty, Failed, Loading, Modal, PageTitle } from '../ui';
import { PendingDrafts } from './drafts';

export function Catalogue() {
  const { mutate } = useDashboard();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<VendorProduct | null>(null);
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
            <button type="button" className="button" onClick={() => openSelly({ photo: true })}>
              <ImagePlus size={15} /> Depuis une photo
            </button>
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
      <PendingDrafts />
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
                  <button type="button" className="text-link" onClick={() => setEditing(p)}>
                    <Pencil size={12} /> Modifier
                  </button>
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
      {adding && <ProductForm categories={cats} onClose={() => setAdding(false)} />}
      {editing && (
        <ProductForm categories={cats} product={editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

/** A photo in the form: one already on the product (its storage key), or a new file shown from memory. */
interface Pick {
  url: string;
  key?: string;
  file?: File;
}

/**
 * Adds a product, or edits one (`product`). Editing sends what core's PATCH takes: name, price, category,
 * description and the photos, the kept ones by storage key and the new ones uploaded first. Stock and sizes stay
 * on the card (− and +), where each change is a ledger entry. Option names core accepts: lowercase letters and _
 * (drafts.ts), so "Tailles" become { size }.
 */
function ProductForm({
  categories,
  product,
  onClose,
}: {
  categories: Category[];
  product?: VendorProduct;
  onClose: () => void;
}) {
  const { mutate, request, flash, demo } = useDashboard();
  const editing = !!product;
  const [title, setTitle] = useState(product?.title ?? '');
  const [price, setPrice] = useState(product ? String(product.price.amount) : '');
  const [category, setCategory] = useState(
    product ? (product.category_id ?? '') : (categories[0]?.id ?? ''),
  );
  const [description, setDescription] = useState(product?.description ?? '');
  const [sizes, setSizes] = useState('');
  const [stock, setStock] = useState('1');
  const [busy, setBusy] = useState(false);
  const [photos, setPhotos] = useState<Pick[]>(
    product?.images.map((i) => ({ url: i.url, key: i.storage_key })) ?? [],
  );
  // One key per opened form: a double tap or a retry never creates the product twice. The photos already sent keep
  // their storage key, so a retry sends the same request.
  const [key] = useState(newKey);
  const sent = useRef(new Map<File, string>());
  const picker = useRef<HTMLInputElement>(null);
  useEffect(
    () => () => {
      for (const p of photos) if (p.file) URL.revokeObjectURL(p.url);
    },
    [photos],
  );

  const sizeList = sizes
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const imageKeys: string[] = [];
      for (const p of photos) {
        let k = p.key ?? (p.file ? sent.current.get(p.file) : undefined);
        if (!k && p.file && !demo) {
          k = (await uploadImages(request, [p.file]))[0];
          if (k) sent.current.set(p.file, k);
        }
        if (k) imageKeys.push(k);
      }
      const fields = {
        title: title.trim(),
        price: { amount: Number(price), currency: 'XOF' },
      };
      if (product) {
        await mutate(
          `/inventory/${product.id}`,
          {
            method: 'PATCH',
            body: {
              ...fields,
              description: description.trim(),
              category_id: category || null,
              image_keys: imageKeys,
            },
          },
          `${title.trim()} mis à jour.`,
        );
      } else {
        const onHand = Math.max(0, Number(stock) || 0);
        await mutate(
          '/inventory',
          {
            method: 'POST',
            idempotencyKey: key,
            body: {
              ...fields,
              ...(description.trim() ? { description: description.trim() } : {}),
              ...(category ? { category_id: category } : {}),
              ...(imageKeys.length ? { image_keys: imageKeys } : {}),
              variants: sizeList.length
                ? sizeList.map((size) => ({ options: { size }, on_hand: onHand }))
                : [{ options: {}, on_hand: onHand }],
            },
          },
          `${title.trim()} ajouté au catalogue.`,
        );
      }
      onClose();
    } catch (err) {
      if (!(err instanceof ApiError)) flash('L’envoi d’une photo a échoué. Réessayez.', 'error');
      setBusy(false);
    }
  }

  return (
    <Modal title={editing ? 'Modifier le produit' : 'Ajouter un produit'} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="modal-copy">
          {editing
            ? 'Les changements apparaissent dans votre boutique dès que vous enregistrez. Le stock se règle avec − et + sur la fiche.'
            : 'Le produit apparaît dans votre boutique dès que vous l’ajoutez (dès qu’elle est publiée pour vos clients), et l’assistant peut le proposer.'}
        </p>
        <div className="form-label">Photos, jusqu’à 8</div>
        <div className="photo-picks">
          {photos.map((p, i) => (
            <span className="photo-pick" key={p.url}>
              <img src={p.url} alt={`Photo ${i + 1}`} />
              <button
                type="button"
                aria-label={`Retirer la photo ${i + 1}`}
                onClick={() => setPhotos((all) => all.filter((x) => x !== p))}
              >
                <X size={12} />
              </button>
              {i > 0 && (
                <button
                  type="button"
                  className="photo-first"
                  aria-label={`Mettre la photo ${i + 1} en premier`}
                  onClick={() => setPhotos((all) => [p, ...all.filter((x) => x !== p)])}
                >
                  En 1er
                </button>
              )}
            </span>
          ))}
          {photos.length < 8 && (
            <button
              type="button"
              className="photo-pick add"
              onClick={() => picker.current?.click()}
            >
              <Camera size={18} />
              <span>{photos.length ? 'Ajouter' : 'Ajouter une photo'}</span>
            </button>
          )}
          <input
            ref={picker}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              const ok = files.filter(
                (f) => /^image\/(jpeg|png|webp)$/.test(f.type) && f.size <= 8 * 1024 * 1024,
              );
              if (ok.length < files.length)
                flash('Certaines photos sont refusées : JPEG, PNG ou WebP, 8 Mo au plus.', 'error');
              setPhotos((all) =>
                [...all, ...ok.map((file) => ({ file, url: URL.createObjectURL(file) }))].slice(
                  0,
                  8,
                ),
              );
            }}
          />
        </div>
        <p className="form-hint">
          La première photo est celle que voient vos clients dans la boutique.
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
          {!editing && (
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
          )}
        </div>
        {!editing && (
          <>
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
          </>
        )}
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
            {editing ? (
              busy ? (
                'Enregistrement…'
              ) : (
                'Enregistrer'
              )
            ) : (
              <>
                <Plus size={14} /> Ajouter au catalogue
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
