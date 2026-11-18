// What the customer's message asks for, and what the reply claims, when the code must not leave it to
// the model (architecture.md section 8.4). Small models (ollama:qwen2.5:7b) were seen accepting the
// customer's price, announcing orders they never created, and quoting totals without quote_cart.

const HUMAN_REQUEST = [
  /(?:\bparler|\bdiscuter|(?:^|\s)[ée]changer)\s+(?:avec\s+|ak\s+|à\s+|a\s+|au\s+|aux\s+)(?:le\s+|la\s+|un\s+|une\s+|votre\s+)?(?:vendeu[rs]e?|propri[ée]taire|g[ée]rant|patron|humain|personne|quelqu'un)/i,
  /\bpasse[zr]?[- ]moi\s+(?!le\s+prix)\w+/i,
  /\b(?:un|une)\s+(?:humain|vraie?\s+personne)\b/i,
  /\b(?:talk|speak)\s+to\s+(?:the\s+)?(?:owner|seller|vendor|a\s+human|someone|a\s+person)/i,
  // Wolof « wax ak boroom » (parler avec le propriétaire), checked by a native speaker; most people
  // write without accents and often with one « o » (« borom »).
  /\bwax\s+ak\s+boro{1,2}m\b/i,
];

/** « Je veux parler au vendeur », « Passez-moi Awa », « un humain », « talk to the owner ». */
export function asksForHuman(text: string): boolean {
  return HUMAN_REQUEST.some((re) => re.test(text));
}

const NEGOTIATION = [
  /\bdernier\s+prix\b/i,
  /\b(?:remise|r[ée]duction|rabais|promo|ristourne)\b/i,
  /\b(?:baisser|diminuer)\b/i,
  /\bmoins\s+cher\b/i,
  // « faites-moi la robe à 10 000 », « fais-moi ça à 12 000 », « laissez-la à 8000 »
  // (\b only knows ASCII letters in JavaScript: no \b before « à ».)
  /\b(?:fai(?:s|tes)|laisse[sz]?)[- ](?:moi|nous|la|le|les)\b[^.?!\d]{0,40}?(?:\s[àa]|\spour)\s*\d/i,
  /\b(?:last|best)\s+price\b|\bdiscount\b/i,
  // Wolof « wàññi » (baisser), checked by a native speaker; without accents « ñ » is written gn, ny or n.
  /\bw[àa](?:ñ{1,2}|gn|ny|n{1,2})i/i,
];

/** « Dernier prix ? », « une remise ? », « faites-moi la robe à 10 000 », « wàññil ma ». */
export function negotiates(text: string): boolean {
  return NEGOTIATION.some((re) => re.test(text));
}

const ORDER_CLAIM =
  /\bcommande\s+(?:a\s+(?:bien\s+)?[ée]t[ée]\s+|est\s+(?:bien\s+)?)?(?:cr[ée]{2}e?|enregistr[ée]e?|confirm[ée]e?|valid[ée]e?|pass[ée]e?)\b|\border\s+(?:has\s+been\s+|is\s+)?(?:created|placed|confirmed)\b/i;

/** « Commande créée avec succès », « votre commande a été enregistrée », « your order is confirmed ». */
export function claimsOrder(text: string): boolean {
  return ORDER_CLAIM.test(text);
}

const AMOUNT = String.raw`(\d{1,3}(?:[   .]\d{3})+|\d+)\s*(?:fcfa|f\s?cfa|xof|francs?)`;
const TOTAL_RE = new RegExp(String.raw`\btotal\b[^.!?\n\d]{0,60}?` + AMOUNT, 'gi');

/** The amounts a reply calls a total (« Le total est de 20 000 FCFA »). */
export function totalsIn(text: string): number[] {
  return [...text.matchAll(TOTAL_RE)].map((m) => Number((m[1] ?? '').replace(/[   .]/g, '')));
}
