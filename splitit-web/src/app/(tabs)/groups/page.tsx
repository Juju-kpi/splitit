'use client'
// src/app/(tabs)/groups/page.tsx
import { useRouter } from 'next/navigation'
import { ScreenHeader, ActionPill, SectionLabel } from '@/components/ui'
import { GroupsList } from '@/components/GroupsList'
import { useT } from '@/store/langStore'

export default function GroupsPage() {
  const t = useT()
  const router = useRouter()
  return (
    <div>
      <ScreenHeader
        title={t('groups.tab')}
        rightContent={
          <>
            <ActionPill label={t('common.join')} icon="🔗" onClick={() => router.push('/group/join')} />
            <ActionPill label={t('common.new')} primary onClick={() => router.push('/group/new')} />
          </>
        }
      />
      <div className="px-5"><SectionLabel label={t('groups.all')} /></div>
      <GroupsList />
      <div className="h-6" />
    </div>
  )
}
