'use client';

// Discussions (the agent's inbox, proxied by next.config.ts). Conversation modes follow architecture.md 4.4 and 6.6:
// the vendor writing in a thread takes over (human, 30 minutes without a message hands it back to the bot), and
// the vendor can pause the bot for one chat or give it back.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { newKey, useDashboard, useResource } from '../data';
import { fmtAgo, fmtTime, fmtWhen, initials, MODE_LABEL } from '../format';
import { Bot, Headset, MessageCircle, Pause, Search, Send, Sparkles } from '../icons';
import type { ChatMessage, ConversationMode, ConversationSummary, Page } from '../types';
import { Empty, Failed, Loading, PageTitle } from '../ui';

const AUTHOR: Record<ChatMessage['author'], string> = {
  customer: '',
  agent: 'Assistant Selly · ',
  vendor: 'Vous · ',
  system: '',
};

export function Discussions({ id }: { id?: string }) {
  const router = useRouter();
  const chats = useResource<Page<ConversationSummary>>('/conversations', 15_000);
  const [search, setSearch] = useState('');

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (chats.data?.data ?? [])
      .filter(
        (c) => !q || `${c.customer_label} ${c.last_message.text ?? ''}`.toLowerCase().includes(q),
      )
      .sort((a, b) => {
        // The ones waiting for the vendor first, then the most recent.
        const w = Number(b.mode === 'human') - Number(a.mode === 'human');
        return w || b.last_message.created_at.localeCompare(a.last_message.created_at);
      });
  }, [chats.data, search]);
  const current = (chats.data?.data ?? []).find((c) => c.id === id);

  // On a wide screen, open the first conversation when none is chosen.
  useEffect(() => {
    if (!id && list[0] && window.matchMedia('(min-width: 701px)').matches)
      router.replace(`/app/discussions/${list[0].id}`);
  }, [id, list, router]);

  // On a phone the thread sits under the list: bring it up when a conversation opens.
  const pane = useRef<HTMLDivElement>(null);
  const opened = Boolean(current);
  useEffect(() => {
    if (id && opened && window.matchMedia('(max-width: 700px)').matches)
      pane.current?.scrollIntoView({ block: 'start' });
  }, [id, opened]);

  return (
    <>
      <PageTitle
        eyebrow="Ventes · conversations"
        title="Discussions"
        description="L’assistant répond aux clients de votre boutique. Reprenez la main quand vous le souhaitez : dès que vous écrivez, il se met en pause 30 minutes."
      />
      {chats.error && !chats.data ? (
        <Failed error={chats.error} retry={chats.reload} />
      ) : !chats.data ? (
        <Loading />
      ) : (
        <div className="panel conversation-layout">
          <div className="conversation-list">
            <div className="conversation-search">
              <label className="search-wrap">
                <Search size={14} />
                <input
                  className="search"
                  aria-label="Chercher une discussion"
                  placeholder="Chercher un client…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
            </div>
            {list.map((c) => (
              <Link
                key={c.id}
                href={`/app/discussions/${c.id}`}
                // The page keeps its place; on a phone the effect above brings the thread up.
                scroll={false}
                className={`conversation ${id === c.id ? 'active' : ''}`}
                aria-current={id === c.id ? 'page' : undefined}
              >
                <div className="avatar">{initials(c.customer_label)}</div>
                <div className="conversation-name">
                  <strong>{c.customer_label}</strong>
                  <p>
                    {c.mode === 'human' ? '✋ ' : ''}
                    {c.last_message.text ?? '…'}
                  </p>
                </div>
                <div className="conversation-meta">
                  {fmtAgo(c.last_message.created_at).replace('il y a ', '')}
                  {(c.unread_count > 0 || c.mode === 'human') && <i className="unread-dot" />}
                </div>
              </Link>
            ))}
            {list.length === 0 && (
              <Empty
                icon={MessageCircle}
                title="Aucune discussion"
                text="Les conversations de votre boutique apparaîtront ici."
              />
            )}
          </div>
          <div className="chat-pane" ref={pane}>
            {current ? (
              <Thread key={current.id} chat={current} />
            ) : (
              <Empty
                icon={MessageCircle}
                title="Choisissez une discussion"
                text="Sélectionnez un client pour voir ses messages."
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Thread({ chat }: { chat: ConversationSummary }) {
  const { mutate, demo, refresh } = useDashboard();
  // The thread's own stream (agent, GET /conversations/{id}/events) brings messages at once; polling stays as a
  // slow fallback for networks that drop it.
  const messages = useResource<Page<ChatMessage>>(`/conversations/${chat.id}/messages`, 20_000);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const count = messages.data?.data.length ?? 0;
  const reload = messages.reload;

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [count, typing]);

  useEffect(() => {
    if (demo) return;
    const es = new EventSource(`/api/v1/conversations/${encodeURIComponent(chat.id)}/events`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    es.addEventListener('message', () => {
      setTyping(false);
      reload();
      refresh();
    });
    es.addEventListener('mode', () => refresh());
    es.addEventListener('typing', () => {
      setTyping(true);
      clearTimeout(timer);
      timer = setTimeout(() => setTyping(false), 8000);
    });
    return () => {
      clearTimeout(timer);
      es.close();
    };
  }, [chat.id, demo, refresh, reload]);

  const setMode = (mode: ConversationMode, done: string) =>
    mutate(`/conversations/${chat.id}/mode`, { method: 'POST', body: { mode } }, done).catch(
      () => {},
    );

  return (
    <>
      <div className="chat-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <div className="avatar">{initials(chat.customer_label)}</div>
          <div style={{ minWidth: 0 }}>
            <div className="chat-head-name">{chat.customer_label}</div>
            <div className="chat-head-sub">
              {chat.order_number ? `Commande ${chat.order_number} · ` : ''}
              {MODE_LABEL[chat.mode]}
              {chat.mode === 'human' && chat.human_until
                ? ` jusqu’à ${fmtTime(chat.human_until)}`
                : ''}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {chat.mode === 'bot' ? (
            <>
              <button
                type="button"
                className="button small"
                onClick={() =>
                  setMode('human', 'Vous avez la main. L’assistant se tait dans cette discussion.')
                }
              >
                <Headset size={13} /> Reprendre la main
              </button>
              <button
                type="button"
                className="button small ghost"
                title="Mettre l’assistant en pause dans cette discussion"
                onClick={() => setMode('paused', 'Assistant en pause dans cette discussion.')}
              >
                <Pause size={13} /> Pause
              </button>
            </>
          ) : (
            <button
              type="button"
              className="button small olive"
              onClick={() => setMode('bot', 'L’assistant reprend cette discussion.')}
            >
              <Sparkles size={13} /> Rendre à l’assistant
            </button>
          )}
        </div>
      </div>
      <div className="chat-thread" aria-live="polite">
        {messages.error && !messages.data ? (
          <Failed error={messages.error} retry={messages.reload} />
        ) : (
          (messages.data?.data ?? []).map((m) =>
            m.author === 'system' ? (
              <div key={m.id} className="bubble system">
                {m.text}
              </div>
            ) : (
              <div
                key={m.id}
                className={`bubble ${m.author === 'vendor' ? 'me' : m.author === 'agent' ? 'bot' : ''}`}
              >
                <div>
                  {m.text ??
                    (m.kind === 'audio'
                      ? '🎤 Message vocal'
                      : m.kind === 'image'
                        ? '📷 Photo'
                        : '')}
                </div>
                {m.cards.length > 0 && (
                  <div className="bubble-time">
                    {m.cards.length} fiche{m.cards.length > 1 ? 's' : ''} produit ou commande
                    envoyée
                    {m.cards.length > 1 ? 's' : ''}
                  </div>
                )}
                <div className="bubble-time">
                  {m.author === 'agent' && (
                    <Bot size={10} style={{ verticalAlign: '-1px', marginRight: 4 }} />
                  )}
                  {AUTHOR[m.author]}
                  {fmtWhen(m.created_at)}
                </div>
              </div>
            ),
          )
        )}
        {typing && (
          <div className="bubble bot" role="status">
            <span className="bubble-time" style={{ marginTop: 0 }}>
              L’assistant écrit…
            </span>
          </div>
        )}
        <div ref={end} />
      </div>
      {chat.mode === 'bot' && (
        <div className="draft-note" style={{ margin: '10px 16px 0' }}>
          L’assistant répond ici. Écrire un message vous donne la main pendant 30 minutes.
        </div>
      )}
      <form
        className="chat-compose"
        onSubmit={async (e) => {
          e.preventDefault();
          const body = text.trim();
          if (!body) return;
          setSending(true);
          try {
            await mutate(`/conversations/${chat.id}/messages`, {
              method: 'POST',
              body: { text: body, client_message_id: newKey() },
            });
            setText('');
          } catch {
          } finally {
            setSending(false);
          }
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Écrire au client…"
          aria-label="Votre réponse"
          maxLength={2000}
        />
        <button
          className="button primary small"
          type="submit"
          disabled={sending || !text.trim()}
          aria-label="Envoyer la réponse"
        >
          <Send size={14} />
        </button>
      </form>
    </>
  );
}
