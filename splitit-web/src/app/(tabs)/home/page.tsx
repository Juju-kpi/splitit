'use client'
// src/app/(tabs)/home/page.tsx
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/authStore'
import { ScreenHeader, ActionPill, SectionLabel } from '@/components/ui'
import { GroupsList } from '@/components/GroupsList'

export default function HomePage() {
  const router = useRouter()
  const user = useAuthStore(s => s.user)

  return (
    <div>
      <ScreenHeader
        title="Splitit"
        accentWord="it"
        subtitle={`Bonjour, ${user?.username} 👋`}
        rightContent={
          <>
            <ActionPill label="Rejoindre" icon="🔗" onClick={() => router.push('/group/join')} />
            <ActionPill label="+ Nouveau" primary onClick={() => router.push('/group/new')} />
          </>
        }
      />
      <div className="px-5"><SectionLabel label="Groupes actifs" /></div>
      <GroupsList />
      <div className="h-6" />
    </div>
  )
}
