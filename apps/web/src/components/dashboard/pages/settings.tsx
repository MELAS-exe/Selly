'use client';

// Réglages: what PATCH /vendors/me and the category routes accept (docs/api.json). HANDOVER.md listed the branding
// and categories screens as missing; delivery zones, the assistant's tone and bargaining live here too.

import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { toE164 } from '@/lib/format';
import { useDashboard, useResource } from '../data';
import { fmtXof } from '../format';
import { Plus, X } from '../icons';
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
        <ShopSection vendor={vendor} save={mutate} />
        <DeliverySection vendor={vendor} save={mutate} />
        <AgentSection vendor={vendor} save={mutate} />
        <BrandingSection vendor={vendor} save={mutate} />
        <CategoriesSection />
        <AlertsSection vendor={vendor} save={mutate} />
      </div>
    </>
  );
}

type Save = ReturnType<typeof useDashboard>['mutate'];
const patch = (save: Save, body: unknown, done: string) =>
  save('/vendors/me', { method: 'PATCH', body }, done).catch(() => {});

function ShopSection({ vendor, save }: { vendor: Vendor; save: Save }) {
  const [name, setName] = useState(vendor.display_name);
  const [phone, setPhone] = useState(vendor.contact_whatsapp_e164 ?? '');
  const e164 = phone.trim() ? toE164(phone) : null;
  const bad = phone.trim() !== '' && !e164;
  return (
    <Section
      title="Boutique"
      sub={vendor.store_url.replace(/^https?:\/\//, '')}
      onSubmit={() =>
        !bad &&
        patch(
          save,
          { display_name: name.trim(), contact_whatsapp_e164: e164 },
          'Boutique enregistrée.',
        )
      }
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
      />
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
    </Section>
  );
}

function DeliverySection({ vendor, save }: { vendor: Vendor; save: Save }) {
  const d = vendor.settings.delivery;
  const [zones, setZones] = useState<DeliveryZone[]>(d?.zones ?? []);
  const [pickup, setPickup] = useState(d?.pickup.available ?? false);
  const [address, setAddress] = useState(d?.pickup.address_text ?? '');
  const [label, setLabel] = useState('');
  const [fee, setFee] = useState('');
  return (
    <Section
      title="Livraison"
      sub="Les frais que l’assistant ajoute au total"
      onSubmit={() =>
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
      <div className="info-list" style={{ padding: 0 }}>
        {zones.map((z) => (
          <div className="info-row" key={z.id}>
            <span>{z.label}</span>
            <b style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {z.fee.amount ? fmtXof(z.fee.amount) : 'Offerte'}
              <button
                type="button"
                className="button small ghost"
                aria-label={`Retirer ${z.label}`}
                onClick={() => setZones((all) => all.filter((x) => x.id !== z.id))}
              >
                <X size={12} />
              </button>
            </b>
          </div>
        ))}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 110px auto',
          gap: 10,
          alignItems: 'end',
        }}
      >
        <div>
          <label className="form-label" htmlFor="z-label">
            Zone
          </label>
          <input
            id="z-label"
            className="form-control"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Pikine"
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
            min="0"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            placeholder="2000"
          />
        </div>
        <button
          type="button"
          className="button small"
          disabled={!label.trim() || zones.length >= 20}
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

function BrandingSection({ vendor, save }: { vendor: Vendor; save: Save }) {
  const b = vendor.settings.branding;
  const [primary, setPrimary] = useState(b?.primary_color ?? '#173b32');
  const [accent, setAccent] = useState(b?.accent_color ?? '#8aae4a');
  const [banner, setBanner] = useState(b?.banner?.text ?? '');
  const [href, setHref] = useState(b?.banner?.href ?? '');
  return (
    <Section
      title="Apparence"
      sub="Les couleurs et le bandeau de votre boutique"
      onSubmit={() =>
        patch(
          save,
          {
            settings: {
              branding: {
                primary_color: primary,
                accent_color: accent,
                banner: banner.trim() ? { text: banner.trim(), href: href.trim() || null } : null,
              },
            },
          },
          'Apparence enregistrée.',
        )
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {(
          [
            ['Couleur principale', primary, setPrimary],
            ['Couleur d’accent', accent, setAccent],
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
              <code style={{ fontSize: 12, letterSpacing: 0, textTransform: 'none' }}>{value}</code>
            </span>
          </label>
        ))}
      </div>
      <label className="form-label" htmlFor="b-banner">
        Bandeau, facultatif
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
            Lien du bandeau, facultatif
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
    </Section>
  );
}

function CategoriesSection() {
  const { mutate } = useDashboard();
  const cats = useResource<{ data: Category[] }>('/vendors/me/categories');
  const [name, setName] = useState('');
  const [list, setList] = useState<Category[]>([]);
  useEffect(() => setList(cats.data?.data ?? []), [cats.data]);
  return (
    <Section
      title="Catégories"
      sub="Les rayons de votre boutique. Supprimer une catégorie ne supprime aucun produit."
    >
      <div className="info-list" style={{ padding: 0 }}>
        {list.map((c) => (
          <div className="info-row" key={c.id}>
            <span>{c.name}</span>
            <button
              type="button"
              className="button small ghost"
              aria-label={`Supprimer ${c.name}`}
              onClick={() =>
                mutate(
                  `/vendors/me/categories/${c.id}`,
                  { method: 'DELETE' },
                  `Catégorie ${c.name} supprimée.`,
                ).catch(() => {})
              }
            >
              <X size={12} />
            </button>
          </div>
        ))}
        {list.length === 0 && <p className="form-hint">Aucune catégorie pour l’instant.</p>}
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'end' }}>
        <div style={{ flex: 1 }}>
          <label className="form-label" htmlFor="c-name">
            Nouvelle catégorie
          </label>
          <input
            id="c-name"
            className="form-control"
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Robes"
          />
        </div>
        <button
          type="button"
          className="button small"
          disabled={name.trim().length < 2}
          onClick={() =>
            mutate(
              '/vendors/me/categories',
              { method: 'POST', body: { name: name.trim() } },
              `Catégorie ${name.trim()} ajoutée.`,
            ).then(
              () => setName(''),
              () => {},
            )
          }
        >
          <Plus size={12} /> Ajouter
        </button>
      </div>
    </Section>
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
        Notifications sur ce téléphone (application installée)
      </label>
      <p className="form-hint">
        Le tableau de bord affiche toujours les alertes en direct, même notifications coupées.
      </p>
    </Section>
  );
}
