'use client';

// Sécurité: the Nostr keys that open this shop, and the signed-in devices (docs/api.json, keys and sessions).
// From the first dashboard (PR #30), in the draft's design.

import { useDashboard, useResource } from '../data';
import { fmtAgo } from '../format';
import { Failed, InfoRow, Loading, PageTitle, PanelHead } from '../ui';

interface KeyItem {
  pubkey: string;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
}
interface SessionItem {
  id: string;
  device_label: string | null;
  created_at: string;
  last_seen_at: string;
  current: boolean;
}

export function Security() {
  const { mutate } = useDashboard();
  const keys = useResource<{ data: KeyItem[] }>('/vendors/me/keys');
  const sessions = useResource<{ data: SessionItem[] }>('/auth/sessions');

  return (
    <>
      <PageTitle
        eyebrow="Votre compte · accès"
        title="Sécurité"
        description="Votre boutique s’ouvre avec une clé Nostr, sans mot de passe. Déconnectez un appareil perdu ou prêté."
      />
      <div className="wallet-page-grid">
        <section className="panel">
          <PanelHead title="Clés" sub="Les clés qui ouvrent cette boutique (3 au plus)" />
          {keys.error && !keys.data ? (
            <Failed error={keys.error} retry={keys.reload} />
          ) : !keys.data ? (
            <Loading rows={2} />
          ) : (
            <div className="info-list">
              {keys.data.data.map((k) => (
                <InfoRow
                  key={k.pubkey}
                  label={
                    <span style={{ display: 'block' }}>
                      <b style={{ display: 'block', color: 'var(--ink)' }}>
                        {k.label ?? 'Clé sans nom'}
                      </b>
                      <code style={{ fontSize: 11 }}>
                        {k.pubkey.slice(0, 12)}…{k.pubkey.slice(-8)}
                      </code>
                    </span>
                  }
                  value={k.last_used_at ? `Utilisée ${fmtAgo(k.last_used_at)}` : 'Jamais utilisée'}
                />
              ))}
            </div>
          )}
        </section>
        <section className="panel">
          <PanelHead
            title="Appareils connectés"
            sub="Chaque téléphone ou ordinateur ouvert sur votre boutique"
          />
          {sessions.error && !sessions.data ? (
            <Failed error={sessions.error} retry={sessions.reload} />
          ) : !sessions.data ? (
            <Loading rows={2} />
          ) : (
            <div className="info-list">
              {sessions.data.data.map((s) => (
                <div className="info-row" key={s.id}>
                  <span style={{ display: 'block' }}>
                    <b style={{ display: 'block', color: 'var(--ink)' }}>
                      {s.device_label ?? 'Appareil'}
                      {s.current ? ' · celui-ci' : ''}
                    </b>
                    Vu {fmtAgo(s.last_seen_at)}
                  </span>
                  {!s.current && (
                    <button
                      type="button"
                      className="button small"
                      onClick={() =>
                        mutate(
                          `/auth/sessions/${s.id}`,
                          { method: 'DELETE' },
                          'Appareil déconnecté.',
                        ).catch(() => {})
                      }
                    >
                      Déconnecter
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
