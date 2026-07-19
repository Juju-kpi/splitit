// src/store/langStore.ts
import { create } from 'zustand'
import { translate } from '@/i18n'

interface LangState {
  locale: string
  currency: string
  setLocale: (l: string) => void
  setCurrency: (c: string) => void
}

// Persist the choice in localStorage so it survives reloads (client only).
function initial<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  return (localStorage.getItem(key) as unknown as T) ?? fallback
}

export const useLangStore = create<LangState>(set => ({
  locale: initial('splitit_locale', 'fr'),
  currency: initial('splitit_currency', 'EUR'),
  setLocale: l => {
    if (typeof window !== 'undefined') localStorage.setItem('splitit_locale', l)
    set({ locale: l })
  },
  setCurrency: c => {
    if (typeof window !== 'undefined') localStorage.setItem('splitit_currency', c)
    set({ currency: c })
  },
}))

// i18n (reactive): any component using useT() re-renders on language change.
export function useT() {
  const locale = useLangStore(s => s.locale)
  return (key: string, vars?: Record<string, any>) => translate(locale, key, vars)
}

const CURRENCY_SYMBOLS: Record<string, string> = { CHF: 'CHF', EUR: '\u20AC', USD: '$', GBP: '\u00A3' }

export function currencySymbol(currency?: string): string {
  const c = currency ?? useLangStore.getState().currency
  return CURRENCY_SYMBOLS[c] ?? c
}

// Same display convention as the mobile app for consistency.
export function formatMoney(amount: number, currency?: string): string {
  const c = currency ?? useLangStore.getState().currency
  const n = amount.toFixed(2)
  switch (c) {
    case 'EUR': return `${n} \u20AC`
    case 'USD': return `$${n}`
    case 'GBP': return `\u00A3${n}`
    case 'CHF':
    default:    return `${n} ${CURRENCY_SYMBOLS[c] ?? c}`
  }
}

export function useCurrency() {
  return useLangStore(s => s.currency)
}

export function useFormatMoney() {
  const currency = useLangStore(s => s.currency)
  return (amount: number) => formatMoney(amount, currency)
}
