'use client';

// Chats: the inbox (unread first) and one thread, with its live stream, taking over from the assistant and
// handing back. Served by the agent; the session cookie is checked through core (architecture.md 5.2 F).

import Link from 'next/link';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { api } from '@/lib/browser-api';
import { useInvalidate, useResource } from '@/lib/dashboard/resource';
import { relativeTime } from '@/lib/dashboard/time';
import type {
  ChatMessage,
  ConversationMode,
  ConversationModeName,
  ConversationSummary,
  Page,
} from '@/lib/dashboard/types';
import { dash } from '@/lib/i18n/dashboard';
import { describeError } from '@/lib/onboarding';
import { ChatBubbleIn } from '../motion/chat-bubble-in';
import { TypingDots } from '../motion/typing-dots';
import { btn, EmptyState, ErrorState, ListSkeleton, Skeleton, Title } from './ui';

const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

const modeStyle: Record<ConversationModeName, string> = {
  bot: 'bg-d-paper-deep text-d-ink',
  human: 'bg-d-paid-soft text-d-paid',
  paused: 'bg-d-cancelled-soft text-d-cancelled',
};

function ModeTag({ mode }: { mode: ConversationModeName }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-sm font-medium ${modeStyle[mode]}`}
    >
      {dash.chats.mode[mode]}
    </span>
  );
}

/** Unread first, then the most recent message. */
export function sortInbox(list: ConversationSummary[]): ConversationSummary[] {
  return [...list].sort(
    (a, b) =>
      Number(b.unread_count > 0) - Number(a.unread_count > 0) ||
      b.last_message.created_at.localeCompare(a.last_message.created_at),
  );
}

function Inbox({ selectedId }: { selectedId?: string }) {
  const list = useResource<Page<ConversationSummary>>('conversations', '/conversations');
  const now = new Date();
  if (list.error) return <ErrorState error={list.error} onRetry={list.refresh} />;
  if (list.loading) return <ListSkeleton />;
  const items = sortInbox(list.data?.data ?? []);
  if (!items.length)
    return <EmptyState compact title={dash.chats.empty} text={dash.chats.emptyHint} />;
  return (
    <ul className="border-t border-d-hairline">
      {items.map((c) => (
        <li key={c.id}>
          <Link
            href={`/app/discussions/${c.id}`}
            aria-current={c.id === selectedId ? 'page' : undefined}
            className={`block min-h-16 border-b border-d-hairline px-2 py-3 ${
              c.id === selectedId ? 'bg-d-paper-deep' : 'hover:bg-d-paper-deep/60'
            }`}
          >
            <span className="flex items-center justify-between gap-3">
              <span className={`truncate ${c.unread_count ? 'font-semibold' : 'font-medium'}`}>
                {c.customer_label}
              </span>
              <span className="shrink-0 text-sm text-d-ink-soft">
                {relativeTime(c.last_message.created_at, now)}
              </span>
            </span>
            <span className="mt-0.5 block truncate text-d-ink-soft">
              {c.last_message.author !== 'customer' &&
                `${dash.chats.author[c.last_message.author]}: `}
              {c.last_message.text ?? dash.chats.noText}
            </span>
            <span className="mt-1.5 flex flex-wrap items-center gap-2">
              <ModeTag mode={c.mode} />
              {c.order_number && (
                <span className="text-sm text-d-ink-soft">{dash.chats.order(c.order_number)}</span>
              )}
              {c.unread_count > 0 && (
                <span className="tnum ml-auto rounded-full bg-d-ink px-2 text-sm text-d-paper">
                  {dash.chats.unread(c.unread_count)}
                </span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

const bubble: Record<ChatMessage['author'], string> = {
  customer: 'rounded-[14px] rounded-bl-sm bg-d-paper-deep text-d-ink',
  agent: 'rounded-[14px] rounded-br-sm border border-d-hairline bg-d-paper text-d-ink',
  vendor: 'rounded-[14px] rounded-br-sm bg-d-ink text-d-paper',
  system: '',
};

function Bubble({ m, still }: { m: ChatMessage; still: boolean }) {
  if (m.author === 'system')
    return <p className="mx-auto max-w-[90%] py-1 text-center text-sm text-d-ink-soft">{m.text}</p>;
  const right = m.author !== 'customer';
  return (
    <div className={`flex flex-col ${right ? 'items-end' : 'items-start'}`}>
      <span className="mb-0.5 px-1 text-sm text-d-ink-soft">
        {m.author === 'vendor'
          ? (m.author_label ?? dash.chats.author.vendor)
          : dash.chats.author[m.author]}{' '}
        · {time.format(new Date(m.created_at))}
      </span>
      <ChatBubbleIn
        from={m.author === 'customer' ? 'agent' : 'customer'}
        side={right ? 'end' : 'start'}
        still={still}
        className={`${bubble[m.author]} whitespace-pre-wrap`}
      >
        {m.author === 'agent' && (
          <span
            aria-hidden="true"
            className="mr-1.5 inline-block size-2 rounded-full bg-d-lime-deep align-middle"
          />
        )}
        {m.text ?? dash.chats.noText}
        {m.cards?.map((c, i) =>
          c.url ? (
            <a
              key={i}
              href={c.url}
              target="_blank"
              rel="noopener"
              className="mt-2 block underline underline-offset-4"
            >
              {c.title ?? c.url}
            </a>
          ) : null,
        )}
      </ChatBubbleIn>
    </div>
  );
}

function Thread({ id }: { id: string }) {
  const invalidate = useInvalidate();
  const conv = useResource<Page<ConversationSummary>>('conversations', '/conversations');
  const summary = conv.data?.data.find((c) => c.id === id);
  const history = useResource<Page<ChatMessage>>(
    `thread:${id}`,
    `/conversations/${encodeURIComponent(id)}/messages`,
  );
  const [live, setLive] = useState<ChatMessage[]>([]);
  const [mode, setMode] = useState<ConversationMode | null>(null);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const inputId = useId();

  const current: ConversationMode | null =
    mode ?? (summary ? { id, mode: summary.mode, human_until: summary.human_until } : null);

  // Live stream of the open thread only.
  useEffect(() => {
    setLive([]);
    setMode(null);
    const es = new EventSource(`/api/v1/conversations/${encodeURIComponent(id)}/events`);
    let typingTimer: ReturnType<typeof setTimeout> | undefined;
    es.addEventListener('message', (e) => {
      try {
        const m = JSON.parse((e as MessageEvent<string>).data) as ChatMessage;
        setTyping(false);
        setLive((l) => (l.some((x) => x.id === m.id) ? l : [...l, m]));
        invalidate(['conversations']);
      } catch {}
    });
    es.addEventListener('mode', (e) => {
      try {
        setMode(JSON.parse((e as MessageEvent<string>).data) as ConversationMode);
        invalidate(['conversations']);
      } catch {}
    });
    es.addEventListener('typing', () => {
      setTyping(true);
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => setTyping(false), 8000);
    });
    return () => {
      clearTimeout(typingTimer);
      es.close();
    };
  }, [id, invalidate]);

  const loaded = history.data?.data ?? [];
  const loadedIds = new Set(loaded.map((m) => m.id));
  const messages = [...loaded, ...live.filter((m) => !loadedIds.has(m.id))].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, typing]);

  async function switchMode(next: ConversationModeName) {
    setError(null);
    try {
      const r = await api<ConversationMode>(`/conversations/${encodeURIComponent(id)}/mode`, {
        method: 'POST',
        body: next === 'human' ? { mode: next, minutes: 30 } : { mode: next },
      });
      setMode(r);
      invalidate(['conversations', 'metrics']);
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setSending(true);
    setError(null);
    const client_message_id = crypto.randomUUID();
    try {
      const m = await api<ChatMessage>(`/conversations/${encodeURIComponent(id)}/messages`, {
        method: 'POST',
        body: { client_message_id, text: body },
      });
      setLive((l) => (l.some((x) => x.id === m.id) ? l : [...l, m]));
      setText('');
      // Writing hands the chat to the vendor for 30 minutes (architecture.md 6.6).
      setMode((prev) => ({
        id,
        mode: 'human',
        human_until: new Date(Date.now() + 30 * 60_000).toISOString(),
        ...(prev?.mode === 'human' ? { human_until: prev.human_until } : {}),
      }));
      invalidate(['conversations', 'metrics']);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSending(false);
    }
  }

  if (history.error) return <ErrorState error={history.error} onRetry={history.refresh} />;

  return (
    <article aria-labelledby="thread-title" className="flex min-h-[60dvh] flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-d-hairline pb-3">
        <div>
          <h2 id="thread-title" className="font-display text-3xl">
            {summary?.customer_label ?? <Skeleton className="h-8 w-40" />}
          </h2>
          {summary?.order_number && (
            <p className="text-d-ink-soft">{dash.chats.order(summary.order_number)}</p>
          )}
        </div>
        {current && <ModeTag mode={current.mode} />}
      </header>

      {current && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-d-hairline py-3">
          <p className="text-d-ink-soft">
            {current.mode === 'human'
              ? dash.chats.youUntil(
                  current.human_until ? time.format(new Date(current.human_until)) : '…',
                )
              : current.mode === 'paused'
                ? dash.chats.paused
                : dash.chats.botAnswering}
          </p>
          {current.mode === 'human' ? (
            <button type="button" className={btn.secondary} onClick={() => switchMode('bot')}>
              {dash.chats.handBack}
            </button>
          ) : (
            <button type="button" className={btn.primary} onClick={() => switchMode('human')}>
              {dash.chats.takeOver}
            </button>
          )}
        </div>
      )}

      <div aria-live="polite" aria-relevant="additions" className="flex-1 space-y-3 py-4">
        {history.loading ? (
          <div className="space-y-3">
            <Skeleton className="h-12 w-2/3" />
            <Skeleton className="ml-auto h-12 w-1/2" />
            <Skeleton className="h-12 w-3/5" />
          </div>
        ) : (
          messages.map((m) => <Bubble key={m.id} m={m} still={loadedIds.has(m.id)} />)
        )}
        {typing && (
          <div className="flex justify-end">
            <TypingDots label={dash.chats.typing} />
          </div>
        )}
        <div ref={end} />
      </div>

      <form
        onSubmit={send}
        className="sticky bottom-16 border-t border-d-hairline bg-d-paper pt-3 lg:bottom-0 lg:pb-2"
      >
        <label htmlFor={inputId} className="sr-only">
          {dash.chats.placeholder}
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id={inputId}
            rows={1}
            value={text}
            maxLength={2000}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={dash.chats.placeholder}
            className="min-h-11 flex-1 resize-none rounded-[6px] border border-d-hairline bg-d-paper px-3 py-2.5 focus:border-d-ink focus:outline-none"
          />
          <button type="submit" disabled={sending || !text.trim()} className={btn.primary}>
            {dash.chats.send}
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-2 text-d-alert">
            {error}
          </p>
        )}
      </form>
    </article>
  );
}

export function Chats({ selectedId }: { selectedId?: string }) {
  return (
    <div className="mx-auto max-w-6xl">
      <div className={selectedId ? 'hidden lg:block' : ''}>
        <Title>{dash.chats.title}</Title>
      </div>
      <div className="lg:grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.2fr)] lg:gap-10">
        <div className={selectedId ? 'hidden lg:block' : ''}>
          <Inbox selectedId={selectedId} />
        </div>
        <div className={selectedId ? '' : 'hidden lg:block'}>
          {selectedId ? (
            <>
              <Link href="/app/discussions" className={`${btn.quiet} mb-2 lg:hidden`}>
                ← {dash.chats.title}
              </Link>
              <div className="lg:border-l lg:border-d-hairline lg:pl-10">
                <Thread id={selectedId} />
              </div>
            </>
          ) : (
            <p className="mt-16 border-l border-d-hairline pl-10 text-d-ink-soft">
              {dash.chats.pick}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
