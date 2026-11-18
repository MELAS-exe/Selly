'use client';

// The vendor assistant (architecture.md 3.4 and 6.5): the same engine as the shop's chat, in vendor mode. "Ajoute
// ces baskets à 20 000, 5 paires du 40 au 44" changes the catalog after one confirmation. From the first dashboard
// (PR #30), in the draft's design.

import { useEffect, useRef, useState } from 'react';
import { errorText, newKey, useDashboard, useResource } from '../data';
import { fmtWhen } from '../format';
import { Bot, Send } from '../icons';
import type { ChatMessage, Page } from '../types';
import { Failed, Loading, PageTitle } from '../ui';

const EXAMPLES = [
  'Combien de commandes cette semaine ?',
  'Ajoute 5 robes wax noires en 42',
  'Passe le sac Niani à 27 000',
  'Quels produits sont presque épuisés ?',
];

export function Assistant() {
  const { request, refresh, flash } = useDashboard();
  const history = useResource<Page<ChatMessage>>('/assistant/messages');
  const [extra, setExtra] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const loaded = history.data?.data ?? [];
  const ids = new Set(loaded.map((m) => m.id));
  const messages = [...loaded, ...extra.filter((m) => !ids.has(m.id))];
  const last = messages.at(-1);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, busy]);

  async function send(body: { text?: string; quick_reply_id?: string }) {
    setBusy(true);
    try {
      const turn = await request<{ message: ChatMessage; reply: ChatMessage }>(
        '/assistant/messages',
        {
          method: 'POST',
          body: { client_message_id: newKey(), ...body },
        },
      );
      setExtra((x) => [...x, turn.message, turn.reply]);
      setText('');
      // A command may have changed prices, stock or orders.
      refresh();
    } catch (err) {
      flash(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageTitle
        eyebrow="Assistant vendeur · votre boutique"
        title={
          <>
            Votre <em>assistant</em>
          </>
        }
        description="Demandez vos chiffres, ajoutez un produit, changez un prix ou un stock en une phrase. Rien ne change sans votre confirmation."
      />
      {history.error && !history.data ? (
        <Failed error={history.error} retry={history.reload} />
      ) : !history.data ? (
        <Loading />
      ) : (
        <div className="panel conversation-layout" style={{ gridTemplateColumns: '1fr' }}>
          <div className="chat-pane">
            <div className="chat-thread" aria-live="polite">
              {messages.length === 0 && (
                <div className="empty-state">
                  <Bot size={24} strokeWidth={1.5} />
                  <strong>Que voulez-vous faire ?</strong>
                  Essayez une de ces phrases :
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 8,
                      justifyContent: 'center',
                      marginTop: 16,
                    }}
                  >
                    {EXAMPLES.map((e) => (
                      <button
                        key={e}
                        type="button"
                        className="button small"
                        onClick={() => setText(e)}
                      >
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
                  <div>{m.text}</div>
                  <div className="bubble-time">
                    {m.author === 'vendor' ? 'Vous · ' : 'Assistant · '}
                    {fmtWhen(m.created_at)}
                  </div>
                </div>
              ))}
              {busy && (
                <div className="bubble bot" role="status">
                  <span className="bubble-time" style={{ marginTop: 0 }}>
                    L’assistant réfléchit…
                  </span>
                </div>
              )}
              {!busy && last && last.author !== 'vendor' && last.quick_replies.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {last.quick_replies.map((q) => (
                    <button
                      key={q.id}
                      type="button"
                      className="button small"
                      onClick={() => send({ quick_reply_id: q.id })}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              )}
              <div ref={end} />
            </div>
            <form
              className="chat-compose"
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim()) send({ text: text.trim() });
              }}
            >
              <input
                value={text}
                maxLength={2000}
                onChange={(e) => setText(e.target.value)}
                placeholder="Ex. Ajoute 5 robes wax noires en 42 à 15 000"
                aria-label="Votre demande à l’assistant"
              />
              <button
                type="submit"
                className="button primary small"
                disabled={busy || !text.trim()}
                aria-label="Envoyer"
              >
                <Send size={14} />
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
