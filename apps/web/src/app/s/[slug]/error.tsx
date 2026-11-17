'use client';

// Shown when core does not answer. Says what happened and what to do, in the shop's voice.
export default function ShopError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-xl px-4 pt-16">
      <h1 className="text-[1.75rem] leading-tight font-bold">
        Boutique momentanément indisponible
      </h1>
      <p className="mt-3 text-muted">
        La page n'a pas pu se charger. Vérifiez votre connexion, puis réessayez.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 min-h-11 rounded-[var(--radius-control)] bg-indigo px-5 font-semibold text-paper"
      >
        Réessayer
      </button>
    </main>
  );
}
