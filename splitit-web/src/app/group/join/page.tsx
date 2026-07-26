'use client'
// src/app/group/join/page.tsx
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { groupsApi } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { Button, Input, Notice, Avatar } from '@/components/ui'
import { useT } from '@/store/langStore'

export default function JoinGroupPage() {
  const router = useRouter()
  const t = useT()
  const user = useAuthStore(s => s.user)
  const [code, setCode] = useState('')
  const [preview, setPreview] = useState<any>(null)
  const [displayName, setDisplayName] = useState(user?.username || '')
  const [claimMemberId, setClaimMemberId] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handlePreview(e: React.FormEvent) {
    e.preventDefault()
    if (!code.trim()) return
    setLoading(true); setError('')
    try {
      const data = await groupsApi.joinPreview(code.trim())
      setPreview(data)
    } catch (e: any) {
      setError(e?.response?.data?.error || t('groups.code_invalid_web'))
    } finally { setLoading(false) }
  }

  async function handleJoin() {
    setLoading(true); setError('')
    try {
      const group = await groupsApi.join(code.trim(), displayName.trim() || user?.username || 'Moi', claimMemberId)
      router.replace(`/group/${group.id}`)
    } catch (e: any) {
      setError(e?.response?.data?.error || t('groups.join_error_web'))
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen px-5 py-6 max-w-sm mx-auto">
      <button onClick={() => router.back()} className="bg-surface2 border border-border/50 px-3 py-1.5 rounded-full text-xs font-medium text-text2 mb-8">
        {t('common.back')}
      </button>
      <h1 className="text-[26px] font-bold text-text mb-1">{t('groups.join')}</h1>
      <p className="text-sm text-text3 mb-7">{t('groups.join_sub')}</p>

      {!preview ? (
        <form onSubmit={handlePreview}>
          <Input label={t('groups.invite_code')} placeholder={t('groups.code_ph')} value={code}
            onChange={v => { setCode(v.toUpperCase()); setError('') }} autoFocus />
          {error && <p className="text-red text-[13px] mb-2">{error}</p>}
          <Button label={t('groups.verify_code')} type="submit" loading={loading} />
        </form>
      ) : (
        <div>
          <div className="glass-card rounded-2xl p-5 mb-5">
            <h2 className="text-lg font-bold text-text mb-1">{preview.emoji} {preview.name}</h2>
            <p className="text-xs text-text3 mb-3">{t('groups.member_count', { n: preview.members?.length || 0 })}</p>
            <div className="flex flex-wrap gap-2">
              {preview.members?.map((m: any) => (
                <button key={m.id} type="button"
                  onClick={() => setClaimMemberId(claimMemberId === m.id ? undefined : m.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs border ${claimMemberId === m.id ? 'border-accent bg-accent/10 text-accent2' : 'border-border bg-surface2 text-text2'}`}>
                  <Avatar initials={m.avatarInitials} color={m.avatarColor} size={20} />
                  {m.displayName}
                </button>
              ))}
            </div>
          </div>
          <Notice variant="accent" text={t('groups.join_claim_notice')} />
          <Input label={t('groups.your_name_in_group')} placeholder={t('groups.your_name_ph')} value={displayName} onChange={setDisplayName} />
          {error && <p className="text-red text-[13px] mb-2">{error}</p>}
          <Button label={t('groups.join_group_btn')} onClick={handleJoin} loading={loading} />
        </div>
      )}
    </div>
  )
}
