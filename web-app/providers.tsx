'use client'
// src/app/providers.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { useAuthStore } from '@/store/authStore'
import { authApi } from '@/lib/api'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
})

function AuthInitializer({ children }: { children: React.ReactNode }) {
  const { login, logout, isAuthenticated } = useAuthStore()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const token = localStorage.getItem('splitit_token')
    if (!token) { setReady(true); return }
    authApi.me()
      .then(user => { login({ accessToken: token, refreshToken: localStorage.getItem('splitit_refresh') || '' }, user); setReady(true) })
      .catch(() => { logout(); setReady(true) })
  }, [])

  if (!ready) return (
    <div className="min-h-screen bg-bg flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
    </div>
  )
  return <>{children}</>
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthInitializer>{children}</AuthInitializer>
    </QueryClientProvider>
  )
}
