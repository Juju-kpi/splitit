// src/store/authStore.ts
import { create } from 'zustand'
import { authApi, userApi, saveTokens, clearTokens, getAccessToken, authSignal } from '@/lib/api'
import { User } from '@/types'

interface AuthState {
  user: User | null
  isLoading: boolean
  isAuthenticated: boolean
  initialize: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  register: (email: string, username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  setUser: (user: User) => void
}

export const useAuthStore = create<AuthState>(set => ({
  user: null,
  isLoading: true,
  isAuthenticated: false,

  initialize: async () => {
    try {
      const token = getAccessToken()
      if (token) {
        const user = await userApi.getMe()
        set({ user, isAuthenticated: true })
      }
    } catch {
      clearTokens()
    } finally {
      set({ isLoading: false })
    }
  },

  login: async (email, password) => {
    const data = await authApi.login(email, password)
    saveTokens(data.accessToken, data.refreshToken)
    set({ user: data.user, isAuthenticated: true })
  },

  register: async (email, username, password) => {
    const data = await authApi.register(email, username, password)
    saveTokens(data.accessToken, data.refreshToken)
    set({ user: data.user, isAuthenticated: true })
  },

  logout: async () => {
    const refresh = typeof window !== 'undefined' ? localStorage.getItem('splitit_refresh') : null
    if (refresh) {
      try { await authApi.logout(refresh) } catch {}
    }
    clearTokens()
    set({ user: null, isAuthenticated: false })
  },

  setUser: user => set({ user }),
}))

authSignal.onLogout(() => useAuthStore.getState().logout())
