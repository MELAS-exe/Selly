'use client';

// Réglages: what PATCH /vendors/me and the category routes accept (docs/api.json). HANDOVER.md listed the branding
// and categories screens as missing; delivery zones, the assistant's tone and bargaining live here too.

import {
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { storefrontStyle, usableBackground } from '@/lib/brand-colors';
import { ApiError } from '@/lib/browser-api';
import { toE164 } from '@/lib/format';
import {
  DEFAULT_CTA,
  DEFAULT_TITLE,
  defaultEyebrow,
  defaultText,
  type HeroTexts,
  heroCopy,
} from '@/lib/hero';
import { uploadImages, useDashboard, useResource } from '../data';
import { fmtXof } from '../format';
import { ImagePlus, Plus, ShoppingBag, X } from '../icons';
import { PushToggle } from '../push';
import type { Category, DeliveryZone, Vendor } from '../types';
import { Loading, PageTitle, PanelHead } from '../ui';

function Section({
  title,
  sub,
  onSubmit,
  busy,
  children,
}: {
  title: string;
  sub: string;
  onSubmit?: (e: FormEvent) => void;
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <PanelHead title={title} sub={sub} />
      <form
        style={{ padding: '4px 22px 22px' }}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit?.(e);
        }}
      >
        {children}
        {onSubmit && (
          <div className="modal-actions">
            <button type="submit" className="button primary small" disabled={busy}>
              Enregistrer
            </button>
          </div>
        )}
      </form>
    </section>
  );
}

const slugify = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'zone';

export function Settings() {
  const { vendor, mutate } = useDashboard();
  if (!vendor) return <Loading rows={6} />;
  return (
    <>
      <PageTitle
        eyebrow="Votre compte · boutique"
        title="Réglages"
        description="Ce que voient vos clients, et comment l’assistant leur répond."
      />
      <div className="wallet-page-grid">
        <BrandingSection vendor={vendor} save={mutate} />
        <ShopSection vendor={vendor} save={mutate} />
        <DeliverySection vendor={vendor} save={mutate} />
        <AgentSection vendor={vendor} save={mutate} />
        <AlertsSection vendor={vendor} save={mutate} />
        <EmailSection vendor={vendor} save={mutate} />
      </div>
    </>
  );
}

type Save = ReturnType<typeof useDashboard>['mutate'];
const patch = (save: Save, body: unknown, done: string) =>
  save('/vendors/me', { method: 'PATCH', body }, done).catch(() => {});

function ShopSection({ vendor, save }: { vendor: Vendor; save: Save }) {
  const [phone, setPhone] = useState(vendor.contact_whatsapp_e164 ?? '');
  const first = vendor.settings.hours?.[0];
  const [days, setDays] = useState(first?.days ?? 'lun-sam');
  const [open, setOpen] = useState(first?.open ?? '09:00');
  const [close, setClose] = useState(first?.close ?? '19:00');
  const e164 = phone.trim() ? toE164(phone) : null;
  const bad = phone.trim() !== '' && !e164;
  return (
    <Section
      title="Contact et horaires"
      sub={vendor.store_url.replace(/^https?:\/\//, '')}
      onSubmit={() =>
        !bad &&
        patch(
          save,
          {
            contact_whatsapp_e164: e164,
            settings: { hours: [{ days: days.trim() || 'lun-sam', open, close }] },
          },
          'Contact et horaires enregistrés.',
        )
      }
    >
      <label className="form-label" htmlFor="s-wa">
        WhatsApp, quand l’assistant passe la main
      </label>
      <input
        id="s-wa"
        className="form-control"
        type="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="77 123 45 67"
        aria-invalid={bad}
      />
      {bad && <p className="form-error">Numéro invalide. Exemple : +221 77 123 45 67.</p>}
      <div className="form-label" style={{ marginBottom: 0 }}>
        Horaires, que l’assistant donne aux clients
      </div>
      <div className="hours-grid">
        <input
          className="form-control"
          aria-label="Jours"
          maxLength={30}
          value={days}
          onChange={(e) => setDays(e.target.value)}
          placeholder="lun-sam"
        />
        <input
          className="form-control"
          aria-label="Ouverture"
          type="time"
          value={open}
          onChange={(e) => setOpen(e.target.value)}
        />
        <input
          className="form-control"
          aria-label="Fermeture"
          type="time"
          value={close}
          onChange={(e) => setClose(e.target.value)}
        />
      </div>
    </Section>
  );
}

/** A zone name as the assistant matches it: no accents, no case, single spaces. */
const zoneKey = (label: string) => slugify(label.replace(/s+/g, ' ').trim());

function DeliverySection({ vendor, save }: { vendor: Vendor; save: Save }) {
  const d = vendor.settings.delivery;
  const [zones, setZones] = useState<DeliveryZone[]>(d?.zones ?? []);
  const [pickup, setPickup] = useState(d?.pickup.available ?? false);
  const [address, setAddress] = useState(d?.pickup.address_text ?? '');
  const [label, setLabel] = useState('');
  const [fee, setFee] = useState('');
  // Two zones with one name leave the assistant two prices for the same place: never add one, flag old ones.
  const count = new Map<string, number>();
  for (const z of zones) count.set(zoneKey(z.label), (count.get(zoneKey(z.label)) ?? 0) + 1);
  const doubled = [...count.values()].some((n) => n > 1);
  const taken = label.trim() !== '' && count.has(zoneKey(label));
  return (
    <Section
      title="Livraison"
      sub="Les frais que l’assistant ajoute au total"
      busy={doubled}
      onSubmit={() =>
        !doubled &&
        patch(
          save,
          {
            settings: {
              delivery: {
                zones,
                pickup: { available: pickup, address_text: address.trim() || null },
              },
            },
          },
          'Livraison enregistrée.',
        )
      }
    >
      {zones.length > 0 ? (
        <div className="zone-list" aria-label="Zones de livraison">
          {zones.map((z) => {
            const twice = (count.get(zoneKey(z.label)) ?? 0) > 1;
            return (
              <div className={`zone-row${twice ? ' doubled' : ''}`} key={z.id}>
                <span>
                  {z.label}
                  {twice && <em>en double</em>}
                </span>
                <b>{z.fee.amount ? fmtXof(z.fee.amount) : 'Offerte'}</b>
                <button
                  type="button"
                  className="button small ghost"
                  aria-label={`Retirer ${z.label}`}
                  onClick={() => setZones((all) => all.filter((x) => x.id !== z.id))}
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="form-hint">Aucune zone : ajoutez les quartiers où vous livrez.</p>
      )}
      {doubled && (
        <p className="form-error">
          Une zone apparaît deux fois avec des frais différents. Retirez celle qui n’est plus bonne
          pour enregistrer.
        </p>
      )}
      <div className="zone-add">
        <div>
          <label className="form-label" htmlFor="z-label">
            Zone
          </label>
          <input
            id="z-label"
            className="form-control"
            maxLength={60}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Ex. Mermoz"
            aria-invalid={taken}
            aria-describedby={taken ? 'z-taken' : undefined}
          />
        </div>
        <div>
          <label className="form-label" htmlFor="z-fee">
            Frais (FCFA)
          </label>
          <input
            id="z-fee"
            className="form-control"
            type="number"
            inputMode="numeric"
            min="0"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            placeholder="Ex. 1500"
          />
        </div>
        <button
          type="button"
          className="button small"
          disabled={!label.trim() || taken || zones.length >= 20}
          onClick={() => {
            let id = slugify(label);
            while (zones.some((z) => z.id === id)) id = `${id}-2`.slice(0, 40);
            setZones((all) => [
              ...all,
              { id, label: label.trim(), fee: { amount: Number(fee) || 0, currency: 'XOF' } },
            ]);
            setLabel('');
            setFee('');
          }}
        >
          <Plus size={12} /> Ajouter
        </button>
      </div>
      {taken && (
        <p className="form-error" id="z-taken">
          Cette zone existe déjà. Retirez-la d’abord pour changer ses frais.
        </p>
      )}
      <label className="form-label" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={pickup}
          onChange={(e) => setPickup(e.target.checked)}
          style={{ accentColor: '#173b32' }}
        />
        Retrait possible à la boutique
      </label>
      {pickup && (
        <input
          className="form-control"
          aria-label="Adresse de retrait"
          maxLength={200}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Marché HLM, cantine 12"
        />
      )}
    </Section>
  );
}

function AgentSection({ vendor, save }: { vendor: Vendor; save: Save }) {
  const a = vendor.settings.agent;
  const [enabled, setEnabled] = useState(a.enabled);
  const [tone, setTone] = useState(a.tone);
  const [mode, setMode] = useState(a.negotiation?.mode ?? 'fixed');
  const [max, setMax] = useState(String(a.negotiation?.max_discount_pct ?? 5));
  return (
    <Section
      title="Assistant"
      sub="L’assistant répond aux clients sur votre boutique"
      onSubmit={() =>
        patch(
          save,
          {
            settings: {
              agent: {
                enabled,
                tone,
                negotiation: {
                  mode,
                  max_discount_pct: Math.min(30, Math.max(0, Number(max) || 0)),
                },
              },
            },
          },
          'Assistant enregistré.',
        )
      }
    >
      <label className="form-label" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          style={{ accentColor: '#173b32' }}
        />
        Assistant actif
      </label>
      <label className="form-label" htmlFor="a-tone">
        Ton
      </label>
      <select
        id="a-tone"
        className="form-control"
        value={tone}
        onChange={(e) => setTone(e.target.value as typeof tone)}
      >
        <option value="friendly">Chaleureux (tutoiement possible)</option>
        <option value="formal">Poli (vouvoiement)</option>
      </select>
      <label className="form-label" htmlFor="a-neg">
        Marchandage
      </label>
      <select
        id="a-neg"
        className="form-control"
        value={mode}
        onChange={(e) => setMode(e.target.value as typeof mode)}
      >
        <option value="fixed">Prix fixes : l’assistant ne baisse pas</option>
        <option value="allow">Remise possible, jusqu’à une limite</option>
      </select>
      {mode === 'allow' && (
        <>
          <label className="form-label" htmlFor="a-max">
            Remise maximale (%)
          </label>
          <input
            id="a-max"
            className="form-control"
            type="number"
            min="0"
            max="30"
            value={max}
            onChange={(e) => setMax(e.target.value)}
          />
        </>
      )}
    </Section>
  );
}

/** Selly's paper: the shop's background when the vendor has not chosen one. */
const PAPER = '#f6f4f0';
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** A picture being chosen: the stored key and URL, or a new file shown from memory until it is saved. */
interface Picture {
  key: string | null;
  url: string | null;
  file: File | null;
}

function usePicture(key: string | null | undefined, url: string | null | undefined) {
  const [pic, setPic] = useState<Picture>({ key: key ?? null, url: url ?? null, file: null });
  // A local preview URL lives until the next pick or the page closes.
  useEffect(() => {
    const local = pic.file ? pic.url : null;
    return () => {
      if (local) URL.revokeObjectURL(local);
    };
  }, [pic]);
  return [pic, setPic] as const;
}

function PicturePicker({
  label,
  hint,
  pic,
  onPick,
  onError,
  wide,
}: {
  label: string;
  hint: string;
  pic: Picture;
  onPick: (p: Picture) => void;
  onError: (message: string) => void;
  wide?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="picture-field">
      <div className="form-label">{label}</div>
      <div className={`picture-row${wide ? ' wide' : ''}`}>
        <span className="picture-thumb">
          {pic.url ? <img src={pic.url} alt="" /> : <ImagePlus size={18} />}
        </span>
        <span className="picture-actions">
          <input
            ref={input}
            type="file"
            accept={IMAGE_TYPES.join(',')}
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              if (!IMAGE_TYPES.includes(f.type))
                return onError('Choisissez une photo JPEG, PNG ou WebP.');
              if (f.size > MAX_IMAGE_BYTES) return onError('Cette photo dépasse 8 Mo.');
              onPick({ key: null, url: URL.createObjectURL(f), file: f });
            }}
          />
          <button type="button" className="button small" onClick={() => input.current?.click()}>
            {pic.url ? 'Changer' : 'Choisir une image'}
          </button>
          {pic.url && (
            <button
              type="button"
              className="button small ghost"
              onClick={() => onPick({ key: null, url: null, file: null })}
            >
              Retirer
            </button>
          )}
        </span>
      </div>
      <p className="form-hint">{hint}</p>
    </div>
  );
}

/**
 * Name, logo, colours and banner, with the shop as it will look, updated while the vendor types. New pictures are
 * uploaded on save; core resizes them and strips their metadata before anything is stored.
 */
function BrandingSection({ vendor, save }: { vendor: Vendor; save: Save }) {
  const { request, flash, demo } = useDashboard();
  const b = vendor.settings.branding;
  const [name, setName] = useState(vendor.display_name);
  const [primary, setPrimary] = useState(b?.primary_color ?? '#173b32');
  const [accent, setAccent] = useState(b?.accent_color ?? '#8aae4a');
  const [background, setBackground] = useState(b?.background_color ?? PAPER);
  const darkBackground = !usableBackground(background);
  const [banner, setBanner] = useState(b?.banner?.text ?? '');
  const [href, setHref] = useState(b?.banner?.href ?? '');
  // The shop page's opening words; an empty field keeps the storefront's default (shown as the placeholder).
  const [hero, setHero] = useState<HeroTexts>({
    eyebrow: b?.hero?.eyebrow ?? '',
    title: b?.hero?.title ?? '',
    text: b?.hero?.text ?? '',
    cta: b?.hero?.cta ?? '',
  });
  const setLine = (k: keyof HeroTexts) => (v: string) => setHero((h) => ({ ...h, [k]: v }));
  const [logo, setLogo] = usePicture(b?.logo_key, b?.logo_url);
  const [cover, setCover] = usePicture(b?.banner?.image_key, b?.banner?.image_url);
  const [busy, setBusy] = useState(false);
  const nameOk = name.trim().length >= 2;
  const shopName = name.trim() || vendor.display_name;

  async function submit() {
    if (!nameOk) return;
    setBusy(true);
    try {
      const keyOf = async (p: Picture) =>
        p.file && !demo ? ((await uploadImages(request, [p.file]))[0] ?? null) : p.key;
      const [logoKey, coverKey] = [await keyOf(logo), await keyOf(cover)];
      const hasBanner = banner.trim() !== '' || coverKey !== null;
      await save(
        '/vendors/me',
        {
          method: 'PATCH',
          body: {
            display_name: name.trim(),
            settings: {
              branding: {
                logo_key: logoKey,
                primary_color: primary,
                accent_color: accent,
                // Selly's paper is stored as "none", so a later change of the default reaches the shop.
                background_color:
                  background.toLowerCase() === PAPER || darkBackground ? null : background,
                banner: hasBanner
                  ? { text: banner.trim(), href: href.trim() || null, image_key: coverKey }
                  : null,
                hero,
              },
            },
          },
        },
        'Identité et apparence enregistrées.',
      );
    } catch (err) {
      // mutate already shows core's refusals; an upload that failed before it says so here.
      if (!(err instanceof ApiError)) flash('L’envoi de l’image a échoué. Réessayez.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel identity-panel">
      <PanelHead
        title="Identité et apparence"
        sub="Le nom, le logo, les couleurs et le bandeau que voient vos clients"
      />
      <div className="identity-layout">
        <form
          className="identity-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label className="form-label" htmlFor="s-name">
            Nom de la boutique
          </label>
          <input
            id="s-name"
            className="form-control"
            minLength={2}
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={!nameOk}
          />
          <PicturePicker
            label="Logo"
            hint="Carré de préférence. Il s’affiche à côté du nom, en haut de la boutique."
            pic={logo}
            onPick={setLogo}
            onError={(m) => flash(m, 'error')}
          />
          <div className="color-grid">
            {(
              [
                ['Couleur principale', primary, setPrimary],
                ['Couleur d’accent', accent, setAccent],
                ['Fond de la boutique', background, setBackground],
              ] as const
            ).map(([label, value, set]) => (
              <label key={label} className="form-label" style={{ display: 'grid', gap: 8 }}>
                {label}
                <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <input
                    type="color"
                    value={value}
                    onChange={(e) => set(e.target.value)}
                    style={{
                      width: 40,
                      height: 32,
                      border: '1px solid var(--line)',
                      padding: 0,
                      background: 'none',
                    }}
                  />
                  <code style={{ fontSize: 12, letterSpacing: 0, textTransform: 'none' }}>
                    {value}
                  </code>
                </span>
              </label>
            ))}
          </div>
          {darkBackground ? (
            <p className="form-error">
              Ce fond est trop foncé : le texte de la boutique ne serait plus lisible. Choisissez
              une couleur plus claire, sinon la boutique garde son fond actuel.
            </p>
          ) : (
            background.toLowerCase() !== PAPER && (
              <button type="button" className="text-link" onClick={() => setBackground(PAPER)}>
                Revenir au fond d’origine
              </button>
            )
          )}
          <label className="form-label" htmlFor="b-banner">
            Message du bandeau, facultatif
          </label>
          <input
            id="b-banner"
            className="form-control"
            maxLength={140}
            value={banner}
            onChange={(e) => setBanner(e.target.value)}
            placeholder="Livraison offerte dès 30 000 FCFA"
          />
          {banner.trim() && (
            <>
              <label className="form-label" htmlFor="b-href">
                Lien du message, facultatif
              </label>
              <input
                id="b-href"
                className="form-control"
                type="url"
                value={href}
                onChange={(e) => setHref(e.target.value)}
                placeholder="https://…"
              />
            </>
          )}
          <PicturePicker
            label="Image du bandeau, facultative"
            hint="Une image large (par exemple 1600 × 600) en haut de la page d’accueil de la boutique."
            pic={cover}
            onPick={setCover}
            onError={(m) => flash(m, 'error')}
            wide
          />
          <fieldset className="hero-fields">
            <legend className="form-label">Accueil de la boutique</legend>
            <p className="form-hint">
              Les premiers mots que voient vos clients. Laissez une ligne vide pour garder le texte
              proposé.
            </p>
            {(
              [
                ['eyebrow', 'Petit titre', 60, defaultEyebrow(shopName)],
                ['title', 'Titre', 90, DEFAULT_TITLE],
                ['text', 'Texte', 240, defaultText(shopName)],
                ['cta', 'Bouton', 30, DEFAULT_CTA],
              ] as const
            ).map(([k, label, max, placeholder]) => (
              <div key={k}>
                <label className="form-label" htmlFor={`h-${k}`}>
                  {label}
                </label>
                {k === 'text' ? (
                  <textarea
                    id={`h-${k}`}
                    className="form-control"
                    rows={2}
                    maxLength={max}
                    value={hero[k] ?? ''}
                    onChange={(e) => setLine(k)(e.target.value)}
                    placeholder={placeholder}
                  />
                ) : (
                  <input
                    id={`h-${k}`}
                    className="form-control"
                    maxLength={max}
                    value={hero[k] ?? ''}
                    onChange={(e) => setLine(k)(e.target.value)}
                    placeholder={placeholder}
                  />
                )}
                {k === 'title' && (
                  <p className="form-hint">
                    Après la virgule, le titre s’écrit en italique, dans la couleur d’accent.
                  </p>
                )}
              </div>
            ))}
          </fieldset>
          <div className="modal-actions">
            <button type="submit" className="button primary small" disabled={busy || !nameOk}>
              {busy ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </form>
        <ShopPreview
          name={shopName}
          hero={hero}
          logo={logo.url}
          primary={primary}
          accent={accent}
          background={background}
          banner={banner.trim()}
          cover={cover.url}
          url={vendor.store_url}
        />
      </div>
    </section>
  );
}

/** The top of the shop page in the colours being chosen (the same rules as the storefront: storefrontStyle). */
function ShopPreview({
  name,
  hero,
  logo,
  primary,
  accent,
  background,
  banner,
  cover,
  url,
}: {
  name: string;
  hero: HeroTexts;
  logo: string | null;
  primary: string;
  accent: string;
  background: string;
  banner: string;
  cover: string | null;
  url: string;
}) {
  const vars = storefrontStyle({
    logo_url: logo,
    primary_color: primary,
    accent_color: accent,
    background_color: background,
    banner: null,
  });
  const copy = heroCopy(name, hero);
  return (
    <aside className="shop-preview" aria-label="Aperçu de la boutique">
      <div className="shop-preview-frame" style={vars as CSSProperties}>
        <div className="sp-announce">
          <span className="sp-dot" aria-hidden="true" />
          {banner || 'Paiement en bitcoin, directement à la boutique'}
        </div>
        <div className="sp-header">
          <span className="sp-mark">
            {logo ? <img src={logo} alt="" /> : <span>{name.slice(0, 1).toUpperCase()}</span>}
            <b>{name}</b>
          </span>
          <ShoppingBag size={16} />
        </div>
        {cover && <img className="sp-cover" src={cover} alt="" />}
        <div className="sp-hero">
          <p className="sp-eyebrow">{copy.eyebrow}</p>
          <p className="sp-title">
            {copy.title[0]} {copy.title[1] && <em>{copy.title[1]}</em>}
          </p>
          <p className="sp-text">{copy.text}</p>
          <span className="sp-button">{copy.cta}</span>
        </div>
      </div>
      <p className="form-hint">
        Aperçu mis à jour pendant que vous modifiez.{' '}
        <a href={url} target="_blank" rel="noopener noreferrer">
          Ouvrir ma boutique
        </a>
      </p>
    </aside>
  );
}

function AlertsSection({ vendor, save }: { vendor: Vendor; save: Save }) {
  const [push, setPush] = useState(vendor.settings.alerts.web_push);
  return (
    <Section
      title="Alertes"
      sub="Commandes payées, clients qui attendent, rappels d’abonnement"
      onSubmit={() =>
        patch(save, { settings: { alerts: { web_push: push } } }, 'Alertes enregistrées.')
      }
    >
      <label className="form-label" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={push}
          onChange={(e) => setPush(e.target.checked)}
          style={{ accentColor: '#173b32' }}
        />
        Envoyer des notifications à mes appareils
      </label>
      <p className="form-hint">
        Le tableau de bord affiche toujours les alertes en direct, même notifications coupées.
      </p>
      <div className="info-list" style={{ padding: 0, marginTop: 8 }}>
        <PushToggle />
      </div>
    </Section>
  );
}

/**
 * Alerts by email: the vendor gives an address, Selly sends a 6-digit code there, and alerts go to it once the code
 * comes back (core: POST /vendors/me/alerts/email, then /verify). Paid orders, waiting customers, renewals.
 */
function EmailSection({ vendor, save }: { vendor: Vendor; save: Save }) {
  const email = vendor.settings.alerts.email;
  const [address, setAddress] = useState(email?.pending_address ?? '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const confirmed = email?.address ?? null;
  const pending = email?.pending_address ?? null;
  const run = async (task: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await task();
    } catch {
      // mutate shows core's explanation.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Alertes par e-mail" sub="Les mêmes alertes, dans votre boîte mail">
      {confirmed && (
        <div className="info-list" style={{ padding: 0 }}>
          <div className="info-row">
            <span>Adresse confirmée</span>
            <b>{confirmed}</b>
          </div>
        </div>
      )}
      {confirmed && (
        <label className="form-label" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={email?.enabled ?? true}
            disabled={busy}
            onChange={(e) =>
              run(() =>
                save(
                  '/vendors/me',
                  {
                    method: 'PATCH',
                    body: { settings: { alerts: { email_enabled: e.target.checked } } },
                  },
                  e.target.checked ? 'Alertes par e-mail activées.' : 'Alertes par e-mail coupées.',
                ),
              )
            }
            style={{ accentColor: '#173b32' }}
          />
          Recevoir les alertes par e-mail
        </label>
      )}

      {pending ? (
        <>
          <p className="form-hint">
            Un code à 6 chiffres a été envoyé à <b>{pending}</b>. Il expire dans 15 minutes.
          </p>
          <label className="form-label" htmlFor="em-code">
            Code reçu
          </label>
          <div className="code-row">
            <input
              id="em-code"
              className="form-control"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="123456"
            />
            <button
              type="button"
              className="button primary small"
              disabled={busy || code.length !== 6}
              onClick={() =>
                run(async () => {
                  await save(
                    '/vendors/me/alerts/email/verify',
                    { method: 'POST', body: { code } },
                    'Adresse confirmée : vos alertes arrivent aussi par e-mail.',
                  );
                  setCode('');
                })
              }
            >
              Confirmer
            </button>
            <button
              type="button"
              className="button small ghost"
              disabled={busy}
              onClick={() =>
                run(() =>
                  save(
                    '/vendors/me/alerts/email',
                    { method: 'POST', body: { address: pending } },
                    'Nouveau code envoyé.',
                  ),
                )
              }
            >
              Renvoyer
            </button>
          </div>
        </>
      ) : (
        <>
          <label className="form-label" htmlFor="em-address">
            {confirmed ? 'Changer d’adresse' : 'Votre adresse e-mail'}
          </label>
          <div className="zone-add" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }}>
            <input
              id="em-address"
              className="form-control"
              type="email"
              autoComplete="email"
              maxLength={254}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="vous@exemple.com"
            />
            <button
              type="button"
              className="button small"
              disabled={busy || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(address.trim())}
              onClick={() =>
                run(() =>
                  save(
                    '/vendors/me/alerts/email',
                    { method: 'POST', body: { address: address.trim() } },
                    'Code envoyé : regardez votre boîte mail.',
                  ),
                )
              }
            >
              Recevoir un code
            </button>
          </div>
        </>
      )}
      {(confirmed || pending) && (
        <button
          type="button"
          className="text-link"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await save('/vendors/me/alerts/email', { method: 'DELETE' }, 'Adresse retirée.');
              setAddress('');
              setCode('');
            })
          }
        >
          {confirmed ? 'Retirer l’adresse' : 'Annuler'}
        </button>
      )}
    </Section>
  );
}
