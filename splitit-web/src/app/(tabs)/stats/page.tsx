'use client'
// src/app/(tabs)/stats/page.tsx
// Port complet de app/app/(tabs)/stats.tsx mobile

import { useMemo } from 'react'
import { useQuery, useQueries } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { groupsApi, ocrApi } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { Card, GlassCard, SectionLabel, MiniBar, FullScreenSpinner, ScreenHeader } from '@/components/ui'
import { useLangStore } from '@/store/langStore'

function StatBox({ value, label, color = '#7C6EFA', sub }: {
  value: string | number; label: string; color?: string; sub?: string
}) {
  return (
    <div className="flex flex-col items-center flex-1 py-2">
      <span className="text-2xl font-light font-mono" style={{ color }}>{value}</span>
      {sub && <span className="text-[10px] text-text3 -mt-0.5">{sub}</span>}
      <span className="text-[10px] text-text3 font-semibold uppercase tracking-wider mt-1 text-center">{label}</span>
    </div>
  )
}

function isExpenseIncomplete(exp: any): boolean {
  if (typeof exp.isComplete === 'boolean') return !exp.isComplete
  const items: any[] = exp.items || []
  if (items.length > 0 && items.some((i: any) => !i.assignedTo || i.assignedTo.length === 0)) return true
  const splits: any[] = exp.splits || []
  const splitTotal = splits.reduce((s: number, sp: any) => s + sp.amount, 0)
  if (splits.length > 0 && Math.abs(splitTotal - exp.totalAmount) > 0.02) return true
  return false
}

export default function StatsPage() {
  const router = useRouter()
  const user = useAuthStore(s => s.user)
  const currency = useLangStore(s => s.currency)

  const { data: groups, isLoading, refetch } = useQuery({ queryKey: ['groups'], queryFn: groupsApi.list })
  const groupIds: string[] = (groups || []).map((g: any) => g.id)
  const groupQueries = useQueries({
    queries: groupIds.map(id => ({
      queryKey: ['group', id],
      queryFn: () => groupsApi.get(id),
      enabled: groupIds.length > 0,
      staleTime: 60_000,
    })),
  })
  const { data: ocrStats } = useQuery({ queryKey: ['ocrStats'], queryFn: ocrApi.getStats, staleTime: 60_000 })

  const totalGroups = (groups || []).length
  const totalExpenses = (groups || []).reduce((s: number, g: any) => s + (g.expenseCount || 0), 0)

  const groupStats = (groups || []).map((g: any, i: number) => {
    const full = groupQueries[i]?.data
    if (!full) return { group: g, myShare: null, myPaid: null, myBalance: null, total: null, memberCount: g.members?.length || 0, incomplete: 0, completionRate: null }
    const myMember = full.members?.find((m: any) => m.userId === user?.id)
    const myShare = full.expenses?.reduce((s: number, exp: any) => {
      const split = exp.splits?.find((sp: any) => sp.memberId === myMember?.id)
      return s + (split?.amount || 0)
    }, 0) ?? 0
    const myPaid = full.expenses?.reduce((s: number, exp: any) => {
      if (exp.payments && exp.payments.length > 0) {
        const myPayment = exp.payments.find((p: any) => p.memberId === myMember?.id)
        return s + (myPayment?.amount || 0)
      }
      return s + (exp.paidByMemberId === myMember?.id ? exp.totalAmount : 0)
    }, 0) ?? 0
    const total = full.expenses?.reduce((s: number, exp: any) => s + exp.totalAmount, 0) ?? 0
    const memberCount = full.members?.length || 0
    const myBalance = myPaid - myShare
    const incompleteExps = (full.expenses || []).filter(isExpenseIncomplete)
    const incomplete = incompleteExps.length
    const expCount = full.expenses?.length || 0
    const completionRate = expCount > 0 ? ((expCount - incomplete) / expCount) * 100 : 100
    return { group: g, myShare, myPaid, myBalance, total, memberCount, full, incomplete, completionRate }
  })

  const myTotalShare = groupStats.reduce((s, gs) => s + (gs.myShare || 0), 0)
  const myTotalPaid = groupStats.reduce((s, gs) => s + (gs.myPaid || 0), 0)
  const netBalance = myTotalPaid - myTotalShare

  const allExpenses = useMemo(() => {
    const exps: any[] = []
    groupStats.forEach(gs => {
      if (!gs.full) return
      ;(gs.full.expenses || []).forEach((exp: any) => {
        exps.push({ ...exp, groupName: gs.group.name, groupEmoji: gs.group.emoji, groupId: gs.group.id })
      })
    })
    return exps.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [groupStats])

  const now = new Date()
  const thisMonthExps = allExpenses.filter(exp => {
    const d = new Date(exp.createdAt)
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  })
  const thisMonthTotal = thisMonthExps.reduce((s, exp) => {
    const myMemberInGroup = groupStats.find(gs => gs.group.id === exp.groupId)?.full?.members?.find((m: any) => m.userId === user?.id)
    const mySplit = exp.splits?.find((sp: any) => sp.memberId === myMemberInGroup?.id)
    return s + (mySplit?.amount || 0)
  }, 0)

  const avgExpense = allExpenses.length > 0
    ? allExpenses.reduce((s, e) => s + e.totalAmount, 0) / allExpenses.length
    : 0

  const topPayerMap: Record<string, { name: string; total: number }> = {}
  groupStats.forEach(gs => {
    if (!gs.full) return
    ;(gs.full.expenses || []).forEach((exp: any) => {
      ;(exp.payments || []).forEach((p: any) => {
        const name = p.member?.displayName || '?'
        if (!topPayerMap[name]) topPayerMap[name] = { name, total: 0 }
        topPayerMap[name].total += p.amount
      })
    })
  })
  const topPayers = Object.values(topPayerMap).sort((a, b) => b.total - a.total).slice(0, 3)

  const globalDebts: Record<string, { name: string; amount: number; type: 'owe' | 'owed' }> = {}
  groupStats.forEach(gs => {
    if (!gs.full) return
    const myMember = gs.full.members?.find((m: any) => m.userId === user?.id)
    if (!myMember) return
    ;(gs.full.balances || []).forEach((b: any) => {
      if (b.fromMemberId === myMember.id) {
        const key = `owe_${b.toMember?.displayName}`
        if (!globalDebts[key]) globalDebts[key] = { name: b.toMember?.displayName, amount: 0, type: 'owe' }
        globalDebts[key].amount += b.amount
      } else if (b.toMemberId === myMember.id) {
        const key = `owed_${b.fromMember?.displayName}`
        if (!globalDebts[key]) globalDebts[key] = { name: b.fromMember?.displayName, amount: 0, type: 'owed' }
        globalDebts[key].amount += b.amount
      }
    })
  })
  const oweList = Object.values(globalDebts).filter(d => d.type === 'owe').sort((a, b) => b.amount - a.amount)
  const owedList = Object.values(globalDebts).filter(d => d.type === 'owed').sort((a, b) => b.amount - a.amount)
  const totalIncomplete = groupStats.reduce((s, gs) => s + (gs.incomplete || 0), 0)

  if (isLoading) return <FullScreenSpinner />

  return (
    <div className="min-h-screen bg-bg">
      <ScreenHeader title="Statistiques" subtitle="Vue d'ensemble de tes dépenses" />

      <div className="px-5 pb-28">
        {/* Hero balance card */}
        {myTotalPaid > 0 && (
          <GlassCard glow className="mt-4">
            <p className="text-[11px] font-bold text-text3 uppercase tracking-widest mb-2">Solde net total</p>
            <p className={`text-4xl font-light font-mono ${netBalance >= 0 ? 'text-green' : 'text-red'}`}>
              {netBalance >= 0 ? '+' : ''}{netBalance.toFixed(2)}
              <span className="text-lg text-text3"> CHF</span>
            </p>
            <p className="text-xs text-text3 mt-2 font-medium">
              {netBalance >= 0 ? "✓ On te doit de l'argent" : '⚡ Tu dois de l\'argent'}
            </p>
          </GlassCard>
        )}

        {/* Résumé global */}
        <SectionLabel label="Résumé global" />
        <Card>
          <div className="flex items-center justify-around py-2 border-b border-white/5 mb-2">
            <StatBox value={totalGroups} label="Groupes" color="#7C6EFA" />
            <div className="w-px h-11 bg-white/5" />
            <StatBox value={totalExpenses} label="Dépenses" color="#34D399" />
            <div className="w-px h-11 bg-white/5" />
            <StatBox value={myTotalShare.toFixed(0)} label="Ma part totale" sub="CHF" color="#FBBF24" />
          </div>
          {myTotalPaid > 0 && (
            <div className="flex items-center justify-around py-2">
              <StatBox value={myTotalPaid.toFixed(0)} label="J'ai avancé" sub="CHF" color="#94A3B8" />
              <div className="w-px h-11 bg-white/5" />
              <StatBox
                value={`${netBalance.toFixed(0)}`}
                label={netBalance >= 0 ? 'On me doit' : 'Je dois'}
                sub="CHF"
                color={netBalance >= 0 ? '#34D399' : '#F87171'}
              />
              <div className="w-px h-11 bg-white/5" />
              <StatBox value={ocrStats?.totalReceipts ?? 0} label="Tickets OCR" color="#94A3B8" />
            </div>
          )}
          {totalIncomplete > 0 && (
            <div className="mt-3 bg-amber/5 border border-amber/20 rounded-lg p-2.5 text-center">
              <span className="text-xs text-amber font-semibold">
                ⏳ {totalIncomplete} dépense{totalIncomplete > 1 ? 's' : ''} à compléter dans tes groupes
              </span>
            </div>
          )}
        </Card>

        {/* Ce mois-ci */}
        {allExpenses.length > 0 && (
          <>
            <SectionLabel label="Ce mois-ci" />
            <Card>
              <div className="flex items-center justify-around py-2">
                <StatBox value={thisMonthExps.length} label="Dépenses" color="#7C6EFA" />
                <div className="w-px h-11 bg-white/5" />
                <StatBox value={thisMonthTotal.toFixed(0)} label="Ma part CHF" sub="CHF" color="#FBBF24" />
                <div className="w-px h-11 bg-white/5" />
                <StatBox value={avgExpense.toFixed(0)} label="Moy. dépense" sub="CHF" color="#94A3B8" />
              </div>
            </Card>
          </>
        )}

        {/* Mes soldes globaux */}
        {(oweList.length > 0 || owedList.length > 0) && (
          <>
            <SectionLabel label="Mes soldes globaux" />
            <Card>
              {owedList.length > 0 && (
                <>
                  <p className="text-[11px] font-bold text-text3 uppercase tracking-wider mb-3">✓ On me doit</p>
                  {owedList.map((d, i) => (
                    <div key={i} className="flex justify-between py-1.5 border-b border-white/5 last:border-0">
                      <span className="text-sm text-text">{d.name}</span>
                      <span className="text-sm font-mono font-semibold text-green">+{d.amount.toFixed(2)} CHF</span>
                    </div>
                  ))}
                </>
              )}
              {owedList.length > 0 && oweList.length > 0 && <div className="h-px bg-white/5 my-3" />}
              {oweList.length > 0 && (
                <>
                  <p className="text-[11px] font-bold text-text3 uppercase tracking-wider mb-3">⚡ Je dois</p>
                  {oweList.map((d, i) => (
                    <div key={i} className="flex justify-between py-1.5 border-b border-white/5 last:border-0">
                      <span className="text-sm text-text">{d.name}</span>
                      <span className="text-sm font-mono font-semibold text-red">−{d.amount.toFixed(2)} CHF</span>
                    </div>
                  ))}
                </>
              )}
            </Card>
          </>
        )}

        {/* Top payeurs */}
        {topPayers.length > 0 && (
          <>
            <SectionLabel label="Top payeurs (tous groupes)" />
            <Card>
              {topPayers.map((p, i) => (
                <div key={i} className="flex items-center gap-3 py-2 border-b border-white/5 last:border-0">
                  <span className="text-xl">{['🥇', '🥈', '🥉'][i]}</span>
                  <span className="flex-1 text-sm text-text font-medium">{p.name}</span>
                  <span className="text-sm font-mono text-amber font-medium">{p.total.toFixed(2)} CHF</span>
                </div>
              ))}
              <MiniBar value={topPayers[0]?.total || 0} max={topPayers[0]?.total || 1} color="#FBBF24" />
            </Card>
          </>
        )}

        {/* Activité récente */}
        {allExpenses.length > 0 && (
          <>
            <SectionLabel label="Activité récente" />
            <div className="glass-card rounded-2xl overflow-hidden p-0 mb-3">
              {allExpenses.slice(0, 6).map((exp, i) => (
                <div
                  key={exp.id}
                  onClick={() => router.push(`/group/${exp.groupId}`)}
                  className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-surface3/30 transition-colors ${i > 0 ? 'border-t border-white/5' : ''}`}
                >
                  <div className="w-9 h-9 rounded-lg bg-surface2 flex items-center justify-center text-base flex-shrink-0">
                    {isExpenseIncomplete(exp) ? '⏳' : exp.receiptImageUrl ? '🧾' : '✏️'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text truncate">{exp.description}</p>
                    <p className="text-[11px] text-text3 mt-0.5">{exp.groupEmoji} {exp.groupName}</p>
                  </div>
                  <span className="text-sm font-mono text-text2 flex-shrink-0">{exp.totalAmount.toFixed(2)} CHF</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Par groupe */}
        {totalGroups > 0 && (
          <>
            <SectionLabel label="Par groupe" />
            {groupStats.map(({ group: g, myShare, myPaid, myBalance, total, memberCount, incomplete, completionRate }) => (
              <div
                key={g.id}
                onClick={() => router.push(`/group/${g.id}`)}
                className="flex mb-3 rounded-xl overflow-hidden glass-card cursor-pointer hover:border-accent/30 transition-colors p-0"
              >
                <div className="w-1 bg-accent opacity-60 flex-shrink-0" />
                <div className="flex-1 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-semibold text-text">{g.emoji} {g.name}</span>
                    <span className="text-[11px] text-text3">{memberCount} membres</span>
                  </div>
                  <div className="flex items-center">
                    <div className="flex-1 text-center">
                      <p className="text-base font-mono font-medium text-text">{g.expenseCount}</p>
                      <p className="text-[10px] text-text3 mt-0.5">dépenses</p>
                    </div>
                    <div className="w-px h-8 bg-white/5" />
                    <div className="flex-1 text-center">
                      <p className="text-base font-mono font-medium text-text2">{total !== null ? total.toFixed(0) : '—'}</p>
                      <p className="text-[10px] text-text3 mt-0.5">total CHF</p>
                    </div>
                    <div className="w-px h-8 bg-white/5" />
                    <div className="flex-1 text-center">
                      <p className="text-base font-mono font-medium text-accent2">{myShare !== null ? myShare.toFixed(0) : '—'}</p>
                      <p className="text-[10px] text-text3 mt-0.5">ma part CHF</p>
                    </div>
                  </div>

                  {total !== null && total > 0 && myShare !== null && (
                    <div className="mt-3">
                      <MiniBar value={myShare} max={total} color="#7C6EFA" />
                      <p className="text-[10px] text-text3 mt-1">Ma part : {((myShare / total) * 100).toFixed(0)}% du total</p>
                    </div>
                  )}

                  {g.expenseCount > 0 && (
                    <div className="mt-2">
                      <MiniBar value={completionRate ?? 100} max={100} color={completionRate === 100 ? '#34D399' : '#FBBF24'} />
                      <p className="text-[10px] text-text3 mt-1">
                        {completionRate === 100
                          ? '✓ Toutes les dépenses sont complètes'
                          : `${(completionRate ?? 0).toFixed(0)}% complet — ${incomplete} à remplir`}
                      </p>
                    </div>
                  )}

                  {myBalance !== null && myBalance !== undefined && Math.abs(myBalance) > 0.01 && (
                    <div className={`mt-3 rounded-lg p-2 text-center border ${myBalance > 0 ? 'bg-green/5 border-green/20' : 'bg-red/5 border-red/20'}`}>
                      <span className={`text-xs font-bold ${myBalance > 0 ? 'text-green' : 'text-red'}`}>
                        {myBalance > 0 ? `✓ On me doit ${myBalance.toFixed(2)} CHF` : `⚡ Je dois ${Math.abs(myBalance).toFixed(2)} CHF`}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </>
        )}

        {/* OCR */}
        {ocrStats && (
          <>
            <SectionLabel label="Modèle OCR" />
            <Card>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-text">🧠 Entraînement</span>
                <span className="text-xs text-accent2 font-mono">{ocrStats.modelVersion ?? 'v1.0'}</span>
              </div>
              <div className="flex items-center justify-around py-2">
                <StatBox value={ocrStats.totalCorrections ?? 0} label="Corrections" color="#7C6EFA" />
                <div className="w-px h-11 bg-white/5" />
                <StatBox value={ocrStats.totalReceipts ?? 0} label="Tickets" color="#34D399" />
                <div className="w-px h-11 bg-white/5" />
                <StatBox value={`${Math.round((ocrStats.progressToNextRun ?? 0) * 100)}%`} label="Prochain run" color="#FBBF24" />
              </div>
              <MiniBar value={ocrStats.progressToNextRun ?? 0} max={1} color="#FBBF24" />
              <p className="text-[10px] text-text3 mt-1">{ocrStats.untrainedCount ?? 0} / 100 corrections avant le prochain affinement</p>
            </Card>
          </>
        )}

        {totalGroups === 0 && !isLoading && (
          <div className="flex flex-col items-center pt-20 text-center">
            <span className="text-5xl mb-4">📊</span>
            <p className="text-lg font-bold text-text mb-2">Pas encore de données</p>
            <p className="text-sm text-text3 max-w-[260px] leading-relaxed">Crée ou rejoins un groupe pour voir tes statistiques ici.</p>
          </div>
        )}
      </div>
    </div>
  )
}