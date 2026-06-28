// src/store/langStore.ts
import { create } from 'zustand'

interface LangState {
  locale: string
  currency: string
  setLocale: (l: string) => void
  setCurrency: (c: string) => void
}

export const useLangStore = create<LangState>(set => ({
  locale: 'fr',
  currency: 'EUR',
  setLocale: l => set({ locale: l }),
  setCurrency: c => set({ currency: c }),
}))

export function formatMoney(amount: number, currency = 'EUR') {
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}
