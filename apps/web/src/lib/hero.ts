// The opening words of a shop page (branding.hero). Shared by the storefront and the preview in Réglages, so the
// vendor sees exactly what customers will.

export interface HeroTexts {
  eyebrow: string | null;
  title: string | null;
  text: string | null;
  cta: string | null;
}

export const DEFAULT_TITLE = 'Des belles choses, tout près de vous.';
export const DEFAULT_CTA = 'Voir la sélection';
export const defaultEyebrow = (name: string) => `Bienvenue chez ${name}`;
export const defaultText = (name: string) =>
  `Choisissez, posez vos questions à Selly, et payez en bitcoin, directement à ${name}.`;

/**
 * The big title in two parts: the second shows in the accent colour, in italics. It starts after the first line
 * break, or else after the first comma (the comma stays on the first part). No comma: one plain line.
 */
export function splitTitle(title: string): [string, string] {
  const nl = title.indexOf('\n');
  if (nl >= 0) return [title.slice(0, nl).trim(), title.slice(nl + 1).trim()];
  const comma = title.indexOf(',');
  if (comma >= 0 && title.slice(comma + 1).trim())
    return [title.slice(0, comma + 1), title.slice(comma + 1).trim()];
  return [title.trim(), ''];
}

/** What the shop page shows: the vendor's words, or the defaults for the lines they left empty. */
export function heroCopy(name: string, hero?: Partial<HeroTexts> | null) {
  return {
    eyebrow: hero?.eyebrow?.trim() || defaultEyebrow(name),
    title: splitTitle(hero?.title?.trim() || DEFAULT_TITLE),
    text: hero?.text?.trim() || defaultText(name),
    cta: hero?.cta?.trim() || DEFAULT_CTA,
  };
}
