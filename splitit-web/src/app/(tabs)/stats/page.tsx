'use client'
// src/app/(tabs)/stats/page.tsx
import { useQuery } from '@tanstack/react-query'
import { groupsApi } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { ScreenHeader, GlassCard, SectionLabel, MiniBar, FullScreenSpinner } from '@/components/ui'
import { formatMoney } from '@/store/langStore'
import { Group } from '@/types'

export default function StatsPage() {
  const user = useAuthStore(s => s.user)
  const { data: groups, isLoading } = useQuery<Group[]>({ queryKey: ['groups'], queryFn: groupsApi.list })

  if (isLoading) return <FullScreenSpinner />

  const list = groups || []
  const totalGroups = list.length
  const totalExpenses = list.reduce((s, g: any) => s + (g.expenseCount || 0), 0)

  return (
    <div>
      <ScreenHeader title="Stats" />
      <div className="px-5">
        <div className="grid grid-cols-2 gap-3 mb-3">
          <GlassCard glow>
            <p className="text-[11px] uppercase tracking-widest text-text3 font-semibold mb-1">Groupes</p>
            <p className="text-2xl font-bold text-text">{totalGroups}</p>
          </GlassCard>
          <GlassCard>
            <p className="text-[11px] uppercase tracking-widest text-text3 font-semibold mb-1">Dépenses</p>
            <p className="text-2xl font-bold text-text">{totalExpenses}</p>
          </GlassCard>
        </div>

        <SectionLabel label="Par groupe" />
        <div className="space-y-2">
          {list.map((g: any) => (
            <div key={g.id} className="glass-card rounded-xl p-4">
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-semibold text-text">{g.emoji} {g.name}</span>
                <span className="text-xs text-text3">{g.expenseCount} dépense{g.expenseCount !== 1 ? 's' : ''}</span>
              </div>
              <MiniBar value={g.expenseCount} max={Math.max(...list.map((x: any) => x.expenseCount), 1)} />
            </div>
          ))}
          {list.length === 0 && <p className="text-sm text-text3 text-center py-10">Pas encore de données.</p>}
        </div>
      </div>
      <div className="h-10" />
    </div>
  )
}
