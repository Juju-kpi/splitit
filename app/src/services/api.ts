// app/src/services/api.ts
// Changements vs version précédente :
//   - groupsApi.joinPreview : GET /groups/join-preview/:code
//   - groupsApi.join        : accepte claimMemberId optionnel

import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';
import { CreateExpenseInput } from '../../../../shared/types';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';
const KEYS = { accessToken: 'splitit_access_token', refreshToken: 'splitit_refresh_token' };

export async function saveTokens(access: string, refresh: string) {
  await SecureStore.setItemAsync(KEYS.accessToken, access);
  await SecureStore.setItemAsync(KEYS.refreshToken, refresh);
}
export async function clearTokens() {
  await SecureStore.deleteItemAsync(KEYS.accessToken);
  await SecureStore.deleteItemAsync(KEYS.refreshToken);
}
export async function getAccessToken() {
  return SecureStore.getItemAsync(KEYS.accessToken);
}

const api: AxiosInstance = axios.create({
  baseURL: `${BASE_URL}/api`,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const token = await SecureStore.getItemAsync(KEYS.accessToken);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let isRefreshing = false;
let refreshQueue: Array<(token: string) => void> = [];

api.interceptors.response.use(
  res => res,
  async error => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      if (isRefreshing) {
        return new Promise(resolve => {
          refreshQueue.push((token: string) => {
            original.headers.Authorization = `Bearer ${token}`;
            resolve(api(original));
          });
        });
      }
      isRefreshing = true;
      try {
        const refreshToken = await SecureStore.getItemAsync(KEYS.refreshToken);
        if (!refreshToken) throw new Error('No refresh token');
        const { data } = await axios.post(`${BASE_URL}/api/auth/refresh`, { refreshToken });
        const { accessToken: newAccess, refreshToken: newRefresh } = data.data;
        await saveTokens(newAccess, newRefresh);
        refreshQueue.forEach(cb => cb(newAccess));
        refreshQueue = [];
        original.headers.Authorization = `Bearer ${newAccess}`;
        return api(original);
      } catch {
        await clearTokens();
        authSignal.logout();
      } finally {
        isRefreshing = false;
      }
    }
    return Promise.reject(error);
  }
);

export const authSignal = {
  logout: () => {},
  onLogout(cb: () => void) { this.logout = cb; },
};

export default api;

export const authApi = {
  register: (email: string, username: string, password: string) =>
    api.post('/auth/register', { email, username, password }).then(r => r.data.data),
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }).then(r => r.data.data),
  me: () => api.get('/auth/me').then(r => r.data.data),
  logout: (refreshToken: string) => api.post('/auth/logout', { refreshToken }),
  forgotPassword: (email: string) =>
    api.post('/auth/forgot-password', { email }).then(r => r.data.data),
  resetPassword: (token: string, password: string) =>
    api.post('/auth/reset-password', { token, password }).then(r => r.data.data),
  deleteAccount: (password: string) =>
    api.delete('/auth/account', { data: { password } }).then(r => r.data.data),
};

export const groupsApi = {
  list: () => api.get('/groups').then(r => r.data.data),
  get: (id: string) => api.get(`/groups/${id}`).then(r => r.data.data),
  create: (name: string, emoji: string, displayName: string) =>
    api.post('/groups', { name, emoji, displayName }).then(r => r.data.data),

  // NOUVEAU — récupère le nom du groupe + membres sans compte avant de rejoindre
  joinPreview: (inviteCode: string) =>
    api.get(`/groups/join-preview/${inviteCode}`).then(r => r.data.data),

  // Étendu — claimMemberId optionnel
  join: (inviteCode: string, displayName: string, claimMemberId?: string) =>
    api.post(`/groups/join/${inviteCode}`, { displayName, claimMemberId }).then(r => r.data.data),

  addMember: (groupId: string, displayName: string) =>
    api.post(`/groups/${groupId}/members`, { displayName }).then(r => r.data.data),
};

export const expensesApi = {
  create: (payload: CreateExpenseInput) =>
    api.post('/expenses', payload).then(r => r.data.data),
  get: (id: string) => api.get(`/expenses/${id}`).then(r => r.data.data),
  delete: (id: string) => api.delete(`/expenses/${id}`).then(r => r.data.data),
  settle: (id: string, memberId: string) =>
    api.patch(`/expenses/${id}/settle`, { memberId }).then(r => r.data.data),
  update: (id: string, payload: any) =>
    api.put(`/expenses/${id}`, payload).then(r => r.data.data),
  updateItems: (id: string, payload: {
    items: Array<{
      name: string; price: number; ocrRaw?: string;
      ocrConfidence?: number; corrected: boolean; assignedToMemberIds: string[];
    }>;
    payments?: Array<{ memberId: string; amount: number }>;
    description?: string;
  }) => api.put(`/expenses/${id}/items`, payload).then(r => r.data.data),
};

export const ocrApi = {
  scan: (imageUri: string) => {
    const form = new FormData();
    form.append('receipt', { uri: imageUri, name: 'receipt.jpg', type: 'image/jpeg' } as any);
    return api.post('/ocr/scan', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data.data);
  },
  saveCorrection: (correction: any) =>
    api.post('/ocr/correction', correction).then(r => r.data.data),
  getStats: () => api.get('/ocr/stats').then(r => r.data.data),
};
