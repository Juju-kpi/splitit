'use client'
// src/app/(tabs)/home/page.tsx
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/authStore'
import { ScreenHeader, ActionPill, SectionLabel } from '@/components/ui'
import { GroupsList } from '@/components/GroupsList'
import { useT } from '@/store/langStore'

export default function HomePage() {
  const t = useT()
  const router = useRouter()
  const user = useAuthStore(s => s.user)

  return (
    <div>
      <ScreenHeader
        title="Splitit"
        accentWord="it"
        subtitle={t('home.greeting', { name: user?.username })}
        rightContent={
          <>
            <ActionPill label={t('common.join')} icon="🔗" onClick={() => router.push('/group/join')} />
            <ActionPill label={t('common.new')} primary onClick={() => router.push('/group/new')} />
          </>
        }
      />
      <div className="px-5"><SectionLabel label={t('groups.active')} /></div>
      <GroupsList />
      <div className="h-6" />
    </div>
  )
}
