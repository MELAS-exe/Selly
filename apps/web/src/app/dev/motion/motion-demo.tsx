'use client';

import { type CSSProperties, type ReactNode, useState } from 'react';
import { ChatBubbleIn } from '@/components/motion/chat-bubble-in';
import { CountdownRing } from '@/components/motion/countdown-ring';
import { ListeningPulse } from '@/components/motion/listening-pulse';
import { NumberRoll } from '@/components/motion/number-roll';
import { PaymentSuccess } from '@/components/motion/payment-success';
import { TypingDots } from '@/components/motion/typing-dots';
import { WaxSkeleton } from '@/components/motion/wax-skeleton';

/** A stand-in QR: a seeded 25x25 grid with the three finder squares. */
function FakeQr() {
  let seed = 7;
  const cells: ReactNode[] = [];
  for (let y = 0; y < 25; y++)
    for (let x = 0; x < 25; x++) {
      seed = (seed * 16807) % 2147483647;
      const finder = (x < 8 && y < 8) || (x > 16 && y < 8) || (x < 8 && y > 16);
      if (!finder && seed % 2)
        cells.push(<rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" />);
    }
  const finder = (x: number, y: number) => (
    <g key={`f${x}${y}`} transform={`translate(${x} ${y})`}>
      <rect width="7" height="7" />
      <rect x="1" y="1" width="5" height="5" fill="#fff" />
      <rect x="2" y="2" width="3" height="3" />
    </g>
  );
  return (
    <svg
      viewBox="-2 -2 29 29"
      className="size-56 rounded-[var(--radius-tile)] bg-paper"
      role="img"
      aria-label="QR code de paiement"
    >
      <g fill="#161a33">
        {cells}
        {finder(0, 0)}
        {finder(18, 0)}
        {finder(0, 18)}
      </g>
    </svg>
  );
}

function Step({
  children,
  onClick,
  wait,
}: {
  children: ReactNode;
  onClick: () => void;
  wait?: number;
}) {
  return (
    <button
      type="button"
      data-demo-step
      data-wait={wait}
      onClick={onClick}
      className="press min-h-11 rounded-[var(--radius-control)] border border-line bg-paper px-4 font-semibold"
    >
      {children}
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line py-8">
      <h2 className="mb-4 text-xl font-bold">{title}</h2>
      {children}
    </section>
  );
}

let id = 0;

export function MotionDemo() {
  const [total, setTotal] = useState(20000);
  const [sats, setSats] = useState(37664);
  const [expiresAt, setExpiresAt] = useState(() => Date.now() + 14 * 60_000 + 32_000);
  const [paid, setPaid] = useState(false);
  const [typing, setTyping] = useState(false);
  const [messages, setMessages] = useState<
    { id: number; from: 'customer' | 'agent'; text: string }[]
  >([{ id: -1, from: 'customer', text: 'Bonjour, vous avez les baskets en 42 ?' }]);
  const [loading, setLoading] = useState(true);

  const say = (from: 'customer' | 'agent', text: string) =>
    setMessages((m) => [...m, { id: id++, from, text }]);

  return (
    <main className="mx-auto max-w-xl px-4 pb-24">
      <div aria-hidden="true" className="wax -mx-4 h-1.5" />
      <h1 className="pt-6 text-[1.75rem] font-bold">Animations Selly</h1>
      <p className="mt-1 text-muted">Chaque brique, dans chaque état. Page de développement.</p>

      <Section title="NumberRoll : total et sats">
        <p className="text-3xl font-bold">
          <NumberRoll value={total} kind="xof" />
        </p>
        <p className="text-muted">
          soit environ <NumberRoll value={sats} kind="sats" />
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Step
            onClick={() => {
              setTotal(45000);
              setSats(84744);
            }}
            wait={1200}
          >
            Livraison ajoutée
          </Step>
          <Step
            onClick={() => {
              setTotal(9500);
              setSats(17890);
            }}
            wait={1200}
          >
            Article retiré
          </Step>
        </div>
      </Section>

      <Section title="CountdownRing : temps pour payer">
        <CountdownRing expiresAt={expiresAt} />
        <div className="mt-4 flex flex-wrap gap-2">
          <Step onClick={() => setExpiresAt(Date.now() + 14 * 60_000 + 32_000)} wait={1500}>
            15 minutes
          </Step>
          <Step onClick={() => setExpiresAt(Date.now() + 2 * 60_000 + 5_000)} wait={1500}>
            2 minutes
          </Step>
          <Step onClick={() => setExpiresAt(Date.now() + 4_000)} wait={5500}>
            4 secondes
          </Step>
        </div>
      </Section>

      <Section title="ListeningPulse puis PaymentSuccess">
        <div className="grid place-items-center py-4">
          <PaymentSuccess paid={paid} message="Paiement reçu. Commande DMF8 confirmée.">
            <ListeningPulse active={!paid}>
              <FakeQr />
            </ListeningPulse>
          </PaymentSuccess>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Step onClick={() => setPaid(false)} wait={3500}>
            En attente
          </Step>
          <Step onClick={() => setPaid(true)} wait={2500}>
            Paiement reçu
          </Step>
        </div>
      </Section>

      <Section title="Chat : TypingDots et ChatBubbleIn">
        <div className="flex flex-col gap-2">
          {messages.map((m) => (
            <ChatBubbleIn key={m.id} from={m.from}>
              {m.text}
            </ChatBubbleIn>
          ))}
          {typing && (
            <div className="mr-auto">
              <TypingDots />
            </div>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Step onClick={() => setTyping(true)} wait={1500}>
            L'assistant écrit
          </Step>
          <Step
            onClick={() => {
              setTyping(false);
              say('agent', 'Oui, il reste deux paires en 42. Je vous en mets une de côté ?');
            }}
            wait={1200}
          >
            Réponse
          </Step>
          <Step onClick={() => say('customer', 'Oui, avec livraison au Plateau.')} wait={1200}>
            Message client
          </Step>
        </div>
      </Section>

      <Section title="WaxSkeleton : chargement">
        <div className="grid grid-cols-2 gap-3">
          {loading ? (
            <>
              <div className="space-y-2">
                <WaxSkeleton shape="tile" label="Chargement des articles" />
                <WaxSkeleton />
              </div>
              <div className="space-y-2">
                <WaxSkeleton shape="tile" />
                <WaxSkeleton className="w-1/2" />
              </div>
            </>
          ) : (
            ['Sac en cuir', 'Baskets blanches'].map((t, i) => (
              <div key={t} className="tile-in" style={{ '--i': i } as CSSProperties}>
                <div
                  className={`wax-tile wax-${i + 2} aspect-square rounded-[var(--radius-tile)]`}
                />
                <p className="mt-2 font-semibold">{t}</p>
              </div>
            ))
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Step onClick={() => setLoading(true)} wait={2000}>
            Chargement
          </Step>
          <Step onClick={() => setLoading(false)} wait={1500}>
            Contenu
          </Step>
        </div>
      </Section>
    </main>
  );
}
