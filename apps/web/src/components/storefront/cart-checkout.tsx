'use client';

// Ordering straight from the cart (architecture.md 6.2, without the chat): who and where, a quote from core with
// the delivery fee and the amount in sats, then the order and its invoice, and the payment page. Prices come from
// core only: the total sent back must be the quoted one, or core answers PRICE_CHANGED with the new one.

import { useEffect, useId, useState } from 'react';
import { ApiError, api, problemMessage } from '@/lib/browser-api';
import { type CartLine, writeCart } from '@/lib/cart';
import { toE164 } from '@/lib/format';
import type { CartQuote, OrderCreated, StorePublic } from '@/lib/types';
import { useMoney, useT } from '../lang';
import { ArrowRight } from './draft-icons';

type Delivery = StorePublic['delivery'];

const newKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function CartCheckout({
  slug,
  lines,
  delivery,
  onBack,
}: {
  slug: string;
  lines: CartLine[];
  delivery: Delivery;
  onBack: () => void;
}) {
  const { money, sats } = useMoney();
  const t = useT();
  const ids = { name: useId(), phone: useId(), zone: useId(), address: useId(), note: useId() };
  const pickup = delivery.pickup.available;
  const zones = delivery.zones;
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  // A delivery zone, or 'pickup'. The first choice the shop offers is selected.
  const [where, setWhere] = useState(zones[0]?.id ?? (pickup ? 'pickup' : ''));
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [quote, setQuote] = useState<CartQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One key per attempt with the same details: a double tap or a retry never makes two orders.
  const [key, setKey] = useState(newKey);
  // Bumped to ask core for the total again (after PRICE_CHANGED).
  const [requote, setRequote] = useState(0);

  const e164 = toE164(phone);
  const isPickup = where === 'pickup';
  const deliveryBody = isPickup
    ? { method: 'pickup' as const, ...(note.trim() ? { note: note.trim() } : {}) }
    : {
        method: 'delivery' as const,
        zone_id: where,
        ...(address.trim() ? { address_text: address.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      };
  const items = lines.map((l) => ({ variant_id: l.variant_id, quantity: l.quantity }));
  const itemsKey = JSON.stringify(items);

  // The exact total for this cart and this place, from core.
  useEffect(() => {
    if (!where) return;
    const ctrl = new AbortController();
    setQuote(null);
    api<CartQuote>(`/stores/${encodeURIComponent(slug)}/cart-quotes`, {
      method: 'POST',
      body: {
        items: JSON.parse(itemsKey),
        delivery:
          where === 'pickup' ? { method: 'pickup' } : { method: 'delivery', zone_id: where },
      },
      signal: ctrl.signal,
    }).then(
      (q) => setQuote(q),
      (err) => {
        if ((err as Error).name !== 'AbortError')
          setError(
            err instanceof ApiError
              ? problemMessage(err.problem)
              : t('Erreur, réessayez.', 'Something went wrong, try again.'),
          );
      },
    );
    return () => ctrl.abort();
  }, [slug, where, itemsKey, requote]);

  const ready =
    name.trim().length >= 2 && !!e164 && !!where && !!quote && (isPickup || !!address.trim());

  async function order() {
    if (!ready || !quote) return;
    setBusy(true);
    setError(null);
    try {
      const made = await api<OrderCreated>('/orders', {
        method: 'POST',
        idempotencyKey: key,
        body: {
          store_slug: slug,
          channel: 'web',
          customer: { display_name: name.trim(), phone_e164: e164 },
          items,
          delivery: deliveryBody,
          expected_total: quote.total,
        },
      });
      // The order holds the items now: the cart starts again, and the customer pays on the order page.
      writeCart(slug, []);
      window.location.assign(`/c/${encodeURIComponent(made.order.public_token)}`);
    } catch (err) {
      setBusy(false);
      setKey(newKey());
      if (err instanceof ApiError && err.problem.code === 'PRICE_CHANGED') {
        setError(
          t(
            'Le prix a changé. Vérifiez le nouveau total avant de commander.',
            'The price has changed. Check the new total before ordering.',
          ),
        );
        setRequote((n) => n + 1);
      } else
        setError(
          err instanceof ApiError
            ? problemMessage(err.problem)
            : t('Erreur, réessayez.', 'Something went wrong, try again.'),
        );
    }
  }

  const field =
    'w-full border-b border-d-ink/30 bg-transparent py-2 text-base outline-none focus:border-[var(--sf-ink)]';
  const label = 'sf-eyebrow mt-5 mb-1 block';

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        order();
      }}
    >
      <div className="flex-1 overflow-y-auto px-5 pb-5">
        <label className={label} htmlFor={ids.name}>
          {t('Votre nom', 'Your name')}
        </label>
        <input
          id={ids.name}
          className={field}
          autoComplete="name"
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <label className={label} htmlFor={ids.phone}>
          {t('Téléphone', 'Phone')}
        </label>
        <input
          id={ids.phone}
          className={field}
          type="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="77 123 45 67"
          aria-invalid={phone.trim() !== '' && !e164}
        />
        {phone.trim() !== '' && !e164 && (
          <p className="mt-1 text-[0.9375rem] text-d-alert">
            Exemple : 77 123 45 67 ou +221 77 123 45 67.
          </p>
        )}

        <fieldset className="mt-5">
          <legend className="sf-eyebrow mb-2">{t('Livraison', 'Delivery')}</legend>
          {zones.length === 0 && !pickup && (
            <p className="text-d-ink-soft">
              {t(
                'La boutique n’a pas encore indiqué comment elle livre. Écrivez-lui pour commander.',
                'The shop has not said how it delivers yet. Write to it to order.',
              )}
            </p>
          )}
          <div className="grid gap-2">
            {zones.map((z) => (
              <label
                key={z.id}
                className="flex min-h-11 cursor-pointer items-center justify-between gap-3 border border-d-hairline px-3 has-checked:border-[var(--sf-ink)]"
              >
                <span className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="where"
                    checked={where === z.id}
                    onChange={() => setWhere(z.id)}
                    className="accent-[var(--sf-ink)]"
                  />
                  {z.label}
                </span>
                <span className="tnum text-d-ink-soft">
                  {z.fee.amount ? money(z.fee) : t('Offerte', 'Free')}
                </span>
              </label>
            ))}
            {pickup && (
              <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 border border-d-hairline px-3 has-checked:border-[var(--sf-ink)]">
                <span className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="where"
                    checked={isPickup}
                    onChange={() => setWhere('pickup')}
                    className="accent-[var(--sf-ink)]"
                  />
                  {t('Retrait à la boutique', 'Pick up at the shop')}
                </span>
                <span className="text-d-ink-soft">{t('Gratuit', 'Free')}</span>
              </label>
            )}
          </div>
        </fieldset>
        {isPickup && delivery.pickup.address_text && (
          <p className="mt-2 text-[0.9375rem] text-d-ink-soft">{delivery.pickup.address_text}</p>
        )}
        {!isPickup && where && (
          <>
            <label className={label} htmlFor={ids.address}>
              {t('Adresse de livraison', 'Delivery address')}
            </label>
            <input
              id={ids.address}
              className={field}
              autoComplete="street-address"
              maxLength={300}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={t('Rue, immeuble, repère', 'Street, building, landmark')}
            />
          </>
        )}
        <label className={label} htmlFor={ids.note}>
          {t('Note pour la boutique, facultatif', 'Note for the shop, optional')}
        </label>
        <input
          id={ids.note}
          className={field}
          maxLength={300}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Appeler avant de passer"
        />
      </div>

      <div className="border-t border-d-hairline p-5">
        {quote ? (
          <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-[0.9375rem]">
            <dt className="text-d-ink-soft">Sous-total</dt>
            <dd className="tnum text-right">{money(quote.subtotal)}</dd>
            <dt className="text-d-ink-soft">{t('Livraison', 'Delivery')}</dt>
            <dd className="tnum text-right">
              {quote.delivery_fee.amount ? money(quote.delivery_fee) : t('Offerte', 'Free')}
            </dd>
            {quote.discount.amount > 0 && (
              <>
                <dt className="text-d-ink-soft">{t('Remise', 'Discount')}</dt>
                <dd className="tnum text-right">−{money(quote.discount)}</dd>
              </>
            )}
            <dt className="mt-2 font-semibold">Total</dt>
            <dd className="sf-figure mt-1 text-right text-3xl">{money(quote.total)}</dd>
            <dd className="col-span-2 text-right text-d-ink-soft">≈ {sats(quote.total_sat)}</dd>
          </dl>
        ) : (
          where && (
            <p className="text-d-ink-soft" role="status">
              {t('Calcul du total…', 'Working out the total…')}
            </p>
          )
        )}
        {error && (
          <p role="alert" className="mt-3 text-[0.9375rem] text-d-alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={!ready || busy}
          className="sf-btn sf-btn-primary mt-4 w-full disabled:opacity-40"
        >
          {busy
            ? t('Création de la commande…', 'Creating the order…')
            : t('Commander et payer', 'Order and pay')}{' '}
          <ArrowRight size={16} />
        </button>
        <button
          type="button"
          onClick={onBack}
          className="mt-2 min-h-11 w-full text-d-ink-soft underline"
        >
          {t('Retour au panier', 'Back to the cart')}
        </button>
      </div>
    </form>
  );
}
