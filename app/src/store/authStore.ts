// app/src/store/authStore.ts
import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { authApi, saveTokens, clearTokens, authSignal } from '../services/api';
import { User } from '../../../shared/types';
import { userApi } from '../services/api';
import i18n from '../i18n';

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;

  initialize: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isLoading: true,
  isAuthenticated: false,

  initialize: async () => {
  try {
    const token = await SecureStore.getItemAsync('splitit_access_token');
    if (token) {
      const user = await userApi.getMe(); // ← au lieu de authApi.me()
      // Restaurer la langue immédiatement
      if (user.preferredLanguage) {
        i18n.locale = user.preferredLanguage;
      }
      set({ user, isAuthenticated: true });
    }
  } catch {
    await clearTokens();
  } finally {
    set({ isLoading: false });
  }
},

  login: async (email, password) => {
    const data = await authApi.login(email, password);
    await saveTokens(data.accessToken, data.refreshToken);
    set({ user: data.user, isAuthenticated: true });
  },

  register: async (email, username, password) => {
    const data = await authApi.register(email, username, password);
    await saveTokens(data.accessToken, data.refreshToken);
    set({ user: data.user, isAuthenticated: true });
  },

  logout: async () => {
    const refresh = await SecureStore.getItemAsync('splitit_refresh_token');
    if (refresh) {
      try { await authApi.logout(refresh); } catch {}
    }
    await clearTokens();
    set({ user: null, isAuthenticated: false });
  },

  setUser: (user) => set({ user }),
}));

// Wire up API interceptor logout signal
authSignal.onLogout(() => useAuthStore.getState().logout());
