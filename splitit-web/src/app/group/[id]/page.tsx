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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { groupsApi } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { ChevronLeft, ChevronRight, Users, Share2, Clock, Plus, FileText, Receipt, Check } from 'lucide-react'
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

export default function GroupDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const t = useT()
  const [copied, setCopied] = useState(false)

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

  if (isLoading || !group) return <FullScreenSpinner />

  const myMember = group.members.find((m: any) => m.userId === user?.id)
  const currency = group.expenses?.[0]?.currency || 'EUR'

  const totalSpent: number = (group.expenses || []).reduce((s: number, e: any) => s + e.totalAmount, 0)
  const myShare: number = (group.expenses || []).reduce((sum: number, exp: any) => {
    const mySplit = exp.splits?.find((s: any) => s.memberId === myMember?.id)
    return sum + (mySplit?.amount || 0)
  }, 0)
  const incompleteCount = (group.expenses || []).filter(isExpenseIncomplete).length

  // Les remboursements vivent sur leur propre ecran ; il ne reste ici que de
  // quoi alimenter la carte de renvoi.
  const settlements: Settlement[] = group.settlements || []
  const myPendingCount = settlements.filter(s =>
    !s.cancelledAt && !s.confirmed
    && ((s.fromMemberId === myMember?.id && !s.confirmedByFromAt)
      || (s.toMemberId === myMember?.id && !s.confirmedByToAt))
  ).length

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
      <div className="px-5 pt-[max(env(safe-area-inset-top),28px)] pb-4 sticky top-0 z-20 glass">
        <div className="flex items-center justify-between">
          <button onClick={() => router.push('/groups')} aria-label="Retour aux groupes"
            className="w-10 h-10 rounded-full bg-surface2 flex items-center justify-center text-text2 hover:bg-surface3 transition-colors">
            <ChevronLeft size={18} strokeWidth={1.75} />
          </button>
          <div className="flex items-center gap-2">
            <button onClick={() => router.push(`/group/members?groupId=${group.id}`)} aria-label="Membres"
              className="w-10 h-10 rounded-full bg-surface2 flex items-center justify-center text-text2 hover:bg-surface3 transition-colors">
              <Users size={18} strokeWidth={1.75} />
            </button>
            <button onClick={handleShare} aria-label="Inviter"
              className="w-10 h-10 rounded-full bg-surface2 flex items-center justify-center text-text2 hover:bg-surface3 transition-colors">
              <Share2 size={18} strokeWidth={1.75} />
            </button>
          </div>
        </div>
        <h1 className="text-[30px] font-semibold tracking-[-0.03em] text-text mt-5 leading-[1.1]">
          {group.emoji} {group.name}
        </h1>
        <div className="flex items-center gap-2.5 mt-2.5 text-[13px]">
          <button onClick={handleShare} className="text-text3 hover:text-text2 transition-colors">
            {copied ? 'Copié !' : `Code ${group.inviteCode}`}
          </button>
          <span className="w-[3px] h-[3px] rounded-full bg-border2" />
          <span className="text-text3">{group.members.length} membres</span>
          {incompleteCount > 0 && (
            <>
              <span className="w-[3px] h-[3px] rounded-full bg-border2" />
              <span className="flex items-center gap-1.5 text-amber">
                <Clock size={13} strokeWidth={2} />
                {incompleteCount} à compléter
              </span>
            </>
          )}
        </div>
      </div>

      <div className="px-5">
        {/* Membres — meme information que sur mobile, rangee compacte */}
        <Card>
          <p className="text-[13px] font-medium text-text3 mb-3.5">Membres ({group.members.length})</p>
          <div className="flex flex-wrap gap-4">
            {group.members.map((m: any) => (
              <div key={m.id} className="flex flex-col items-center gap-2 w-16">
                <Avatar initials={m.avatarInitials} color={m.avatarColor} size={40} />
                <p className="text-xs text-text2 text-center truncate w-full">{m.displayName}</p>
                {m.id === myMember?.id && <p className="text-[10px] text-text3">moi</p>}
              </div>
            ))}
          </div>
        </Card>


        {/* Ta position dans ce groupe — le chiffre qu'on vient chercher */}
        {group.expenses?.length > 0 && (() => {
          const myNet = Math.round((memberNet[myMember?.id] || 0) * 100) / 100
          const even = Math.abs(myNet) < 0.005
          return (
            <div className="bg-surface rounded-2xl p-5 mb-3">
              <p className="text-[13px] font-medium text-text3">
                {even ? 'Tu es à jour' : myNet > 0 ? 'On te doit' : 'Tu dois'}
              </p>
              <p className={`text-[40px] leading-none font-mono font-medium mt-1.5 tracking-[-0.02em] ${
                even ? 'text-text' : myNet > 0 ? 'text-green' : 'text-amber'
              }`}>
                {formatMoney(Math.abs(myNet), currency)}
              </p>
              <div className="flex items-center gap-5 mt-6">
                <div className="flex-1">
                  <p className="text-xs text-text3">Total du groupe</p>
                  <p className="font-mono text-[15px] text-text mt-1">{formatMoney(totalSpent, currency)}</p>
                </div>
                <div className="w-px h-8 bg-white/[0.06]" />
                <div className="flex-1">
                  <p className="text-xs text-text3">Ma part</p>
                  <p className="font-mono text-[15px] text-text mt-1">{formatMoney(myShare, currency)}</p>
                </div>
                <div className="w-px h-8 bg-white/[0.06]" />
                <div className="flex-1">
                  <p className="text-xs text-text3">Dépenses</p>
                  <p className="font-mono text-[15px] text-text mt-1">{group.expenses.length}</p>
                </div>
              </div>
            </div>
          )
        })()}

        {/* Qui a avancé / qui doit — lecture visuelle des soldes */}
        {group.expenses?.length > 0 && (
          <>
            <SectionLabel label="Positions" />
            <Card>
              <div className="space-y-3.5">
                {netRows.map(({ member: m, net }: any) => {
                  const isMe = m.userId === user?.id
                  const creditor = net > 0.005
                  const debtor = net < -0.005
                  const width = `${Math.max(Math.abs(net) / maxAbsNet * 100, net === 0 ? 0 : 3)}%`
                  return (
                    <div key={m.id} className="flex items-center gap-3">
                      <Avatar initials={m.avatarInitials} color={m.avatarColor} size={30} />
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm truncate ${isMe ? 'text-text font-medium' : 'text-text2'}`}>
                          {m.displayName}{isMe ? ' (moi)' : ''}
                        </p>
                        {/* Une seule direction : la couleur dit le sens, la
                            longueur dit l'ampleur. */}
                        <div className="h-1 rounded-full bg-surface2 mt-[7px] overflow-hidden">
                          {!!(creditor || debtor) && (
                            <div className={`h-full rounded-full ${creditor ? 'bg-green' : 'bg-amber'}`} style={{ width }} />
                          )}
                        </div>
                      </div>
                      <span className={`font-mono text-[15px] font-medium shrink-0 ${
                        creditor ? 'text-green' : debtor ? 'text-amber' : 'text-text3'
                      }`}>
                        {net > 0 ? '+' : ''}{formatMoney(net, currency)}
                      </span>
                    </div>
                  )
                })}
              </div>
              <p className="text-[13px] text-text3 mt-4 leading-relaxed">
                Vert : cette personne a avancé plus que sa part. Orange : elle doit encore.
                Les remboursements ci-dessous soldent tout en un minimum de virements.
              </p>
            </Card>
          </>
        )}

        {/* Remboursements — leur propre ecran : ils occupaient la moitie de
            la page et repoussaient les depenses hors de vue. */}
        {(group.balances?.length > 0 || (group.settlements || []).length > 0) && (
          <>
            <SectionLabel label={t('settlements.section')} />
            <div
              onClick={() => router.push(`/group/settlements?groupId=${group.id}`)}
              className="bg-surface rounded-2xl p-5 mb-3 cursor-pointer hover:bg-surface2 transition-colors flex items-center gap-4"
            >
              <div className="w-[38px] h-[38px] rounded-xl bg-surface2 flex items-center justify-center shrink-0 text-text2">
                <FileText size={17} strokeWidth={1.75} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-medium text-text">
                  {group.balances?.length > 0
                    ? `${group.balances.length} remboursement${group.balances.length > 1 ? 's' : ''} a regler`
                    : t('settlements.all_settled')}
                </p>
                {myPendingCount > 0 && (
                  <p className="text-xs text-amber mt-0.5">
                    {t('settlements.pending_badge', { n: myPendingCount })}
                  </p>
                )}
              </div>
              <ChevronRight size={18} strokeWidth={2} className="text-text3 shrink-0" />
            </div>
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
            const payer = exp.payments?.[0]?.member?.displayName
            return (
              <div key={exp.id} onClick={() => router.push(`/expense/${exp.id}`)}
                className="bg-surface rounded-2xl p-4 cursor-pointer hover:bg-surface2 transition-colors flex items-center gap-3.5">
                <div className={`w-[38px] h-[38px] rounded-xl flex items-center justify-center shrink-0 ${
                  incomplete ? 'bg-amber/10 text-amber' : 'bg-surface2 text-text2'
                }`}>
                  {incomplete
                    ? <Clock size={17} strokeWidth={1.75} />
                    : exp.receiptImageUrl ? <Receipt size={17} strokeWidth={1.75} /> : <FileText size={17} strokeWidth={1.75} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-medium text-text truncate">{exp.description}</p>
                  <p className={`text-xs mt-0.5 ${incomplete ? 'text-amber' : 'text-text3'}`}>
                    {incomplete
                      ? 'Répartition à compléter'
                      : `${payer ? payer + ' a payé · ' : ''}${new Date(exp.createdAt).toLocaleDateString('fr-FR')}`}
                  </p>
                </div>
                <span className="font-mono text-base text-text shrink-0">{formatMoney(exp.totalAmount, exp.currency)}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="fixed bottom-[max(env(safe-area-inset-bottom),16px)] left-0 right-0 px-5 max-w-sm mx-auto">
        <Button label="Ajouter une dépense" icon={<Plus size={18} strokeWidth={2} />}
          onClick={() => router.push(`/expense/add?groupId=${group.id}`)} />
      </div>

    </div>
  )
}