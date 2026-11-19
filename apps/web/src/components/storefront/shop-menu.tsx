'use client';

import { useState } from 'react';
import { useT } from '../lang';
import { askSelly } from './ask-button';
import { Menu, MessageCircle, X } from './draft-icons';

/** The phone menu: the same three entries as the desktop navigation. */
export function ShopMenu() {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="sf-icon-btn md:hidden"
        aria-label={
          open ? t('Fermer le menu', 'Close the menu') : t('Ouvrir le menu', 'Open the menu')
        }
        aria-expanded={open}
        aria-controls="shop-menu"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <X size={19} /> : <Menu size={19} />}
      </button>
      {open && (
        <div
          id="shop-menu"
          className="open-rows absolute inset-x-0 top-full border-b border-d-hairline bg-d-paper md:hidden"
        >
          <nav aria-label="Menu" className="grid px-5">
            <a
              href="#catalogue"
              onClick={() => setOpen(false)}
              className="min-h-12 content-center border-b border-d-hairline font-medium"
            >
              {t('La sélection', 'The selection')}
            </a>
            <a
              href="#boutique"
              onClick={() => setOpen(false)}
              className="min-h-12 content-center border-b border-d-hairline font-medium"
            >
              {t('La boutique', 'The shop')}
            </a>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                askSelly();
              }}
              className="flex min-h-12 items-center gap-2 text-left font-medium"
            >
              <MessageCircle size={17} /> {t('Parler à Selly', 'Talk to Selly')}
            </button>
          </nav>
        </div>
      )}
    </>
  );
}
