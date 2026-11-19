// The shop's language. A vendor chooses a locale (fr-SN, en, wo-SN); the storefront, the payment page and the
// dashboard speak French unless it is English. Strings are written in both languages where they are used:
// t('Ajouter au panier', 'Add to cart').

export type Lang = 'fr' | 'en';

export const langOf = (locale: string | null | undefined): Lang =>
  locale?.toLowerCase().startsWith('en') ? 'en' : 'fr';

export type T = (fr: string, en: string) => string;

/** The translator for a language: picks the French or the English of each pair. */
export const translator =
  (lang: Lang): T =>
  (fr, en) =>
    lang === 'en' ? en : fr;
