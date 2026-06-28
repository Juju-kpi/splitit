// src/store/authStore.ts
import { create } from 'zustand'

interface User {
  id: string
  email: string
  username: string
  avatarColor: string
  createdAt: string
  preferredLanguage?: string
  preferredCurrency?: string
  notifExpense?: boolean
  notifReminder?: boolean
}

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  setUser: (user: User) => void
  login: (tokens: { accessToken: string; refreshToken: string }, user: User) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>(set => ({
  user: null,
  isAuthenticated: false,

  setUser: user => set({ user }),

  login: (tokens, user) => {
    localStorage.setItem('splitit_token', tokens.accessToken)
    localStorage.setItem('splitit_refresh', tokens.refreshToken)
    set({ user, isAuthenticated: true })
  },

  logout: () => {
    localStorage.removeItem('splitit_token')
    localStorage.removeItem('splitit_refresh')
    set({ user: null, isAuthenticated: false })
  },
}))
