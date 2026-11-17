import type { CSSProperties } from 'react';

/**
 * TypingDots: the assistant is writing. Three dots bob in turn; still under reduced motion.
 * The label is read by screen readers (role="status"), the dots are hidden from them.
 *
 * Usage: {pending && <TypingDots />}
 */
export function TypingDots({ label = "L'assistant écrit…" }: { label?: string }) {
  return (
    <span
      role="status"
      className="inline-flex items-center gap-1.5 rounded-[var(--radius-tile)] bg-mist px-4 py-3"
    >
      <span className="sr-only">{label}</span>
      {[0, 1, 2].map((k) => (
        <span
          key={k}
          aria-hidden="true"
          className="typing-dot motion-loop"
          style={{ '--k': k } as CSSProperties}
        />
      ))}
    </span>
  );
}
