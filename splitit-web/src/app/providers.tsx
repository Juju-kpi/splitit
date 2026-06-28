'use client'
// src/app/providers.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { useAuthStore } from '@/store/authStore'
import { FullScreenSpinner } from '@/components/ui'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
})

function AuthInitializer({ children }: { children: React.ReactNode }) {
  const initialize = useAuthStore(s => s.initialize)
  const isLoading = useAuthStore(s => s.isLoading)

  useEffect(() => { initialize() }, [])

  if (isLoading) return <FullScreenSpinner />
  return <>{children}</>
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthInitializer>{children}</AuthInitializer>
    </QueryClientProvider>
  )
}
