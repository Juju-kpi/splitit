'use client'
// src/app/group/[id]/page.tsx
import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { groupsApi, expensesApi } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { Avatar, Pill, SectionLabel, Button, FullScreenSpinner } from '@/components/ui'
import { formatMoney } from '@/store/langStore'

function isExpenseIncomplete(exp: any): boolean {
  if (typeof exp.isComplete === 'boolean') return !exp.isComplete
  const items: any[] = exp.items || []
  if (items.length > 0) {
    if (items.some((it: any) => !it.assignedTo || it.assignedTo.length === 0)) return true
  }
  const splits: any[] = exp.splits || []
  const splitTotal = splits.reduce((s: number, sp: any) => s + sp.amount, 0)
  if (splits.length > 0 && Math.abs(splitTotal - exp.totalAmount) > 0.02) return true
  return false
}

export default function GroupDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const [copied, setCopied] = useState(false)

  const { data: group, isLoading } = useQuery({
    queryKey: ['group', id],
    queryFn: () => groupsApi.get(id),
    enabled: !!id,
  })

  const settleMutation = useMutation({
    mutationFn: ({ expenseId, memberId }: { expenseId: string; memberId: string }) =>
      expensesApi.settle(expenseId, memberId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['group', id] }),
  })

  if (isLoading || !group) return <FullScreenSpinner />

  const myMember = group.members.find((m: any) => m.userId === user?.id)
  const totalSpent: number = (group.expenses || []).reduce((s: number, e: any) => s + e.totalAmount, 0)
  const incompleteCount = (group.expenses || []).filter(isExpenseIncomplete).length

  // Net balances between pairs
  type Line = { from: string; fromId: string; to: string; toId: string; amount: number; settled: number; expenseId: string }
  const net: Record<string, { fromId: string; toId: string; from: string; to: string; total: number; settled: number }> = {}
  ;(group.expenses || []).forEach((exp: any) => {
    const payments = exp.payments || []
    if (payments.length === 0) return
    const primary = payments.reduce((best: any, p: any) => (p.amount > best.amount ? p : best), payments[0])
    exp.splits?.forEach((split: any) => {
      if (split.memberId === primary.memberId) return
      const key = `${split.memberId}→${primary.memberId}`
      if (!net[key]) net[key] = { fromId: split.memberId, toId: primary.memberId, from: split.member?.displayName ?? '?', to: primary.member?.displayName ?? '?', total: 0, settled: 0 }
      net[key].total += split.amount
      if (split.settled) net[key].settled += split.amount
    })
  })
  const balances = Object.values(net).filter(b => b.total - b.settled > 0.01)

  const inviteUrl = typeof window !== 'undefined' ? `${window.location.origin}/group/join?code=${group.inviteCode}` : ''

  async function handleShare() {
    const text = `Rejoins le groupe "${group.name}" sur Splitit !\nCode : ${group.inviteCode}`
    if (navigator.share) {
      try { await navigator.share({ text }) } catch {}
    } else {
      await navigator.clipboard.writeText(`${text}\n${inviteUrl}`)
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="min-h-screen pb-10">
      <div className="px-5 pt-[max(env(safe-area-inset-top),20px)] pb-4 sticky top-0 z-20 glass">
        <div className="flex items-center justify-between mb-1">
          <button onClick={() => router.push('/groups')} className="bg-surface2 border border-border/50 px-3 py-1.5 rounded-full text-xs font-medium text-text2">
            ← Groupes
          </button>
          <button onClick={() => router.push(`/group/members?groupId=${group.id}`)} className="bg-surface2 border border-border/50 px-3 py-1.5 rounded-full text-xs font-medium text-text2">
            Membres
          </button>
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight text-text mt-3">{group.emoji} {group.name}</h1>
        <div className="flex items-center gap-2 mt-2">
          <button onClick={handleShare} className="text-xs font-semibold text-accent2 bg-accent/10 border border-accent/25 px-3 py-1.5 rounded-full">
            🔗 {copied ? 'Copié !' : `Code ${group.inviteCode}`}
          </button>
          {incompleteCount > 0 && <Pill label={`${incompleteCount} à compléter`} variant="amber" />}
        </div>
      </div>

      <div className="px-5">
        <div className="glass-card rounded-2xl p-5 mb-5 mt-3">
          <p className="text-[11px] uppercase tracking-widest text-text3 font-semibold mb-1">Total dépensé</p>
          <p className="text-3xl font-light text-text font-mono">{formatMoney(totalSpent)}</p>
        </div>

        <SectionLabel label="Qui doit quoi" />
        {balances.length === 0 ? (
          <p className="text-sm text-text3 text-center py-6">Tout est réglé ✓</p>
        ) : (
          <div className="space-y-2 mb-2">
            {balances.map((b, i) => {
              const remaining = b.total - b.settled
              const canSettle = b.fromId === myMember?.id || b.toId === myMember?.id
              return (
                <div key={i} className="glass-card rounded-xl p-3.5 flex items-center justify-between">
                  <p className="text-sm text-text">
                    <span className="font-semibold">{b.from}</span> doit à <span className="font-semibold">{b.to}</span>
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold text-amber">{formatMoney(remaining)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <SectionLabel label="Dépenses" />
        <div className="space-y-2">
          {(group.expenses || []).length === 0 && (
            <p className="text-sm text-text3 text-center py-6">Aucune dépense pour l'instant.</p>
          )}
          {(group.expenses || []).map((exp: any) => {
            const incomplete = isExpenseIncomplete(exp)
            return (
              <div key={exp.id} onClick={() => router.push(`/expense/${exp.id}`)}
                className="glass-card rounded-xl p-4 cursor-pointer hover:border-accent/30 transition-colors flex items-center justify-between">
                <div className="flex-1">
                  <p className="text-sm font-semibold text-text">{exp.description}</p>
                  <p className="text-xs text-text3 mt-0.5">{new Date(exp.createdAt).toLocaleDateString('fr-FR')}</p>
                </div>
                <div className="flex items-center gap-2">
                  {incomplete && <Pill label="⏳" variant="amber" />}
                  <span className="font-mono font-semibold text-text">{formatMoney(exp.totalAmount, exp.currency)}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="fixed bottom-[max(env(safe-area-inset-bottom),16px)] left-0 right-0 px-5 max-w-sm mx-auto">
        <Button label="+ Ajouter une dépense" onClick={() => router.push(`/expense/add?groupId=${group.id}`)} />
      </div>
    </div>
  )
}
