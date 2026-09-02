'use client'
// src/app/(tabs)/layout.tsx
import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuthStore } from '@/store/authStore'
import { Home, Users, BarChart2, Settings } from 'lucide-react'
import { FullScreenSpinner } from '@/components/ui'

// Lucide est la famille dont Feather, utilise cote mobile, est l'ancetre :
// meme dessin, meme trait, d'une plateforme a l'autre.
const TABS = [
  { href: '/home', Icon: Home, label: 'Accueil' },
  { href: '/groups', Icon: Users, label: 'Groupes' },
  { href: '/stats', Icon: BarChart2, label: 'Stats' },
  { href: '/settings', Icon: Settings, label: 'Réglages' },
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
      <nav className="fixed bottom-0 left-0 right-0 bg-surface border-t border-border flex justify-around items-stretch z-30"
        style={{ height: 'calc(64px + env(safe-area-inset-bottom))', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {TABS.map(tab => {
          const active = pathname === tab.href
          return (
            <Link key={tab.href} href={tab.href} className="flex-1 flex flex-col items-center justify-center gap-1">
              <div className="w-10 h-[30px] flex items-center justify-center">
                <tab.Icon size={21} strokeWidth={1.75} className={active ? 'text-text' : 'text-text3'} />
              </div>
              <span className={`text-[11px] font-medium ${active ? 'text-text' : 'text-text3'}`}>{tab.label}</span>
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
