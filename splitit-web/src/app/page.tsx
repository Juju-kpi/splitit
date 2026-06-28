'use client'
// src/app/page.tsx
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/authStore'
import { FullScreenSpinner } from '@/components/ui'

export default function Home() {
  const router = useRouter()
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)

  useEffect(() => {
    router.replace(isAuthenticated ? '/home' : '/auth/login')
  }, [isAuthenticated])

  return <FullScreenSpinner />
}
