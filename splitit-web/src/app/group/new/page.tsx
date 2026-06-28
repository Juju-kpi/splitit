'use client'
// src/app/group/new/page.tsx
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { groupsApi } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { Button, Input } from '@/components/ui'

const EMOJIS = ['🏠', '✈️', '🍽️', '🎉', '🚗', '🏖️', '🛒', '💼', '🎓', '⚽️', '🎬', '💸']

export default function NewGroupPage() {
  const router = useRouter()
  const user = useAuthStore(s => s.user)
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('🏠')
  const [displayName, setDisplayName] = useState(user?.username || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Donne un nom à ton groupe.'); return }
    setLoading(true); setError('')
    try {
      const group = await groupsApi.create(name.trim(), emoji, displayName.trim() || user?.username || 'Moi')
      router.replace(`/group/${group.id}`)
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Impossible de créer le groupe.')
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen px-5 py-6 max-w-sm mx-auto">
      <button onClick={() => router.back()} className="bg-surface2 border border-border/50 px-3 py-1.5 rounded-full text-xs font-medium text-text2 mb-8">
        ← Retour
      </button>
      <h1 className="text-[26px] font-bold text-text mb-1">Nouveau groupe</h1>
      <p className="text-sm text-text3 mb-7">Choisis un nom et une icône pour ton groupe.</p>

      <form onSubmit={handleCreate}>
        <label className="block text-xs font-semibold text-text3 uppercase tracking-widest mb-2">Icône</label>
        <div className="flex flex-wrap gap-2 mb-5">
          {EMOJIS.map(e => (
            <button key={e} type="button" onClick={() => setEmoji(e)}
              className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl border ${emoji === e ? 'border-accent bg-accent/10' : 'border-border bg-surface2'}`}>
              {e}
            </button>
          ))}
        </div>
        <Input label="Nom du groupe" placeholder="Colocation, Voyage Rome…" value={name} onChange={v => { setName(v); setError('') }} autoFocus />
        <Input label="Ton nom dans ce groupe" placeholder="Comme tu veux être affiché" value={displayName} onChange={setDisplayName} />
        {error && <p className="text-red text-[13px] mb-2">{error}</p>}
        <Button label="Créer le groupe" type="submit" loading={loading} />
      </form>
    </div>
  )
}
