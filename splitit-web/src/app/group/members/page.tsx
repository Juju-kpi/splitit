'use client'
// src/app/group/members/page.tsx
//
// Deux usages :
//   1. Ajouter des membres "placeholder" (sans compte) pour pouvoir répartir
//      les dépenses avant que les gens rejoignent le groupe.
//   2. Quitter le groupe (zone sensible en bas de page).
import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { groupsApi } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { Avatar, Button, Input, Pill } from '@/components/ui'
import { useT, formatMoney } from '@/store/langStore'

function MembersInner() {
  const router = useRouter()
  const t = useT()
  const params = useSearchParams()
  const groupId = params.get('groupId') || ''
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const [name, setName] = useState('')
  const [leaving, setLeaving] = useState(false)
  const [error, setError] = useState('')

  const { data: group, isLoading } = useQuery({
    queryKey: ['group', groupId],
    queryFn: () => groupsApi.get(groupId),
    enabled: !!groupId,
  })

  const addMutation = useMutation({
    mutationFn: () => groupsApi.addMember(groupId, name.trim()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['group', groupId] }); setName('') },
  })

  // ── Quitter le groupe ──────────────────────────────────────────────────
  // Le backend renvoie 409 UNSETTLED_BALANCE si un solde est encore ouvert :
  // on affiche alors le détail et on redemande confirmation avant de forcer.
  async function handleLeave() {
    if (!confirm(t('groups.leave_confirm', { name: group?.name || '' }))) return
    setError('')
    setLeaving(true)
    try {
      await doLeave(false)
    } catch (e: any) {
      const res = e?.response?.data
      if (e?.response?.status === 409 && res?.error === 'UNSETTLED_BALANCE') {
        const lines: string[] = []
        if (res.data?.owes > 0) lines.push(t('groups.leave_unsettled_owes', { amount: formatMoney(res.data.owes) }))
        if (res.data?.owed > 0) lines.push(t('groups.leave_unsettled_owed', { amount: formatMoney(res.data.owed) }))
        lines.push(t('groups.leave_unsettled_confirm'))
        if (confirm(lines.join('\n'))) {
          try { await doLeave(true) } catch { setError(t('groups.leave_error')) }
        }
      } else {
        setError(res?.error || t('groups.leave_error'))
      }
    } finally {
      setLeaving(false)
    }
  }

  async function doLeave(force: boolean) {
    await groupsApi.leave(groupId, force)
    qc.invalidateQueries({ queryKey: ['groups'] })
    qc.removeQueries({ queryKey: ['group', groupId] })
    router.replace('/groups')
  }

  return (
    <div className="min-h-screen px-5 max-w-sm mx-auto pt-[max(env(safe-area-inset-top),24px)] pb-[max(env(safe-area-inset-bottom),32px)]">
      <button onClick={() => router.back()} className="bg-surface2 border border-border/50 px-4 py-2 rounded-full text-xs font-medium text-text2 mb-8 min-h-[36px]">
        {t('common.back')}
      </button>
      <h1 className="text-[26px] font-bold text-text mb-1">{t('groups.members')}</h1>
      <p className="text-sm text-text3 mb-6">{group?.name}</p>

      <div className="space-y-2 mb-6">
        {!isLoading && group?.members?.map((m: any) => (
          <div key={m.id} className="glass-card rounded-xl p-3.5 flex items-center gap-3">
            <Avatar initials={m.avatarInitials} color={m.avatarColor} size={36} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-text truncate">{m.displayName}</p>
              {!m.userId && <p className="text-[11px] text-text3">{t('groups.not_joined')}</p>}
            </div>
            {m.userId === user?.id && <Pill label={t('groups.me')} />}
          </div>
        ))}
      </div>

      <p className="text-xs font-semibold text-text3 uppercase tracking-widest mb-2">{t('groups.add_ghost_member')}</p>
      <p className="text-xs text-text3 mb-3 leading-relaxed">{t('groups.ghost_hint')}</p>
      <Input label={t('groups.name_label')} placeholder={t('groups.add_member_name_ph')} value={name} onChange={setName} autoCapitalize="words" />
      <Button label={t('groups.add')} onClick={() => addMutation.mutate()} loading={addMutation.isPending} disabled={!name.trim()} />

      {/* ── Quitter le groupe ─────────────────────────────────────────── */}
      <div className="mt-10 pt-6 border-t border-white/5">
        <p className="text-xs font-semibold text-text3 uppercase tracking-widest mb-2">{t('groups.leave_section')}</p>
        <p className="text-xs text-text3 mb-3 leading-relaxed">{t('groups.leave_hint')}</p>
        {error && <p className="text-red text-[13px] mb-2">{error}</p>}
        <Button label={t('groups.leave')} variant="danger" onClick={handleLeave} loading={leaving} disabled={!groupId} />
      </div>
    </div>
  )
}

export default function MembersPage() {
  return <Suspense><MembersInner /></Suspense>
}
