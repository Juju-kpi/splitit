'use client'
// src/app/page.tsx
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/authStore'

export default function Home() {
  const router = useRouter()
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)

  useEffect(() => {
    router.replace(isAuthenticated ? '/dashboard' : '/auth/login')
  }, [isAuthenticated])

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
