'use client'
// src/components/GroupsList.tsx
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { groupsApi } from '@/lib/api'
import { AvatarRow, Pill, EmptyState, Button } from '@/components/ui'
import { Group } from '@/types'
import { useT, useLangStore } from '@/store/langStore'

function timeAgo(dateStr: string, t: (k: string, v?: any) => string, locale: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return t('groups.time_now')
  if (mins < 60) return t('groups.time_min', { n: mins })
  const hours = Math.floor(mins / 60)
  if (hours < 24) return t('groups.time_hour', { n: hours })
  const days = Math.floor(hours / 24)
  if (days < 30) return t('groups.time_day', { n: days })
  return new Date(dateStr).toLocaleDateString(locale)
}

export function GroupsList({ limit }: { limit?: number }) {
  const router = useRouter()
  const t = useT()
  const locale = useLangStore(s => s.locale)
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
        title={t('groups.no_groups')}
        subtitle={t('groups.no_groups_sub')}
        actions={
          <>
            <Button label={`✦ ${t('groups.create')}`} onClick={() => router.push('/group/new')} />
            <Button label={t('groups.join_with_code')} variant="ghost" onClick={() => router.push('/group/join')} />
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
              <Pill label={t(item.expenseCount !== 1 ? 'groups.expense_count_other' : 'groups.expense_count_one', { n: item.expenseCount })} variant={item.expenseCount > 5 ? 'green' : 'accent'} />
            </div>
            <AvatarRow members={item.members} />
            <div className="flex justify-between items-center mt-2.5">
              <span className="text-[11px] text-text3">{timeAgo(item.createdAt, t, locale)}</span>
              <span className="text-xl text-text3 font-light">›</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
