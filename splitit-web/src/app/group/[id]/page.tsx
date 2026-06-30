'use client'
// src/app/group/[id]/page.tsx
//
// Fix important : les soldes ("Qui doit quoi") viennent maintenant de
// group.balances, calculé côté backend par computeBalances() — un algo de
// netting global qui simplifie les dettes croisées (ex: si T2 doit 10€ à T
// sur une dépense et T doit 5€ à T2 sur une autre, le résultat net affiché
// est "T2 doit 5€ à T", pas les deux lignes brutes). Avant ce fix, la page
// recalculait elle-même les soldes par dépense sans nettage global ni
// bidirectionnel, ce qui pouvait afficher les deux dettes simultanément.
//
// Le détail dépliable + bouton "marquer comme réglé" sont repris du flux
// mobile (GroupDetailScreen.tsx) pour un comportement identique.

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { groupsApi, expensesApi } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { Avatar, Pill, SectionLabel, Card, Button, FullScreenSpinner } from '@/components/ui'
import { formatMoney } from '@/store/langStore'
import { Balance } from '@/types'

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

type LogLine = {
  expenseId: string
  expenseDesc: string
  debtorId: string
  creditorId: string
  amount: number
  settled: boolean
}

export default function GroupDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const [copied, setCopied] = useState(false)
  const [expandedBalance, setExpandedBalance] = useState<string | null>(null)
  const [showLog, setShowLog] = useState(false)

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
  const currency = group.expenses?.[0]?.currency || 'EUR'

  const totalSpent: number = (group.expenses || []).reduce((s: number, e: any) => s + e.totalAmount, 0)
  const myShare: number = (group.expenses || []).reduce((sum: number, exp: any) => {
    const mySplit = exp.splits?.find((s: any) => s.memberId === myMember?.id)
    return sum + (mySplit?.amount || 0)
  }, 0)
  const incompleteCount = (group.expenses || []).filter(isExpenseIncomplete).length

  // ── Log détaillé par dépense (pour le détail dépliable + le règlement) ──
  // Reproduit exactement la logique mobile : pour chaque dépense, le
  // "payeur principal" est celui qui a payé le plus, et chaque autre membre
  // lui doit sa part. On regroupe ensuite ces lignes par paire débiteur→
  // créditeur pour pouvoir afficher le détail sous chaque solde net.
  const reimbursementLog: LogLine[] = []
  ;(group.expenses || []).forEach((exp: any) => {
    const payments: any[] = exp.payments || []
    if (payments.length === 0) return
    const primaryPayment = payments.reduce((best: any, p: any) => (p.amount > best.amount ? p : best), payments[0])
    exp.splits?.forEach((split: any) => {
      if (split.memberId === primaryPayment.memberId) return
      reimbursementLog.push({
        expenseId: exp.id,
        expenseDesc: exp.description,
        debtorId: split.memberId,
        creditorId: primaryPayment.memberId,
        amount: split.amount,
        settled: split.settled,
      })
    })
  })
  const netLog: Record<string, { lines: LogLine[] }> = {}
  reimbursementLog.forEach(line => {
    const key = `${line.debtorId}→${line.creditorId}`
    if (!netLog[key]) netLog[key] = { lines: [] }
    netLog[key].lines.push(line)
  })

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
    <div className="min-h-screen pb-28">
      <div className="px-5 pt-[max(env(safe-area-inset-top),20px)] pb-4 sticky top-0 z-20 glass">
        <div className="flex items-center justify-between mb-1">
          <button onClick={() => router.push('/groups')} className="bg-surface2 border border-border/50 px-3 py-1.5 rounded-full text-xs font-medium text-text2">
            ← Groupes
          </button>
          <div className="flex items-center gap-2">
            <button onClick={() => router.push(`/group/members?groupId=${group.id}`)} className="bg-surface2 border border-border/50 px-3 py-1.5 rounded-full text-xs font-medium text-text2">
              👥 Membres
            </button>
            <button onClick={handleShare} className="bg-accent/10 border border-accent/25 px-3 py-1.5 rounded-full text-xs font-semibold text-accent2">
              Inviter
            </button>
          </div>
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight text-text mt-3">{group.emoji} {group.name}</h1>
        <div className="flex items-center gap-2 mt-2">
          <button onClick={handleShare} className="text-xs font-semibold text-accent2 bg-accent/10 border border-accent/25 px-3 py-1.5 rounded-full">
            🔗 {copied ? 'Copié !' : `Code ${group.inviteCode}`}
          </button>
          {incompleteCount > 0 && <Pill label={`⏳ ${incompleteCount} à compléter`} variant="amber" />}
        </div>
      </div>

      <div className="px-5">
        {/* Membres */}
        <Card>
          <p className="text-sm font-semibold text-text mb-3">Membres ({group.members.length})</p>
          <div className="flex flex-wrap gap-4">
            {group.members.map((m: any) => (
              <div key={m.id} className="flex flex-col items-center gap-1.5 w-16">
                <Avatar initials={m.avatarInitials} color={m.avatarColor} size={40} />
                <p className="text-[11px] text-text2 text-center truncate w-full">{m.displayName}</p>
                {m.id === myMember?.id && <p className="text-[9px] text-accent2 font-semibold">moi</p>}
              </div>
            ))}
          </div>
        </Card>

        {/* Résumé du groupe */}
        {group.expenses?.length > 0 && (
          <>
            <SectionLabel label="Résumé du groupe" />
            <Card>
              <div className="flex items-center justify-around mb-3">
                <div className="flex flex-col items-center">
                  <p className="text-2xl font-light font-mono text-text">{formatMoney(totalSpent, currency)}</p>
                  <p className="text-[10px] uppercase tracking-wide text-text3 mt-1 font-semibold">Total groupe</p>
                </div>
                <div className="w-px h-10 bg-white/10" />
                <div className="flex flex-col items-center">
                  <p className="text-2xl font-light font-mono text-accent2">{formatMoney(myShare, currency)}</p>
                  <p className="text-[10px] uppercase tracking-wide text-text3 mt-1 font-semibold">Ma part</p>
                </div>
                <div className="w-px h-10 bg-white/10" />
                <div className="flex flex-col items-center">
                  <p className="text-2xl font-light font-mono text-text">{group.expenses.length}</p>
                  <p className="text-[10px] uppercase tracking-wide text-text3 mt-1 font-semibold">Dépenses</p>
                </div>
              </div>
              {incompleteCount > 0 && (
                <div className="bg-amber/10 border border-amber/25 rounded-lg px-3 py-2 text-center">
                  <p className="text-xs font-semibold text-amber">
                    ⏳ {incompleteCount} dépense{incompleteCount > 1 ? 's' : ''} à compléter
                  </p>
                </div>
              )}
            </Card>
          </>
        )}

        {/* Remboursements — basé sur group.balances (calcul backend nettisé) */}
        {group.balances?.length > 0 && (
          <>
            <div className="flex items-center justify-between mt-2">
              <SectionLabel label="Remboursements" />
              {Object.keys(netLog).length > 0 && (
                <button onClick={() => setShowLog(true)} className="text-xs font-semibold text-accent2 bg-accent/10 border border-accent/25 px-3 py-1 rounded-full mb-2">
                  📋 Détail
                </button>
              )}
            </div>
            <Card>
              <p className="text-[11px] text-text3 mb-3">Montants nets simplifiés — clique pour marquer comme réglé</p>
              <div className="space-y-1">
                {group.balances.map((b: Balance, i: number) => {
                  const isMe = b.fromMember?.userId === user?.id || b.toMember?.userId === user?.id
                  const isMeDebtor = b.fromMember?.userId === user?.id
                  const key = `${b.fromMemberId}→${b.toMemberId}`
                  const isExpanded = expandedBalance === key

                  return (
                    <div key={i}>
                      <button
                        onClick={() => setExpandedBalance(isExpanded ? null : key)}
                        className={`w-full flex items-center justify-between gap-3 py-2.5 rounded-lg px-2 -mx-2 transition-colors ${isMe ? 'bg-accent/5' : ''} hover:bg-surface3/40`}
                      >
                        <div className="flex items-center gap-2.5">
                          <Avatar initials={b.fromMember?.avatarInitials ?? '?'} color={b.fromMember?.avatarColor ?? '#7C6EFA'} size={28} />
                          <div className="text-left">
                            <p className={`text-sm font-medium ${isMe ? 'text-accent2' : 'text-text'}`}>
                              {b.fromMember?.displayName}{isMeDebtor ? ' (moi)' : ''}
                            </p>
                            <p className="text-[11px] text-text3">doit rembourser → {b.toMember?.displayName}</p>
                          </div>
                        </div>
                        <span className={`font-mono font-semibold text-sm ${isMe ? 'text-accent2' : 'text-amber'}`}>
                          {formatMoney(b.amount, currency)}
                        </span>
                      </button>

                      {isExpanded && (
                        <div className="bg-surface2/60 rounded-lg p-3 mb-2 ml-9">
                          {(netLog[key]?.lines || []).map((line, li) => (
                            <div key={li} className="flex items-center justify-between text-xs py-1">
                              <span className="text-text3 truncate flex-1">
                                {line.settled ? '✓ ' : '• '}{line.expenseDesc}
                              </span>
                              <span className={`font-mono ${line.settled ? 'text-green-400' : 'text-text2'}`}>
                                {formatMoney(line.amount, currency)}
                              </span>
                            </div>
                          ))}
                          {isMeDebtor && (
                            <button
                              onClick={() => {
                                if (!confirm(`Confirmer le remboursement de ${formatMoney(b.amount, currency)} à ${b.toMember?.displayName} ?`)) return
                                ;(netLog[key]?.lines || [])
                                  .filter(l => !l.settled)
                                  .forEach(l => settleMutation.mutate({ expenseId: l.expenseId, memberId: l.debtorId }))
                                setExpandedBalance(null)
                              }}
                              className="mt-2 w-full bg-accent/15 border border-accent/30 text-accent2 text-xs font-semibold rounded-lg py-2"
                            >
                              💸 J&apos;ai remboursé {formatMoney(b.amount, currency)}
                            </button>
                          )}
                        </div>
                      )}
                      {i < group.balances.length - 1 && <div className="h-px bg-white/5" />}
                    </div>
                  )
                })}
              </div>
            </Card>
          </>
        )}

        {/* Dépenses */}
        <SectionLabel label="Dépenses" />
        <div className="space-y-2">
          {(group.expenses || []).length === 0 && (
            <p className="text-sm text-text3 text-center py-6">Aucune dépense pour l&apos;instant.</p>
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

      {/* Modal détail complet de tous les remboursements */}
      {showLog && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowLog(false)} />
          <div className="relative w-full max-w-sm bg-surface border border-border rounded-t-3xl sm:rounded-3xl p-6 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-text">Détail des remboursements</h2>
              <button onClick={() => setShowLog(false)} className="bg-surface2 border border-border px-3 py-1.5 rounded-full text-xs text-text2">Fermer</button>
            </div>
            <div className="space-y-4">
              {Object.entries(netLog).map(([key, entry]) => (
                <div key={key}>
                  {entry.lines.map((line, li) => (
                    <div key={li} className="flex items-center justify-between text-xs py-1.5 border-b border-white/5 last:border-0">
                      <span className="text-text2 truncate flex-1">
                        {line.settled ? '✓ ' : '• '}{line.expenseDesc}
                      </span>
                      <span className={`font-mono ${line.settled ? 'text-green-400' : 'text-text'}`}>
                        {formatMoney(line.amount, currency)}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}