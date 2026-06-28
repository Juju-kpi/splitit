// src/lib/api.ts
import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://splitit-9x32.onrender.com'
const KEYS = { accessToken: 'splitit_token', refreshToken: 'splitit_refresh' }

export function saveTokens(access: string, refresh: string) {
  localStorage.setItem(KEYS.accessToken, access)
  localStorage.setItem(KEYS.refreshToken, refresh)
}
export function clearTokens() {
  localStorage.removeItem(KEYS.accessToken)
  localStorage.removeItem(KEYS.refreshToken)
}
export function getAccessToken() {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(KEYS.accessToken)
}

const api: AxiosInstance = axios.create({
  baseURL: `${BASE_URL}/api`,
  timeout: 20000,
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAccessToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

let isRefreshing = false
let refreshQueue: Array<(token: string) => void> = []

api.interceptors.response.use(
  res => res,
  async error => {
    const original = error.config
    if (error.response?.status === 401 && !original._retry && original.url !== '/auth/refresh') {
      original._retry = true
      if (isRefreshing) {
        return new Promise(resolve => {
          refreshQueue.push((token: string) => {
            original.headers.Authorization = `Bearer ${token}`
            resolve(api(original))
          })
        })
      }
      isRefreshing = true
      try {
        const refreshToken = localStorage.getItem(KEYS.refreshToken)
        if (!refreshToken) throw new Error('No refresh token')
        const { data } = await axios.post(`${BASE_URL}/api/auth/refresh`, { refreshToken })
        const { accessToken: newAccess, refreshToken: newRefresh } = data.data
        saveTokens(newAccess, newRefresh)
        refreshQueue.forEach(cb => cb(newAccess))
        refreshQueue = []
        original.headers.Authorization = `Bearer ${newAccess}`
        return api(original)
      } catch (e) {
        clearTokens()
        authSignal.logout()
      } finally {
        isRefreshing = false
      }
    }
    return Promise.reject(error)
  }
)

export const authSignal = {
  logout: () => {},
  onLogout(cb: () => void) { this.logout = cb },
}

export default api

export const authApi = {
  register: (email: string, username: string, password: string) =>
    api.post('/auth/register', { email, username, password }).then(r => r.data.data),
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }).then(r => r.data.data),
  me: () => api.get('/auth/me').then(r => r.data.data),
  logout: (refreshToken: string) => api.post('/auth/logout', { refreshToken }),
  forgotPassword: (email: string) => api.post('/auth/forgot-password', { email }).then(r => r.data.data),
  resetPassword: (token: string, password: string) =>
    api.post('/auth/reset-password', { token, password }).then(r => r.data.data),
  deleteAccount: (password: string) =>
    api.delete('/auth/account', { data: { password } }).then(r => r.data.data),
}

export const groupsApi = {
  list: () => api.get('/groups').then(r => r.data.data),
  get: (id: string) => api.get(`/groups/${id}`).then(r => r.data.data),
  create: (name: string, emoji: string, displayName: string) =>
    api.post('/groups', { name, emoji, displayName }).then(r => r.data.data),
  joinPreview: (inviteCode: string) => api.get(`/groups/join-preview/${inviteCode}`).then(r => r.data.data),
  join: (inviteCode: string, displayName: string, claimMemberId?: string) =>
    api.post(`/groups/join/${inviteCode}`, { displayName, claimMemberId }).then(r => r.data.data),
  addMember: (groupId: string, displayName: string) =>
    api.post(`/groups/${groupId}/members`, { displayName }).then(r => r.data.data),
}

export const expensesApi = {
  create: (payload: any) => api.post('/expenses', payload).then(r => r.data.data),
  get: (id: string) => api.get(`/expenses/${id}`).then(r => r.data.data),
  delete: (id: string) => api.delete(`/expenses/${id}`).then(r => r.data.data),
  settle: (id: string, memberId: string) => api.patch(`/expenses/${id}/settle`, { memberId }).then(r => r.data.data),
  update: (id: string, payload: any) => api.put(`/expenses/${id}`, payload).then(r => r.data.data),
  duplicate: (id: string) => api.post(`/expenses/${id}/duplicate`).then(r => r.data.data),
  updateItems: (id: string, payload: any) => api.put(`/expenses/${id}/items`, payload).then(r => r.data.data),
}

export const ocrApi = {
  scan: (file: File) => {
    const form = new FormData()
    form.append('receipt', file, file.name || 'receipt.jpg')
    return api.post('/ocr/scan', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data.data)
  },
  saveCorrection: (correction: any) => api.post('/ocr/correction', correction).then(r => r.data.data),
  getStats: () => api.get('/ocr/stats').then(r => r.data.data),
}

export const userApi = {
  updateProfile: (payload: { avatarColor?: string; username?: string }) =>
    api.patch('/users/profile', payload).then(r => r.data.data),
  updateNotificationPrefs: (payload: { pushToken: string | null; notifExpense: boolean; notifReminder: boolean }) =>
    api.patch('/users/notification-prefs', payload).then(r => r.data.data),
  updatePreferences: (payload: { preferredLanguage?: string; preferredCurrency?: string }) =>
    api.patch('/users/preferences', payload).then(r => r.data.data),
  requestDataExport: () => api.post('/users/export').then(r => r.data.data),
  getMe: () => api.get('/users/me').then(r => r.data.data),
}
