'use client'
// src/components/GroupsList.tsx
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { groupsApi } from '@/lib/api'
import { AvatarRow, Pill, EmptyState, Button } from '@/components/ui'
import { Group } from '@/types'

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "à l'instant"
  if (mins < 60) return `il y a ${mins} min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `il y a ${hours} h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `il y a ${days} j`
  return new Date(dateStr).toLocaleDateString('fr-FR')
}

export function GroupsList({ limit }: { limit?: number }) {
  const router = useRouter()
  const { data: groups, isLoading } = useQuery<Group[]>({ queryKey: ['groups'], queryFn: groupsApi.list })

  const list = limit ? (groups || []).slice(0, limit) : (groups || [])

  if (isLoading) {
    return (
      <div className="px-5 space-y-3">
        {[1, 2, 3].map(i => <div key={i} className="h-24 rounded-2xl bg-surface2 animate-pulse" />)}
      </div>
    )
  }

  if (list.length === 0) {
    return (
      <EmptyState
        emoji="💸"
        title="Aucun groupe encore"
        subtitle="Crée ou rejoins un groupe pour commencer à partager"
        actions={
          <>
            <Button label="✦ Créer un groupe" onClick={() => router.push('/group/new')} />
            <Button label="Rejoindre avec un code" variant="ghost" onClick={() => router.push('/group/join')} />
          </>
        }
      />
    )
  }

  return (
    <div className="px-5 space-y-2.5">
      {list.map(item => (
        <div
          key={item.id}
          onClick={() => router.push(`/group/${item.id}`)}
          className="flex rounded-2xl overflow-hidden glass-card cursor-pointer hover:border-accent/30 transition-colors"
        >
          <div className="w-[3px] bg-accent/70" />
          <div className="flex-1 p-4">
            <div className="flex justify-between items-start gap-2">
              <h3 className="text-[16px] font-semibold text-text flex-1">{item.emoji} {item.name}</h3>
              <Pill label={`${item.expenseCount} dépense${item.expenseCount !== 1 ? 's' : ''}`} variant={item.expenseCount > 5 ? 'green' : 'accent'} />
            </div>
            <AvatarRow members={item.members} />
            <div className="flex justify-between items-center mt-2.5">
              <span className="text-[11px] text-text3">{timeAgo(item.createdAt)}</span>
              <span className="text-xl text-text3 font-light">›</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
