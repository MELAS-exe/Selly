import type { ReactNode } from 'react';

/**
 * ChatBubbleIn: a chat message that arrives on a light spring (--ease-spring) from its own
 * corner, via @starting-style: it animates when it is inserted, with no JavaScript. Bubbles
 * already in the page at load do not animate. Under reduced motion it only fades in.
 *
 * `side` puts the bubble on the right ("end") or the left ("start"); by default the customer's are on the right.
 * `className` replaces the colours and shape (the dashboard uses its own). `still` skips the arrival, for a
 * thread that is loaded at once.
 *
 * Usage: messages.map((m) => <ChatBubbleIn key={m.id} from={m.role}>{m.text}</ChatBubbleIn>)
 */
export function ChatBubbleIn({
  from,
  children,
  side,
  className,
  still = false,
}: {
  from: 'customer' | 'agent';
  children: ReactNode;
  side?: 'start' | 'end';
  className?: string;
  still?: boolean;
}) {
  const mine = (side ?? (from === 'customer' ? 'end' : 'start')) === 'end';
  return (
    <div
      data-from={mine ? 'customer' : 'agent'}
      className={`bubble-in ${still ? 'bubble-still' : ''} max-w-[85%] px-4 py-2.5 ${mine ? 'ml-auto' : 'mr-auto'} ${
        className ??
        (mine
          ? 'rounded-[var(--radius-tile)] rounded-br-sm bg-indigo text-paper'
          : 'rounded-[var(--radius-tile)] rounded-bl-sm bg-mist text-ink')
      }`}
    >
      {children}
    </div>
  );
}
