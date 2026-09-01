// src/lib/api.ts
import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

const BACKENDS = [
  process.env.NEXT_PUBLIC_API_URL_PRIMARY || 'https://splitit-9x32.onrender.com',
  process.env.NEXT_PUBLIC_API_URL_FALLBACK || 'https://splitit-13dz.onrender.com',
]

// Le repli ne sert que tant que le primaire est reellement injoignable. On le
// resonde au bout d'une minute, sur /health (l'ancien code interrogeait
// /api/health, qui n'existe pas, et restait 50 minutes sur le repli).
let primaryDownSince: number | null = null
const RECHECK_AFTER_MS = 60_000

function timeoutSignal(ms: number): AbortSignal | undefined {
  try { return AbortSignal.timeout(ms) } catch { return undefined }
}

async function resolveBaseUrl(): Promise<string> {
  if (primaryDownSince === null) return BACKENDS[0]
  if (Date.now() - primaryDownSince < RECHECK_AFTER_MS) return BACKENDS[1]
  try {
    const res = await fetch(`${BACKENDS[0]}/health`, { signal: timeoutSignal(4000) })
    if (res.ok) { primaryDownSince = null; return BACKENDS[0] }
  } catch { /* toujours indisponible */ }
  primaryDownSince = Date.now()
  return BACKENDS[1]
}
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
  // Un service Render gratuit s'endort apres 15 min et met 30 a 60 s a
  // redemarrer : en dessous d'une minute, le client abandonne avant lui.
  timeout: 60000,
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  config.baseURL = `${await resolveBaseUrl()}/api`
  const token = getAccessToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

let isRefreshing = false
let refreshQueue: Array<(token: string) => void> = []

api.interceptors.response.use(
  res => res,
  async error => {
    const status = error.response?.status
    const original = error.config

    // Bascule sur le repli uniquement si la requete visait le primaire
    const isDown = status === 503 || status === 429 || !status
    const wasOnPrimary = typeof original?.baseURL === 'string' && original.baseURL.startsWith(BACKENDS[0])
    if (isDown && wasOnPrimary && !original._fallback) {
      original._fallback = true
      primaryDownSince = Date.now()
      original.baseURL = `${BACKENDS[1]}/api`
      return api(original)
    }

    // Refresh token
    if (status === 401 && !original._retry && original.url !== '/auth/refresh') {
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
        const activeUrl = await resolveBaseUrl()
        const { data } = await axios.post(`${activeUrl}/api/auth/refresh`, { refreshToken })
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
  // force = true → quitter malgré un solde non réglé (409 UNSETTLED_BALANCE)
  leave: (groupId: string, force = false) =>
    api.post(`/groups/${groupId}/leave`, { force }).then(r => r.data.data),
}

export const expensesApi = {
  create: (payload: any) => api.post('/expenses', payload).then(r => r.data.data),
  get: (id: string) => api.get(`/expenses/${id}`).then(r => r.data.data),
  delete: (id: string) => api.delete(`/expenses/${id}`).then(r => r.data.data),
  // undo = retirer sa propre confirmation
  settle: (id: string, memberId: string, undo?: boolean) =>
    api.patch(`/expenses/${id}/settle`, { memberId, undo }).then(r => r.data.data),
  update: (id: string, payload: any) => api.put(`/expenses/${id}`, payload).then(r => r.data.data),
  duplicate: (id: string) => api.post(`/expenses/${id}/duplicate`).then(r => r.data.data),
  updateItems: (id: string, payload: any) => api.put(`/expenses/${id}/items`, payload).then(r => r.data.data),
}

// Remboursements : un versement de X a Y, valide par les deux. Contrairement
// a expensesApi.settle, ne depend d'aucune depense — donc capable de solder
// un solde issu d'une compensation en chaine.
export const settlementsApi = {
  list: (groupId: string) =>
    api.get('/settlements', { params: { groupId } }).then(r => r.data.data),
  create: (payload: {
    groupId: string; fromMemberId: string; toMemberId: string;
    amount: number; currency?: string; method?: string; note?: string;
  }) => api.post('/settlements', payload).then(r => r.data.data),
  // undo = retirer sa propre confirmation
  confirm: (id: string, undo?: boolean) =>
    api.post(`/settlements/${id}/confirm`, { undo }).then(r => r.data.data),
  // undo = remettre en service un remboursement annule
  cancel: (id: string, undo?: boolean) =>
    api.post(`/settlements/${id}/cancel`, { undo }).then(r => r.data.data),
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
  updateNotificationPrefs: (payload: { pushToken?: string | null; webPushToken?: string | null; notifExpense: boolean; notifReminder: boolean }) =>
    api.patch('/users/notification-prefs', payload).then(r => r.data.data),
  updatePreferences: (payload: { preferredLanguage?: string; preferredCurrency?: string }) =>
    api.patch('/users/preferences', payload).then(r => r.data.data),
  requestDataExport: () => api.post('/users/export').then(r => r.data.data),
  getMe: () => api.get('/users/me').then(r => r.data.data),
}