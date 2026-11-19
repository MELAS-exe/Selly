'use client';

import { createContext, type ReactNode, useContext } from 'react';
import { moneyIn } from '@/lib/format';
import { type Lang, type T, translator } from '@/lib/i18n';

// The shop's language for the client components under its layout (lib/i18n.ts).

const LangContext = createContext<Lang>('fr');

export function LangProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export const useLang = (): Lang => useContext(LangContext);

/** t('French', 'English') in the shop's language. */
export const useT = (): T => translator(useContext(LangContext));

/** { money, sats } formatters in the shop's language. */
export const useMoney = () => moneyIn(useContext(LangContext));
