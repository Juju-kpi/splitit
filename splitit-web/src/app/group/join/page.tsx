'use client'
// src/app/group/join/page.tsx
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { groupsApi } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { Button, Input, Notice, Avatar } from '@/components/ui'

export default function JoinGroupPage() {
  const router = useRouter()
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
      setError(e?.response?.data?.error || "Code invalide. Vérifie et réessaie.")
    } finally { setLoading(false) }
  }

  async function handleJoin() {
    setLoading(true); setError('')
    try {
      const group = await groupsApi.join(code.trim(), displayName.trim() || user?.username || 'Moi', claimMemberId)
      router.replace(`/group/${group.id}`)
    } catch (e: any) {
      setError(e?.response?.data?.error || "Impossible de rejoindre ce groupe.")
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen px-5 py-6 max-w-sm mx-auto">
      <button onClick={() => router.back()} className="bg-surface2 border border-border/50 px-3 py-1.5 rounded-full text-xs font-medium text-text2 mb-8">
        ← Retour
      </button>
      <h1 className="text-[26px] font-bold text-text mb-1">Rejoindre un groupe</h1>
      <p className="text-sm text-text3 mb-7">Entre le code d'invitation partagé par un membre.</p>

      {!preview ? (
        <form onSubmit={handlePreview}>
          <Input label="Code d'invitation" placeholder="Ex. AB12CD" value={code}
            onChange={v => { setCode(v.toUpperCase()); setError('') }} autoFocus />
          {error && <p className="text-red text-[13px] mb-2">{error}</p>}
          <Button label="Vérifier le code" type="submit" loading={loading} />
        </form>
      ) : (
        <div>
          <div className="glass-card rounded-2xl p-5 mb-5">
            <h2 className="text-lg font-bold text-text mb-1">{preview.emoji} {preview.name}</h2>
            <p className="text-xs text-text3 mb-3">{preview.members?.length || 0} membre(s)</p>
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
          <Notice variant="accent" text="Si tu apparais déjà dans la liste (ex : on a ajouté tes dépenses avant que tu rejoignes), sélectionne ton nom ci-dessus pour récupérer ton historique." />
          <Input label="Ton nom dans ce groupe" placeholder="Comme tu veux être affiché" value={displayName} onChange={setDisplayName} />
          {error && <p className="text-red text-[13px] mb-2">{error}</p>}
          <Button label="Rejoindre le groupe" onClick={handleJoin} loading={loading} />
        </div>
      )}
    </div>
  )
}
