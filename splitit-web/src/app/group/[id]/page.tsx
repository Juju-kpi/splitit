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
// Le détail dépliable est repris du flux mobile (GroupDetailScreen.tsx) pour
// un comportement identique.
//
// Les remboursements passent par la table `settlements` : un versement de X à
// Y, validé par les deux. C'est ce qui permet de solder un solde né d'une
// compensation en chaîne (je dois à A parce que A doit à B qui me doit), où
// aucune part de dépense ne relie directement les deux personnes. Le drapeau
// `settled` posé sur les parts reste lu et annulable — les remboursements
// déjà enregistrés de cette manière ne bougent pas.

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { groupsApi, expensesApi, settlementsApi } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { Avatar, Pill, SectionLabel, Card, Button, FullScreenSpinner } from '@/components/ui'
import { formatMoney, useT } from '@/store/langStore'
import { Balance, Settlement } from '@/types'

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
  const t = useT()
  const [copied, setCopied] = useState(false)
  const [expandedBalance, setExpandedBalance] = useState<string | null>(null)
  const [showLog, setShowLog] = useState(false)
  const [showCalc, setShowCalc] = useState(false)
  // Formulaire de remboursement — ouvert depuis une ligne de solde
  const [settleFor, setSettleFor] = useState<Balance | null>(null)
  const [amountInput, setAmountInput] = useState('')
  const [methodInput, setMethodInput] = useState('')
  const [noteInput, setNoteInput] = useState('')

  const { data: group, isLoading } = useQuery({
    queryKey: ['group', id],
    queryFn: () => groupsApi.get(id),
    enabled: !!id,
    // On revient toujours ici après avoir touché à une dépense : les soldes
    // doivent être recalculés à l'arrivée, sans dépendre des 30 s de cache par
    // défaut ni du fait qu'un écran ait pensé à invalider.
    refetchOnMount: 'always',
  })

  const refresh = () => qc.invalidateQueries({ queryKey: ['group', id] })

  // Ancien mécanisme, conservé pour annuler un remboursement déjà validé sur
  // une part de dépense. Rien de nouveau ne passe plus par ici.
  const settleMutation = useMutation({
    mutationFn: ({ expenseId, memberId, undo }: { expenseId: string; memberId: string; undo?: boolean }) =>
      expensesApi.settle(expenseId, memberId, undo),
    onSuccess: refresh,
  })

  const createSettlement = useMutation({
    mutationFn: (payload: {
      groupId: string; fromMemberId: string; toMemberId: string
      amount: number; currency?: string; method?: string; note?: string
    }) => settlementsApi.create(payload),
    onSuccess: () => { setSettleFor(null); refresh() },
  })
  const confirmSettlement = useMutation({
    mutationFn: ({ sid, undo }: { sid: string; undo?: boolean }) => settlementsApi.confirm(sid, undo),
    onSuccess: refresh,
  })
  const cancelSettlement = useMutation({
    mutationFn: ({ sid, undo }: { sid: string; undo?: boolean }) => settlementsApi.cancel(sid, undo),
    onSuccess: refresh,
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

  // ── Remboursements enregistrés ─────────────────────────────────────────
  const settlements: Settlement[] = group.settlements || []
  const liveSettlements = settlements.filter(s => !s.cancelledAt)
  const memberName = (mid: string) =>
    group.members.find((m: any) => m.id === mid)?.displayName ?? '?'
  const isGuest = (mid: string) =>
    !group.members.find((m: any) => m.id === mid)?.userId

  /** Les remboursements en attente entre deux personnes, dans les deux sens. */
  const pendingBetween = (x: string, y: string) => liveSettlements.filter(s =>
    !s.confirmed
    && ((s.fromMemberId === x && s.toMemberId === y) || (s.fromMemberId === y && s.toMemberId === x))
  )
  /** Attend-il MA confirmation ? */
  const needsMyNod = (s: Settlement) =>
    (s.fromMemberId === myMember?.id && !s.confirmedByFromAt)
    || (s.toMemberId === myMember?.id && !s.confirmedByToAt)

  const myPendingCount = liveSettlements.filter(s => !s.confirmed && needsMyNod(s)).length

  function openSettleForm(b: Balance) {
    setSettleFor(b)
    setAmountInput(b.amount.toFixed(2))
    setMethodInput('')
    setNoteInput('')
  }

  // Position nette de chaque membre — calculée par le backend, qui est le seul
  // à voir les remboursements. La recalculer ici à partir des seules dépenses
  // laissait les barres figées sur l'état d'avant remboursement.
  // Le repli local ne sert qu'aux réponses d'un backend antérieur à ce champ.
  const memberNet: Record<string, number> = group.netByMember ?? (() => {
    const net: Record<string, number> = {}
    group.members.forEach((m: any) => { net[m.id] = 0 })
    ;(group.expenses || []).forEach((exp: any) => {
      const payments = exp.payments?.length > 0
        ? exp.payments
        : [{ memberId: exp.paidByMemberId, amount: exp.totalAmount }]
      payments.forEach((p: any) => { net[p.memberId] = (net[p.memberId] || 0) + p.amount })
      exp.splits?.forEach((sp: any) => { net[sp.memberId] = (net[sp.memberId] || 0) - sp.amount })
    })
    return net
  })()
  const netRows = group.members
    .map((m: any) => ({ member: m, net: Math.round((memberNet[m.id] || 0) * 100) / 100 }))
    .sort((a: any, b: any) => b.net - a.net)
  const maxAbsNet = Math.max(...netRows.map((r: any) => Math.abs(r.net)), 0.01)

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

        {/* Qui a avancé / qui doit — lecture visuelle des soldes */}
        {group.expenses?.length > 0 && (
          <>
            <SectionLabel label="Qui a avancé, qui doit" />
            <Card>
              <div className="flex items-center justify-between text-[11px] mb-3">
                <span className="text-green font-semibold">← on lui doit</span>
                <span className="text-text3">équilibré</span>
                <span className="text-amber font-semibold">il doit →</span>
              </div>
              <div className="space-y-2.5">
                {netRows.map(({ member: m, net }: any) => {
                  const isMe = m.userId === user?.id
                  const width = `${Math.max(Math.abs(net) / maxAbsNet * 50, net === 0 ? 0 : 2)}%`
                  const creditor = net > 0.005
                  const debtor = net < -0.005
                  return (
                    <div key={m.id} className="flex items-center gap-2.5">
                      <Avatar initials={m.avatarInitials} color={m.avatarColor} size={26} />
                      <span className={`text-xs w-20 truncate ${isMe ? 'text-accent2 font-semibold' : 'text-text2'}`}>
                        {m.displayName}{isMe ? ' (moi)' : ''}
                      </span>
                      {/* barre divergente : la ligne du milieu = équilibre */}
                      <div className="flex-1 flex items-center h-5">
                        <div className="flex-1 flex justify-end">
                          {creditor && <div className="h-2.5 rounded-l-full bg-green/70" style={{ width }} />}
                        </div>
                        <div className="w-px h-4 bg-white/15" />
                        <div className="flex-1">
                          {debtor && <div className="h-2.5 rounded-r-full bg-amber/70" style={{ width }} />}
                        </div>
                      </div>
                      <span className={`font-mono text-xs w-20 text-right font-semibold ${
                        creditor ? 'text-green' : debtor ? 'text-amber' : 'text-text3'
                      }`}>
                        {net > 0 ? '+' : ''}{formatMoney(net, currency)}
                      </span>
                    </div>
                  )
                })}
              </div>
              <p className="text-[11px] text-text3 mt-3 leading-relaxed">
                Vert : cette personne a avancé plus que sa part, on lui doit de l&apos;argent.
                Orange : elle doit encore sa part. Les remboursements ci-dessous règlent tout en un minimum de virements.
              </p>
            </Card>
          </>
        )}

        {/* Remboursements — basé sur group.balances (calcul backend nettisé) */}
        {(group.balances?.length > 0 || settlements.length > 0) && (
          <>
            <div className="flex items-center justify-between gap-3 mt-2">
              <SectionLabel label={t('settlements.section')} />
              {myPendingCount > 0 && (
                <Pill label={t('settlements.pending_badge', { n: myPendingCount })} variant="amber" />
              )}
            </div>
            <Card>
              {group.balances?.length === 0 ? (
                <p className="text-sm text-text2 text-center py-3">{t('settlements.all_settled')}</p>
              ) : (
              <>
              <p className="text-[11px] text-text3 mb-3">Montants nets simplifiés — clique pour ouvrir</p>
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
                          {/* Aucune dépense commune : le solde vient d'une
                              compensation en chaîne. Sans remboursement à part
                              entière, il n'y aurait rien à cocher ici. */}
                          {(netLog[key]?.lines || []).length === 0 && (
                            <p className="text-[11px] text-text3 leading-relaxed">{t('settlements.chain_hint')}</p>
                          )}

                          {(() => {
                            const isMeCreditor = b.toMember?.userId === user?.id
                            if (!isMeDebtor && !isMeCreditor) return null

                            const other = isMeDebtor ? b.toMember?.displayName : b.fromMember?.displayName
                            const pending = pendingBetween(b.fromMemberId, b.toMemberId)

                            return (
                              <>
                                {pending.map(s => {
                                  const mine = needsMyNod(s)
                                  const amount = formatMoney(s.amount, s.currency || currency)
                                  const iAmPayer = s.fromMemberId === myMember?.id
                                  return (
                                    <div key={s.id} className="mt-2 rounded-lg border border-amber/25 bg-amber/5 p-2.5">
                                      <p className="text-[11px] text-amber leading-relaxed">
                                        {mine
                                          ? (iAmPayer
                                              ? t('settlements.to_confirm_received', { name: memberName(s.toMemberId), amount })
                                              : t('settlements.to_confirm_paid', { name: memberName(s.fromMemberId), amount }))
                                          : t('settlements.waiting_other', { name: other })}
                                      </p>
                                      <div className="flex gap-2 mt-2">
                                        {mine && (
                                          <button
                                            onClick={() => {
                                              if (!confirm(t('settlements.confirm_q', { amount }))) return
                                              confirmSettlement.mutate({ sid: s.id })
                                            }}
                                            disabled={confirmSettlement.isPending}
                                            className="flex-1 text-xs font-semibold rounded-lg min-h-[40px] bg-accent/15 border border-accent/30 text-accent2"
                                          >
                                            {t('settlements.confirm_btn')}
                                          </button>
                                        )}
                                        <button
                                          onClick={() => {
                                            if (!confirm(t('settlements.cancel_q'))) return
                                            cancelSettlement.mutate({ sid: s.id })
                                          }}
                                          disabled={cancelSettlement.isPending}
                                          className="flex-1 text-xs font-semibold rounded-lg min-h-[40px] bg-surface3 border border-border text-text3"
                                        >
                                          {mine ? t('settlements.refuse_btn') : t('settlements.cancel_btn')}
                                        </button>
                                      </div>
                                    </div>
                                  )
                                })}

                                {/* Un remboursement déjà en attente couvre sans
                                    doute cette dette : on garde le bouton, mais
                                    il cesse d'être l'action évidente — sinon on
                                    en enregistre deux pour le même versement. */}
                                <button
                                  onClick={() => openSettleForm(b)}
                                  className={`mt-2 w-full text-xs font-semibold rounded-lg min-h-[44px] border ${
                                    pending.length > 0
                                      ? 'bg-surface3 border-border text-text3'
                                      : 'bg-accent/15 border-accent/30 text-accent2'
                                  }`}
                                >
                                  {pending.length > 0
                                    ? t('settlements.record')
                                    : isMeDebtor
                                      ? t('settlements.i_paid', { amount: formatMoney(b.amount, currency) })
                                      : t('settlements.i_received', { amount: formatMoney(b.amount, currency) })}
                                </button>
                              </>
                            )
                          })()}
                        </div>
                      )}
                      {i < group.balances.length - 1 && <div className="h-px bg-white/5" />}
                    </div>
                  )
                })}
              </div>
              </>
              )}

              {/* Pleine largeur en bas de carte : dans le coin haut-droit la
                  cible etait petite et loin du pouce, surtout en PWA iPhone
                  ou ce coin est le plus difficile a atteindre d'une main. */}
              <button
                onClick={() => setShowLog(true)}
                className="mt-4 w-full flex items-center justify-center gap-2 text-sm font-semibold text-accent2 bg-accent/10 border border-accent/25 min-h-[48px] rounded-xl"
              >
                📋 {t('settlements.history_title')}
              </button>
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
          <div className="absolute inset-0 bg-black/70" onClick={() => setShowLog(false)} />
          <div className="relative w-full max-w-sm bg-surface border border-border rounded-t-3xl sm:rounded-3xl p-6 pb-[max(env(safe-area-inset-bottom),24px)] max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-text">Détail des remboursements</h2>
              <button onClick={() => setShowLog(false)} className="bg-surface2 border border-border px-3 py-1.5 rounded-full text-xs text-text2">Fermer</button>
            </div>

            {/* Historique des remboursements enregistrés — y compris annulés,
                pour qu'un clic malheureux reste rattrapable. */}
            <p className="text-[11px] uppercase tracking-wide text-text3 font-semibold mb-2">
              {t('settlements.history_title')}
            </p>
            <div className="space-y-2 mb-5">
              {settlements.length === 0 && (
                <p className="text-xs text-text3">{t('settlements.none')}</p>
              )}
              {settlements.map(s => {
                const cancelled = !!s.cancelledAt
                const isParty = s.fromMemberId === myMember?.id || s.toMemberId === myMember?.id
                const status = cancelled
                  ? t('settlements.status_cancelled')
                  : s.confirmed ? t('settlements.status_confirmed') : t('settlements.status_pending')
                return (
                  <div key={s.id} className={`rounded-lg border p-2.5 ${
                    cancelled ? 'border-border/40 bg-surface2/30 opacity-60'
                      : s.confirmed ? 'border-green/25 bg-green/5' : 'border-amber/25 bg-amber/5'
                  }`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-xs flex-1 truncate ${cancelled ? 'line-through text-text3' : 'text-text2'}`}>
                        {memberName(s.fromMemberId)} → {memberName(s.toMemberId)}
                      </span>
                      <span className={`font-mono text-xs ${cancelled ? 'text-text3' : 'text-text'}`}>
                        {formatMoney(s.amount, s.currency || currency)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-1">
                      <span className={`text-[11px] ${
                        cancelled ? 'text-text3' : s.confirmed ? 'text-green' : 'text-amber'
                      }`}>
                        {status} · {new Date(s.createdAt).toLocaleDateString('fr-FR')}
                        {s.method ? ` · ${s.method}` : ''}
                      </span>
                      {isParty && (
                        <button
                          onClick={() => {
                            if (!cancelled && !confirm(t('settlements.cancel_q'))) return
                            cancelSettlement.mutate({ sid: s.id, undo: cancelled })
                          }}
                          disabled={cancelSettlement.isPending}
                          className="shrink-0 text-[11px] text-amber bg-amber/10 border border-amber/25 rounded-full px-2.5 min-h-[32px]"
                        >
                          {cancelled ? t('settlements.restore_btn') : '↩'}
                        </button>
                      )}
                    </div>
                    {s.note && <p className="text-[11px] text-text3 mt-1">{s.note}</p>}
                  </div>
                )
              })}
            </div>

            {/* Le calcul en clair — replié par défaut : c'est une vérification,
                pas une lecture quotidienne. Les chiffres viennent du backend,
                ceux-là mêmes qui produisent les virements affichés. */}
            <button
              onClick={() => setShowCalc(v => !v)}
              className="w-full flex items-center justify-center text-xs font-semibold text-text2 bg-surface2 border border-border min-h-[44px] rounded-xl mb-4"
            >
              {showCalc ? t('settlements.calc_hide') : t('settlements.calc_show')}
            </button>

            {showCalc && (() => {
              const rows = group.netBreakdown
              if (!rows) return (
                <p className="text-xs text-text3 mb-5">
                  Le détail du calcul arrive avec la prochaine mise à jour du serveur.
                </p>
              )
              const total = Math.round(
                group.members.reduce((s: number, m: any) => s + (rows[m.id]?.net ?? 0), 0) * 100
              ) / 100
              const line = (label: string, value: number, sign: '+' | '−') =>
                Math.abs(value) < 0.005 ? null : (
                  <div className="flex justify-between text-[11px] py-0.5">
                    <span className="text-text3">{sign} {label}</span>
                    <span className="font-mono text-text2">{formatMoney(value, currency)}</span>
                  </div>
                )
              return (
                <div className="mb-5">
                  <p className="text-[11px] uppercase tracking-wide text-text3 font-semibold mb-2">
                    {t('settlements.calc_title')}
                  </p>
                  <div className="space-y-2">
                    {group.members.map((m: any) => {
                      const r = rows[m.id]
                      if (!r) return null
                      return (
                        <div key={m.id} className="bg-surface2/60 rounded-lg p-2.5">
                          <div className="flex items-center gap-2 mb-1">
                            <Avatar initials={m.avatarInitials} color={m.avatarColor} size={20} />
                            <span className="text-xs font-medium text-text flex-1 truncate">{m.displayName}</span>
                          </div>
                          {line(t('settlements.calc_paid'), r.paid, '+')}
                          {line(t('settlements.calc_share'), r.share, '−')}
                          {line(t('settlements.calc_settled_own'), r.settledOwn, '+')}
                          {line(t('settlements.calc_settled_as_payer'), r.settledAsPayer, '−')}
                          {line(t('settlements.calc_paid_back'), r.settlementsPaid, '+')}
                          {line(t('settlements.calc_received'), r.settlementsReceived, '−')}
                          <div className="flex justify-between text-xs pt-1.5 mt-1 border-t border-white/10">
                            <span className="text-text2 font-semibold">= {t('settlements.calc_net')}</span>
                            <span className={`font-mono font-semibold ${
                              r.net > 0.005 ? 'text-green' : r.net < -0.005 ? 'text-amber' : 'text-text3'
                            }`}>
                              {r.net > 0 ? '+' : ''}{formatMoney(r.net, currency)}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* La vérification : la somme doit tomber à zéro au centime. */}
                  <div className="flex justify-between items-center text-xs mt-3 px-1">
                    <span className="text-text2 font-semibold">{t('settlements.calc_total')}</span>
                    <span className={`font-mono font-bold ${Math.abs(total) < 0.005 ? 'text-green' : 'text-amber'}`}>
                      {formatMoney(total, currency)}
                    </span>
                  </div>
                  <p className={`text-[11px] mt-1.5 leading-relaxed ${Math.abs(total) < 0.005 ? 'text-green' : 'text-amber'}`}>
                    {Math.abs(total) < 0.005
                      ? t('settlements.calc_total_ok')
                      : t('settlements.calc_total_bad', { amount: formatMoney(total, currency) })}
                  </p>
                  <p className="text-[11px] text-text3 mt-3 leading-relaxed">
                    {t('settlements.calc_explain')}
                  </p>
                </div>
              )
            })()}

            <p className="text-[11px] uppercase tracking-wide text-text3 font-semibold mb-2">
              Par dépense
            </p>
            <div className="space-y-4">
              {Object.entries(netLog).map(([key, entry]) => (
                <div key={key}>
                  {entry.lines.map((line, li) => {
                    // Une fois les deux d'accord, la ligne quitte les soldes :
                    // c'est ici que l'on peut revenir sur un clic malheureux.
                    const canUndo = line.settled
                      && (line.debtorId === myMember?.id || line.creditorId === myMember?.id)
                    return (
                    <div key={li} className="flex items-center justify-between text-xs py-1.5 border-b border-white/5 last:border-0">
                      <span className="text-text2 truncate flex-1">
                        {line.settled ? '✓ ' : '• '}{line.expenseDesc}
                      </span>
                      <span className={`font-mono ${line.settled ? 'text-green-400' : 'text-text'}`}>
                        {formatMoney(line.amount, currency)}
                      </span>
                      {canUndo && (
                        <button
                          onClick={() => {
                            if (!confirm('Annuler ce remboursement ? La dette redeviendra due.')) return
                            settleMutation.mutate({ expenseId: line.expenseId, memberId: line.debtorId, undo: true })
                          }}
                          title="Annuler ce remboursement"
                          className="ml-2 shrink-0 text-[11px] text-amber bg-amber/10 border border-amber/25 rounded-full px-2 min-h-[32px]"
                        >
                          ↩
                        </button>
                      )}
                    </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Saisie d'un remboursement — montant modifiable : on peut rembourser
          une partie seulement, ce que le drapeau sur les parts ne savait pas
          exprimer. */}
      {settleFor && (() => {
        const b = settleFor
        const parsed = Number(amountInput.replace(',', '.'))
        const valid = Number.isFinite(parsed) && parsed >= 0.01
        const over = valid && parsed > b.amount + 0.005
        const other = b.fromMemberId === myMember?.id ? b.toMemberId : b.fromMemberId
        const methods = [
          t('settlements.method_cash'), t('settlements.method_transfer'),
          t('settlements.method_app'), t('settlements.method_other'),
        ]
        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
            <div className="absolute inset-0 bg-black/70" onClick={() => setSettleFor(null)} />
            <div className="relative w-full max-w-sm bg-surface border border-border rounded-t-3xl sm:rounded-3xl p-6 pb-[max(env(safe-area-inset-bottom),24px)] max-h-[85vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-base font-bold text-text">{t('settlements.modal_title')}</h2>
                <button onClick={() => setSettleFor(null)} className="bg-surface2 border border-border px-3 py-1.5 rounded-full text-xs text-text2">
                  Fermer
                </button>
              </div>
              <p className="text-xs text-text3 mb-4">
                {t('settlements.direction', {
                  from: memberName(b.fromMemberId), to: memberName(b.toMemberId),
                })}
              </p>

              <label className="block text-[11px] uppercase tracking-wide text-text3 font-semibold mb-1.5">
                {t('settlements.amount_label')}
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={amountInput}
                onChange={e => setAmountInput(e.target.value)}
                className="w-full bg-surface2 border border-border rounded-xl px-4 min-h-[48px] text-lg font-mono text-text outline-none focus:border-accent/50"
              />
              <p className={`text-[11px] mt-1.5 leading-relaxed ${over ? 'text-amber' : 'text-text3'}`}>
                {!valid
                  ? t('settlements.amount_invalid')
                  : over
                    ? t('settlements.amount_over', { amount: formatMoney(b.amount, currency) })
                    : t('settlements.amount_hint', { amount: formatMoney(b.amount, currency) })}
              </p>

              <label className="block text-[11px] uppercase tracking-wide text-text3 font-semibold mt-4 mb-1.5">
                {t('settlements.method_label')}
              </label>
              <div className="flex flex-wrap gap-2">
                {methods.map(m => (
                  <button
                    key={m}
                    onClick={() => setMethodInput(methodInput === m ? '' : m)}
                    className={`text-xs font-medium rounded-full px-3.5 min-h-[36px] border ${
                      methodInput === m
                        ? 'bg-accent/15 border-accent/30 text-accent2'
                        : 'bg-surface2 border-border/50 text-text2'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>

              <label className="block text-[11px] uppercase tracking-wide text-text3 font-semibold mt-4 mb-1.5">
                {t('settlements.note_label')}
              </label>
              <input
                type="text"
                value={noteInput}
                onChange={e => setNoteInput(e.target.value)}
                placeholder={t('settlements.note_placeholder')}
                className="w-full bg-surface2 border border-border rounded-xl px-4 min-h-[44px] text-sm text-text outline-none focus:border-accent/50 placeholder:text-text3"
              />

              {/* Un membre sans compte ne peut rien confirmer : on le dit au
                  lieu de laisser croire à une attente qui n'arrivera jamais. */}
              <p className="text-[11px] text-text3 mt-4 leading-relaxed">
                {isGuest(other)
                  ? t('settlements.guest_auto', { name: memberName(other) })
                  : t('settlements.waiting_other', { name: memberName(other) })}
              </p>

              <button
                onClick={() => createSettlement.mutate({
                  groupId: group.id,
                  fromMemberId: b.fromMemberId,
                  toMemberId: b.toMemberId,
                  amount: Math.round(parsed * 100) / 100,
                  currency,
                  method: methodInput || undefined,
                  note: noteInput.trim() || undefined,
                })}
                disabled={!valid || createSettlement.isPending}
                className="mt-5 w-full text-sm font-semibold rounded-xl min-h-[48px] bg-accent/20 border border-accent/40 text-accent2 disabled:opacity-40"
              >
                {createSettlement.isPending ? '…' : t('settlements.submit')}
              </button>
              {createSettlement.isError && (
                <p className="text-[11px] text-amber mt-2 text-center">
                  {(createSettlement.error as any)?.response?.data?.error || 'Erreur'}
                </p>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}