import type { ReactNode } from 'react';

/**
 * ChatBubbleIn: a chat message that arrives on a light spring (--ease-spring) from its own
 * corner, via @starting-style: it animates when it is inserted, with no JavaScript. Bubbles
 * already in the page at load do not animate. Under reduced motion it only fades in.
 *
 * Usage: messages.map((m) => <ChatBubbleIn key={m.id} from={m.role}>{m.text}</ChatBubbleIn>)
 */
export function ChatBubbleIn({
  from,
  children,
}: {
  from: 'customer' | 'agent';
  children: ReactNode;
}) {
  const mine = from === 'customer';
  return (
    <div
      data-from={from}
      className={`bubble-in max-w-[85%] rounded-[var(--radius-tile)] px-4 py-2.5 ${
        mine
          ? 'ml-auto rounded-br-sm bg-indigo text-paper'
          : 'mr-auto rounded-bl-sm bg-mist text-ink'
      }`}
    >
      {children}
    </div>
  );
}
