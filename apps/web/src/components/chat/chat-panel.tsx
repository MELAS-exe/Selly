'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChatBubbleIn } from '@/components/motion/chat-bubble-in';
import { TypingDots } from '@/components/motion/typing-dots';
import { addLine, readCart, writeCart } from '@/lib/cart';
import { ensureSession, newClientMessageId, sendMessage, subscribe } from '@/lib/chat';
import type { CartCard, ChatMessage, ChatSession } from '@/lib/chat-types';
import { formatMoney, formatOptions } from '@/lib/format';
import { SellyMark } from '../brand/selly-mark';
import { openCart } from '../storefront/cart-drawer';

type Status = 'loading' | 'ready' | 'failed';

/**
 * The real customer chat (architecture.md 3.8): one session per shop kept in localStorage, the
 * agent's greeting, live replies over the stream in lib/chat.ts, quick replies, and product and
 * order cards. Mounted once per trigger click; `productId`/`productTitle` attach the product in
 * view, so the agent's first turn and the chat history both carry it.
 */
export function ChatPanel({
  slug,
  storeName,
  whatsappLink,
  productId,
  productTitle,
  onClose,
}: {
  slug: string;
  storeName: string;
  whatsappLink: string | null;
  productId?: string;
  productTitle?: string;
  onClose: () => void;
}) {
  const titleId = useId();
  const [status, setStatus] = useState<Status>('loading');
  const [session, setSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [typing, setTyping] = useState(false);
  const [mode, setMode] = useState<'bot' | 'human'>('bot');
  const [modeLabel, setModeLabel] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // De-duplicate by id inside the state updater so React's Strict Mode double-invocation of
  // effects never blocks messages: each invocation sees the actual committed state, not a ref
  // that survived from a previous aborted render cycle.
  const addMessages = useCallback((incoming: ChatMessage[]) => {
    if (incoming.length === 0) return;
    setMessages((prev) => {
      const existing = new Set(prev.map((m) => m.id));
      const toAdd = incoming.filter((m) => !existing.has(m.id));
      return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
    });
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { session: s } = await ensureSession(slug, { productId });
        if (!active) return;
        setSession(s);
        addMessages(s.messages);
        setStatus('ready');
      } catch {
        if (active) setStatus('failed');
      }
    })();
    return () => {
      active = false;
    };
    // One session per mount: a new product context opens a fresh panel instance (key on the trigger).
  }, [slug, productId, addMessages]);

  useEffect(() => {
    if (!session) return;
    const last = messages.at(-1)?.id;
    const stop = subscribe(session.session_token, last, (e) => {
      if (e.event === 'message') {
        addMessages([e.data]);
        setTyping(false);
      } else if (e.event === 'typing') {
        setTyping(e.data.on);
      } else if (e.event === 'mode') {
        setMode(e.data.mode);
        setModeLabel(e.data.label ?? null);
      }
    });
    return stop;
    // Re-subscribing on every message would reopen the stream constantly; it only needs the
    // session, which is stable for the panel's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, addMessages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, typing]);

  async function submit(text: string, quickReplyId?: string) {
    if (!session || sending || (!text.trim() && !quickReplyId)) return;
    setSending(true);
    setDraft('');
    try {
      const sent = await sendMessage(session.session_token, {
        client_message_id: newClientMessageId(),
        text: text.trim(),
        quick_reply_id: quickReplyId,
        context: productId ? { product_id: productId } : undefined,
      });
      addMessages([sent]);
      setTyping(true);
    } catch {
      // The bar keeps the typed text so the customer can just try again.
      setDraft(text);
    } finally {
      setSending(false);
    }
  }

  // Escape closes, as in the dashboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // A cart the vendor proposed goes into the shop's cart, where the customer picks quantities and delivery.
  function openProposal(card: CartCard) {
    let lines = readCart(slug);
    for (const l of card.lines)
      lines = addLine(lines, {
        variant_id: l.variant_id,
        product_slug: l.product_slug,
        title: l.title,
        options: l.options,
        unit_price: l.unit_price,
        quantity: 1,
      });
    writeCart(slug, lines);
    onClose();
    openCart();
  }

  // Rendered at the shop root: a parent with a transform or a backdrop-filter (the product page, the header) would
  // trap a fixed overlay inside it, leaving the page readable through the "backdrop".
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex justify-end bg-ink/40"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* A sheet from the right, full screen on a phone: as Selly in the vendor's dashboard. */}
      <div className="sf-chat-sheet flex h-full w-full max-w-[440px] flex-col border-l border-line bg-paper shadow-[-24px_0_48px_-32px_rgba(23,59,50,0.6)]">
        <div className="flex min-h-0 flex-1 flex-col">
          <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-line px-4 py-4">
            <SellyMark className="w-7 text-[var(--sf-accent-text,#173b32)]" />
            <div className="min-w-0">
              <h2 id={titleId} className="sf-serif truncate text-2xl leading-none font-medium">
                Selly
              </h2>
              <p className="mt-1 truncate text-sm text-muted">
                {mode === 'human'
                  ? (modeLabel ?? 'Le vendeur répond')
                  : `Conseillère de ${storeName}`}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fermer"
              className="press grid size-11 place-items-center border border-line text-muted"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none">
                <path
                  d="M6 6l12 12M18 6 6 18"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </header>

          {productTitle && (
            <p className="border-b border-line bg-mist px-4 py-2 text-[0.9375rem] text-muted">
              À propos de <span className="font-semibold text-ink">{productTitle}</span>
            </p>
          )}

          {status === 'loading' && (
            <p role="status" className="p-4 text-muted">
              Connexion…
            </p>
          )}

          {status === 'failed' && (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
              <p className="text-muted">
                Le chat ne répond pas pour le moment.
                {whatsappLink && ' Écrivez au vendeur en attendant.'}
              </p>
              {whatsappLink && (
                <a
                  href={whatsappLink}
                  rel="noopener"
                  className="press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] bg-indigo px-4 font-semibold text-paper"
                >
                  Écrire sur WhatsApp
                </a>
              )}
            </div>
          )}

          {status === 'ready' && session && (
            <>
              <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
                <p className="pb-1 text-center text-xs text-muted">{session.disclosure}</p>
                {messages.map((m) => (
                  <MessageBubble
                    key={m.id}
                    message={m}
                    onQuickReply={submit}
                    onOpenCart={openProposal}
                  />
                ))}
                {typing && (
                  <div className="mr-auto">
                    <TypingDots />
                  </div>
                )}
              </div>
              <form
                className="flex items-end gap-2 border-t border-line p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit(draft);
                }}
              >
                <label className="sr-only" htmlFor={`${titleId}-input`}>
                  Votre message
                </label>
                <textarea
                  id={`${titleId}-input`}
                  rows={1}
                  value={draft}
                  maxLength={1000}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void submit(draft);
                    }
                  }}
                  placeholder="Écrivez votre message…"
                  className="min-h-11 flex-1 resize-none rounded-[var(--radius-control)] border border-line px-3 py-2"
                />
                <button
                  type="submit"
                  disabled={sending || !draft.trim()}
                  className="press grid min-h-11 min-w-11 place-items-center rounded-[var(--radius-control)] bg-indigo text-paper disabled:opacity-40"
                  aria-label="Envoyer"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none">
                    <path
                      d="M4 11l16-7-7 16-2-7-7-2Z"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>,
    document.querySelector('.sf') ?? document.body,
  );
}

/** The vendor's proposed cart: its items, and « Commander » to finish it in the shop's cart. */
function CartProposal({ card, onOpen }: { card: CartCard; onOpen: (card: CartCard) => void }) {
  return (
    <div className="mt-2 rounded-[var(--radius-tile)] border border-line p-3">
      <p className="font-semibold">Votre panier</p>
      <ul className="mt-2 space-y-2">
        {card.lines.map((l) => (
          <li key={l.variant_id} className="flex items-center gap-3">
            {l.image_url && (
              <img src={l.image_url} alt="" className="size-10 shrink-0 object-cover" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate">{l.title}</span>
              <span className="block text-sm text-muted">{formatOptions(l.options)}</span>
            </span>
            <span className="tnum shrink-0">{formatMoney(l.unit_price)}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => onOpen(card)}
        className="press mt-3 min-h-11 w-full bg-ink px-4 font-semibold text-paper"
      >
        Commander
      </button>
    </div>
  );
}

function MessageBubble({
  message,
  onQuickReply,
  onOpenCart,
}: {
  message: ChatMessage;
  onQuickReply: (text: string, quickReplyId: string) => void;
  onOpenCart: (card: CartCard) => void;
}) {
  if (message.author === 'system') {
    return (
      <p role="status" className="text-center text-sm text-muted">
        {message.text}
      </p>
    );
  }
  const from = message.author === 'customer' ? 'customer' : 'agent';
  return (
    <div>
      {message.author_label && from === 'agent' && (
        <p className="mb-1 text-xs font-medium text-muted">{message.author_label}</p>
      )}
      {message.text && <ChatBubbleIn from={from}>{message.text}</ChatBubbleIn>}
      {message.cards.map((card) =>
        card.type === 'cart' ? (
          <CartProposal key="cart" card={card} onOpen={onOpenCart} />
        ) : card.type === 'product' ? (
          <a
            key={card.product_id}
            href={card.url}
            className="mt-2 flex items-center gap-3 rounded-[var(--radius-tile)] border border-line p-3"
          >
            {card.image_url && (
              <img
                src={card.image_url}
                alt=""
                className="size-14 shrink-0 rounded-[var(--radius-control)] object-cover"
              />
            )}
            <span>
              <span className="block font-semibold">{card.title}</span>
              <span className="tnum block">{formatMoney(card.price)}</span>
            </span>
          </a>
        ) : (
          <a
            key={card.number}
            href={card.checkout_url}
            className="mt-2 block rounded-[var(--radius-tile)] border border-line p-3"
          >
            <span className="block font-semibold">Commande {card.number}</span>
            <span className="tnum block">{formatMoney(card.total)}</span>
          </a>
        ),
      )}
      {message.quick_replies.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {message.quick_replies.map((q) => (
            <button
              key={q.id}
              type="button"
              onClick={() => onQuickReply(q.label, q.id)}
              className="press min-h-9 rounded-full border border-line px-3 text-sm font-medium"
            >
              {q.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
