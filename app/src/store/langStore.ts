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

// Hook i18n RÉACTIF : s'abonne à la locale du store, donc tout écran qui
// utilise useT() se re-render automatiquement quand l'utilisateur change de
// langue dans les réglages. Usage : const t = useT(); ... t('auth.login')
export function useT() {
  const locale = useLangStore(s => s.locale);
  return (key: string, options?: Record<string, any>) => i18n.t(key, { locale, ...options });
}

// ── Formatage monétaire ────────────────────────────────────────────────────
// Symboles pour les devises supportées (voir settings : CHF/EUR/USD/GBP)
const CURRENCY_SYMBOLS: Record<string, string> = {
  CHF: 'CHF',
  EUR: '€',
  USD: '$',
  GBP: '£',
};

export function currencySymbol(currency?: string): string {
  const c = currency ?? useLangStore.getState().currency;
  return CURRENCY_SYMBOLS[c] ?? c;
}

// Formate un montant avec la devise choisie.
// EUR/USD/GBP → symbole collé usuel ; CHF → suffixe "CHF" (habitude suisse).
export function formatMoney(amount: number, currency?: string): string {
  const c = currency ?? useLangStore.getState().currency;
  const n = amount.toFixed(2);
  switch (c) {
    case 'EUR': return `${n} €`;
    case 'USD': return `$${n}`;
    case 'GBP': return `£${n}`;
    case 'CHF':
    default:    return `${n} ${CURRENCY_SYMBOLS[c] ?? c}`;
  }
}

// Hook : renvoie une fonction de formatage liée à la devise courante,
// qui se re-render automatiquement quand l'utilisateur change de devise.
export function useFormatMoney() {
  const currency = useLangStore(s => s.currency);
  return (amount: number) => formatMoney(amount, currency);
}
