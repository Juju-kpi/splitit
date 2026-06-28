'use client'
// src/app/(tabs)/layout.tsx
import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuthStore } from '@/store/authStore'
import { FullScreenSpinner } from '@/components/ui'

const TABS = [
  { href: '/home', emoji: '🏠', label: 'Accueil' },
  { href: '/groups', emoji: '👥', label: 'Groupes' },
  { href: '/stats', emoji: '📊', label: 'Stats' },
  { href: '/settings', emoji: '⚙️', label: 'Réglages' },
]

export default function TabsLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const isLoading = useAuthStore(s => s.isLoading)

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace('/auth/login')
  }, [isLoading, isAuthenticated])

  if (isLoading) return <FullScreenSpinner />
  if (!isAuthenticated) return <FullScreenSpinner />

  return (
    <div className="min-h-screen bg-bg pb-[calc(64px+env(safe-area-inset-bottom))]">
      {children}
      <nav className="fixed bottom-0 left-0 right-0 glass border-t border-white/5 flex justify-around items-stretch z-30"
        style={{ height: 'calc(64px + env(safe-area-inset-bottom))', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {TABS.map(tab => {
          const active = pathname === tab.href
          return (
            <Link key={tab.href} href={tab.href} className="flex-1 flex flex-col items-center justify-center gap-1">
              <div className={`w-10 h-8 rounded-lg flex items-center justify-center ${active ? 'bg-accent/10 border border-accent/20' : ''}`}>
                <span className="text-xl">{tab.emoji}</span>
              </div>
              <span className={`text-[10px] font-semibold ${active ? 'text-accent2' : 'text-text3'}`}>{tab.label}</span>
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
