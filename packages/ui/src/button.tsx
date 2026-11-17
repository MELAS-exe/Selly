import type { ButtonHTMLAttributes } from 'react';

// Tap targets are at least 44 px (architecture.md section 10).
export function Button({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`min-h-11 rounded-lg bg-black px-4 text-white disabled:opacity-50 ${className}`}
      {...props}
    />
  );
}
