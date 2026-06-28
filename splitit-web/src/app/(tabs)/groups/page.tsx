'use client'
// src/app/(tabs)/groups/page.tsx
import { useRouter } from 'next/navigation'
import { ScreenHeader, ActionPill, SectionLabel } from '@/components/ui'
import { GroupsList } from '@/components/GroupsList'

export default function GroupsPage() {
  const router = useRouter()
  return (
    <div>
      <ScreenHeader
        title="Groupes"
        rightContent={
          <>
            <ActionPill label="Rejoindre" icon="🔗" onClick={() => router.push('/group/join')} />
            <ActionPill label="+ Nouveau" primary onClick={() => router.push('/group/new')} />
          </>
        }
      />
      <div className="px-5"><SectionLabel label="Tous les groupes" /></div>
      <GroupsList />
      <div className="h-6" />
    </div>
  )
}
