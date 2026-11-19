'use client';

// Selly for the vendor, over every dashboard page (architecture.md 3.4, 6.5 and 8.1): the same engine as the shop's
// chat, in vendor mode. Questions (« combien de commandes cette semaine ? »), commands (stock, price, orders to
// ship) and new products from a photo and a sentence: the draft's questions come as quick replies and nothing is
// published before « Valider ». Replaces the Brouillons and Assistant pages. Open it from anywhere with openSelly().

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SellyMark } from '@/components/brand/selly-mark';
import { useLang, useT } from '../lang';
import { errorText, newKey, uploadImages, useDashboard, useResource } from './data';
import { fmtWhen } from './format';
import { Camera, Send, X } from './icons';
import type { ChatMessage, Page } from './types';

const EXAMPLES = {
  fr: [
    'Combien de commandes cette semaine ?',
    'Quelles commandes dois-je expédier ?',
    'Quels produits sont presque épuisés ?',
    'Passe le sac Niani à 27 000',
  ],
  en: [
    'How many orders this week?',
    'Which orders should I ship?',
    'Which products are almost sold out?',
    'Put the Kumba bag at 40,000',
  ],
};
const MAX_PHOTOS = 6;

/** Opens Selly; with `photo`, straight to the photo picker (call it from a click, so the browser allows it). */
export const openSelly = (opts: { photo?: boolean } = {}) =>
  window.dispatchEvent(new CustomEvent('selly:assistant', { detail: opts }));

export function SellyAssistant() {
  const t = useT();
  const { request, refresh, flash, demo } = useDashboard();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([]);

  const show = useCallback((photo?: boolean) => {
    setOpen(true);
    // In the same click as the button that asked for it: the picker is always mounted, so this works at once.
    if (photo) picker.current?.click();
  }, []);

  useEffect(() => {
    const onOpen = (e: Event) => show((e as CustomEvent<{ photo?: boolean }>).detail?.photo);
    window.addEventListener('selly:assistant', onOpen);
    return () => window.removeEventListener('selly:assistant', onOpen);
  }, [show]);

  // ?selly=1 (the old Assistant and Brouillons links) opens it once, then leaves the URL clean.
  useEffect(() => {
    if (params.get('selly') !== '1') return;
    setOpen(true);
    router.replace(pathname);
  }, [params, pathname, router]);

  return (
    <>
      <input
        ref={picker}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          const ok = files.filter(
            (f) => /^image\/(jpeg|png|webp)$/.test(f.type) && f.size <= 8 * 1024 * 1024,
          );
          if (ok.length < files.length)
            flash(
              t(
                'Certaines photos sont refusées : JPEG, PNG ou WebP, 8 Mo au plus.',
                'Some photos were refused: JPEG, PNG or WebP, 8 MB at most.',
              ),
              'error',
            );
          setPhotos((all) =>
            [...all, ...ok.map((file) => ({ file, url: URL.createObjectURL(file) }))].slice(
              0,
              MAX_PHOTOS,
            ),
          );
        }}
      />
      {!open && (
        <button
          type="button"
          className="selly-fab"
          onClick={() => show()}
          aria-label={t('Demander à Selly, votre assistante', 'Ask Selly, your assistant')}
        >
          <SellyMark className="selly-fab-mark" />
          <span>Selly</span>
        </button>
      )}
      {open && (
        <Panel
          onClose={() => setOpen(false)}
          pickPhotos={() => picker.current?.click()}
          photos={photos}
          setPhotos={setPhotos}
          request={request}
          refresh={refresh}
          flash={flash}
          demo={demo}
        />
      )}
    </>
  );
}

type Dash = ReturnType<typeof useDashboard>;

function Panel({
  onClose,
  pickPhotos,
  photos,
  setPhotos,
  request,
  refresh,
  flash,
  demo,
}: {
  onClose: () => void;
  pickPhotos: () => void;
  photos: { file: File; url: string }[];
  setPhotos: (p: { file: File; url: string }[]) => void;
  request: Dash['request'];
  refresh: Dash['refresh'];
  flash: Dash['flash'];
  demo: boolean;
}) {
  const t = useT();
  const lang = useLang();
  const history = useResource<Page<ChatMessage>>('/assistant/messages');
  const [extra, setExtra] = useState<ChatMessage[]>([]);
  // Photos sent in this session, shown in their bubble (the history keeps only the message).
  const [sentPhotos, setSentPhotos] = useState<Record<string, string[]>>({});
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const loaded = history.data?.data ?? [];
  const ids = new Set(loaded.map((m) => m.id));
  const messages = [...loaded, ...extra.filter((m) => !ids.has(m.id))];
  const last = messages.at(-1);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, busy, photos.length]);

  useEffect(() => {
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function send(body: { text?: string; quick_reply_id?: string }) {
    setBusy(true);
    try {
      const files = body.quick_reply_id ? [] : photos;
      const imageKeys =
        files.length && !demo
          ? await uploadImages(
              request,
              files.map((p) => p.file),
            )
          : [];
      const turn = await request<{ message: ChatMessage; reply: ChatMessage }>(
        '/assistant/messages',
        {
          method: 'POST',
          body: {
            client_message_id: newKey(),
            ...body,
            ...(imageKeys.length ? { image_keys: imageKeys } : {}),
          },
        },
      );
      if (files.length)
        setSentPhotos((s) => ({ ...s, [turn.message.id]: files.map((p) => p.url) }));
      setExtra((x) => [...x, turn.message, turn.reply]);
      setText('');
      if (!body.quick_reply_id) setPhotos([]);
      // A command may have changed prices, stock, orders or the catalog.
      refresh();
    } catch (err) {
      flash(
        err instanceof Error && err.message === 'upload'
          ? t('L’envoi de la photo a échoué. Réessayez.', 'The photo did not upload. Try again.')
          : errorText(err),
        'error',
      );
    } finally {
      setBusy(false);
    }
  }

  const canSend = !busy && (text.trim() !== '' || photos.length > 0);

  return (
    <div
      className="selly-sheet-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        className="selly-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="selly-title"
      >
        <header className="selly-sheet-head">
          <SellyMark className="selly-sheet-mark" />
          <div>
            <h2 id="selly-title">Selly</h2>
            <p>
              {t(
                'Votre assistante. Rien ne change sans votre confirmation.',
                'Your assistant. Nothing changes without your confirmation.',
              )}
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label={t('Fermer', 'Close')}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>

        <div className="chat-thread selly-thread" aria-live="polite">
          {Boolean(history.error) && !history.data && (
            <p className="form-error">{errorText(history.error)}</p>
          )}
          {history.data && messages.length === 0 && (
            <div className="selly-empty">
              <strong>{t('Que voulez-vous faire ?', 'What would you like to do?')}</strong>
              <button type="button" className="button primary small" onClick={pickPhotos}>
                <Camera size={14} />{' '}
                {t('Ajouter un produit en photo', 'Add a product from a photo')}
              </button>
              <div className="selly-examples">
                {EXAMPLES[lang].map((e) => (
                  <button key={e} type="button" className="button small" onClick={() => setText(e)}>
                    {e}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={`bubble ${m.author === 'vendor' ? 'me' : 'bot'}`}
              style={{ whiteSpace: 'pre-wrap' }}
            >
              {sentPhotos[m.id] ? (
                <div className="selly-bubble-photos">
                  {sentPhotos[m.id]?.map((u) => (
                    <img key={u} src={u} alt="" />
                  ))}
                </div>
              ) : (
                m.kind === 'image' && <div className="bubble-time">{t('Photo', 'Photo')}</div>
              )}
              {m.text && <div>{m.text}</div>}
              <div className="bubble-time">
                {m.author === 'vendor' ? t('Vous · ', 'You · ') : 'Selly · '}
                {fmtWhen(m.created_at)}
              </div>
            </div>
          ))}
          {busy && (
            <div className="bubble bot" role="status">
              <span className="bubble-time" style={{ marginTop: 0 }}>
                {photos.length
                  ? t('Selly lit la photo…', 'Selly is reading the photo…')
                  : t('Selly réfléchit…', 'Selly is thinking…')}
              </span>
            </div>
          )}
          {!busy && last && last.author !== 'vendor' && last.quick_replies.length > 0 && (
            <div className="selly-examples" style={{ justifyContent: 'flex-start' }}>
              {last.quick_replies.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  className="button small"
                  onClick={() => send({ quick_reply_id: q.id, text: q.label })}
                >
                  {q.label}
                </button>
              ))}
            </div>
          )}
          <div ref={end} />
        </div>

        {photos.length > 0 && (
          <div className="selly-attach">
            {photos.map((p, i) => (
              <span key={p.url} className="photo-pick">
                <img src={p.url} alt={`Photo ${i + 1}`} />
                <button
                  type="button"
                  aria-label={t(`Retirer la photo ${i + 1}`, `Remove photo ${i + 1}`)}
                  onClick={() => setPhotos(photos.filter((x) => x !== p))}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            <p className="form-hint">
              {t(
                'Ajoutez une phrase : prix, tailles, quantités (« 5 paires du 40 au 44 à 20 000 »).',
                'Add a sentence: price, sizes, quantities (“2 pairs each, sizes 40 to 44, at 20,000”).',
              )}
            </p>
          </div>
        )}

        <form
          className="chat-compose selly-compose"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSend) send(text.trim() ? { text: text.trim() } : {});
          }}
        >
          <button
            type="button"
            className="icon-button"
            aria-label={t('Joindre une photo', 'Attach a photo')}
            onClick={pickPhotos}
            disabled={photos.length >= MAX_PHOTOS}
          >
            <Camera size={16} />
          </button>
          <textarea
            ref={input}
            rows={1}
            value={text}
            maxLength={2000}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (canSend) send(text.trim() ? { text: text.trim() } : {});
              }
            }}
            placeholder={
              photos.length
                ? t(
                    'Ex. 5 paires du 40 au 44 à 20 000',
                    'E.g. 2 pairs each, sizes 40 to 44, at 20,000',
                  )
                : t('Demandez ou commandez…', 'Ask or give an order…')
            }
            aria-label={t('Votre message à Selly', 'Your message to Selly')}
          />
          <button type="submit" className="button primary small" disabled={!canSend}>
            <Send size={14} />
          </button>
        </form>
      </section>
    </div>
  );
}
