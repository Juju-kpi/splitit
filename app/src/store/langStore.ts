// app/src/store/langStore.ts — NOUVEAU FICHIER
// Store Zustand pour la langue et la devise
// Quand la langue change, tous les composants abonnés se re-rendent

import { create } from 'zustand';
import i18n from '../i18n';

interface LangState {
  locale: string;
  currency: string;
  setLocale: (locale: string) => void;
  setCurrency: (currency: string) => void;
}

export const useLangStore = create<LangState>((set) => ({
  locale: i18n.locale ?? 'fr',
  currency: 'CHF',

  setLocale: (locale: string) => {
    i18n.locale = locale;
    set({ locale });
  },

  setCurrency: (currency: string) => {
    set({ currency });
  },
}));

// Hook pratique pour la devise dans n'importe quel écran
export function useCurrency() {
  return useLangStore(s => s.currency);
}
