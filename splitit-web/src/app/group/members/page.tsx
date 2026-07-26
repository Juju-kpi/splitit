'use client'
// src/app/group/members/page.tsx
import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { groupsApi } from '@/lib/api'
import { Avatar, Button, Input } from '@/components/ui'
import { useT } from '@/store/langStore'

function MembersInner() {
  const router = useRouter()
  const t = useT()
  const params = useSearchParams()
  const groupId = params.get('groupId') || ''
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [adding, setAdding] = useState(false)

  const { data: group, isLoading } = useQuery({
    queryKey: ['group', groupId],
    queryFn: () => groupsApi.get(groupId),
    enabled: !!groupId,
  })

  const addMutation = useMutation({
    mutationFn: () => groupsApi.addMember(groupId, name.trim()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['group', groupId] }); setName('') },
  })

  return (
    <div className="min-h-screen px-5 py-6 max-w-sm mx-auto">
      <button onClick={() => router.back()} className="bg-surface2 border border-border/50 px-3 py-1.5 rounded-full text-xs font-medium text-text2 mb-8">
        {t('common.back')}
      </button>
      <h1 className="text-[26px] font-bold text-text mb-1">{t('groups.members')}</h1>
      <p className="text-sm text-text3 mb-6">{group?.name}</p>

      <div className="space-y-2 mb-6">
        {!isLoading && group?.members?.map((m: any) => (
          <div key={m.id} className="glass-card rounded-xl p-3.5 flex items-center gap-3">
            <Avatar initials={m.avatarInitials} color={m.avatarColor} size={36} />
            <div>
              <p className="text-sm font-semibold text-text">{m.displayName}</p>
              {!m.userId && <p className="text-[11px] text-text3">{t('groups.not_joined')}</p>}
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs font-semibold text-text3 uppercase tracking-widest mb-2">{t('groups.add_ghost_member')}</p>
      <p className="text-xs text-text3 mb-3 leading-relaxed">{t('groups.ghost_hint')}</p>
      <Input label={t('groups.name_label')} placeholder={t('groups.add_member_name_ph')} value={name} onChange={setName} />
      <Button label={t('groups.add')} onClick={() => addMutation.mutate()} loading={addMutation.isPending} disabled={!name.trim()} />
    </div>
  )
}

export default function MembersPage() {
  return <Suspense><MembersInner /></Suspense>
}
