'use client';

import { useEffect } from 'react';

/**
 * Marks the shop's entrance as played. Lives in the shop layout, which stays mounted across
 * navigations, so coming back from a product page does not weave the band again.
 */
export function Woven() {
  useEffect(() => {
    const t = setTimeout(() => {
      document.documentElement.dataset.woven = '';
    }, 1200);
    return () => clearTimeout(t);
  }, []);
  return null;
}
