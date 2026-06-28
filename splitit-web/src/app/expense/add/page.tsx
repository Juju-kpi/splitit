'use client'
// src/app/expense/add/page.tsx
import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useMutation } from '@tanstack/react-query'
import { groupsApi, expensesApi, ocrApi } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { Avatar, Button, Input, Chip, FullScreenSpinner, Notice } from '@/components/ui'

function AddExpenseInner() {
  const router = useRouter()
  const params = useSearchParams()
  const groupId = params.get('groupId') || ''
  const user = useAuthStore(s => s.user)

  const { data: group, isLoading } = useQuery({
    queryKey: ['group', groupId],
    queryFn: () => groupsApi.get(groupId),
    enabled: !!groupId,
  })

  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [paidByMemberId, setPaidByMemberId] = useState<string>('')
  const [splitType, setSplitType] = useState<'EQUAL' | 'CUSTOM'>('EQUAL')
  const [splitMemberIds, setSplitMemberIds] = useState<string[]>([])
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [scanning, setScanning] = useState(false)

  useEffect(() => {
    if (group && !paidByMemberId) {
      const me = group.members.find((m: any) => m.userId === user?.id)
      setPaidByMemberId(me?.id || group.members[0]?.id || '')
      setSplitMemberIds(group.members.map((m: any) => m.id))
    }
  }, [group])

  const createMutation = useMutation({
    mutationFn: (payload: any) => expensesApi.create(payload),
    onSuccess: () => router.replace(`/group/${groupId}`),
    onError: (e: any) => setError(e?.response?.data?.error || 'Impossible de créer la dépense.'),
  })

  if (isLoading || !group) return <FullScreenSpinner />

  const total = parseFloat(amount.replace(',', '.')) || 0
  const customTotal = Object.values(customAmounts).reduce((s, v) => s + (parseFloat(v.replace(',', '.')) || 0), 0)

  function toggleSplitMember(id: string) {
    setSplitMemberIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function handleScan(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setScanning(true); setError('')
    try {
      const result = await ocrApi.scan(file)
      if (result.vendor && !description) setDescription(result.vendor)
      const sum = (result.items || []).reduce((s: number, it: any) => s + it.price, 0)
      if (sum > 0) setAmount(sum.toFixed(2))
    } catch {
      setError("Scan impossible, renseigne le montant manuellement.")
    } finally {
      setScanning(false)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!description.trim()) { setError('Donne une description.'); return }
    if (total <= 0) { setError('Indique un montant valide.'); return }
    if (!paidByMemberId) { setError('Indique qui a payé.'); return }

    let payload: any = {
      groupId,
      description: description.trim(),
      totalAmount: total,
      paidByMemberId,
      splitType,
    }
    if (splitType === 'EQUAL') {
      if (splitMemberIds.length === 0) { setError('Sélectionne au moins un participant.'); return }
      payload.splitMemberIds = splitMemberIds
    } else {
      if (Math.abs(customTotal - total) > 0.02) { setError(`La somme des parts (${customTotal.toFixed(2)}) doit être égale au montant total (${total.toFixed(2)}).`); return }
      payload.customSplits = Object.entries(customAmounts)
        .filter(([, v]) => parseFloat(v) > 0)
        .map(([memberId, v]) => ({ memberId, amount: parseFloat(v.replace(',', '.')) }))
    }
    setError('')
    createMutation.mutate(payload)
  }

  return (
    <div className="min-h-screen px-5 py-6 max-w-sm mx-auto pb-16">
      <button onClick={() => router.back()} className="bg-surface2 border border-border/50 px-3 py-1.5 rounded-full text-xs font-medium text-text2 mb-6">
        ← Retour
      </button>
      <h1 className="text-[26px] font-bold text-text mb-1">Nouvelle dépense</h1>
      <p className="text-sm text-text3 mb-6">{group.emoji} {group.name}</p>

      <label className="block mb-5">
        <span className="block text-xs font-semibold text-text3 uppercase tracking-widest mb-2">Scanner un reçu (optionnel)</span>
        <div className="flex items-center justify-center gap-2 border border-dashed border-border2 rounded-xl py-4 text-sm text-text2 cursor-pointer hover:border-accent/40">
          {scanning ? 'Analyse en cours…' : '📷 Prendre une photo du reçu'}
        </div>
        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleScan} disabled={scanning} />
      </label>

      <form onSubmit={handleSubmit}>
        <Input label="Description" placeholder="Courses, restaurant…" value={description} onChange={setDescription} autoFocus />
        <Input label="Montant total" placeholder="0.00" value={amount} onChange={setAmount} type="text" />

        <span className="block text-xs font-semibold text-text3 uppercase tracking-widest mb-2 mt-1">Payé par</span>
        <div className="flex flex-wrap mb-4">
          {group.members.map((m: any) => (
            <Chip key={m.id} label={m.displayName} selected={paidByMemberId === m.id} onClick={() => setPaidByMemberId(m.id)} avatar={{ initials: m.avatarInitials, color: m.avatarColor }} />
          ))}
        </div>

        <span className="block text-xs font-semibold text-text3 uppercase tracking-widest mb-2">Type de répartition</span>
        <div className="flex gap-2 mb-4">
          <button type="button" onClick={() => setSplitType('EQUAL')}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border ${splitType === 'EQUAL' ? 'border-accent bg-accent/10 text-accent2' : 'border-border bg-surface2 text-text2'}`}>
            Égal
          </button>
          <button type="button" onClick={() => setSplitType('CUSTOM')}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border ${splitType === 'CUSTOM' ? 'border-accent bg-accent/10 text-accent2' : 'border-border bg-surface2 text-text2'}`}>
            Montants personnalisés
          </button>
        </div>

        {splitType === 'EQUAL' ? (
          <div className="mb-4">
            <span className="block text-xs font-semibold text-text3 uppercase tracking-widest mb-2">Entre qui ?</span>
            <div className="flex flex-wrap">
              {group.members.map((m: any) => (
                <Chip key={m.id} label={m.displayName} selected={splitMemberIds.includes(m.id)} onClick={() => toggleSplitMember(m.id)} avatar={{ initials: m.avatarInitials, color: m.avatarColor }} />
              ))}
            </div>
            {total > 0 && splitMemberIds.length > 0 && (
              <p className="text-xs text-text3 mt-2">{(total / splitMemberIds.length).toFixed(2)} par personne</p>
            )}
          </div>
        ) : (
          <div className="mb-4 space-y-2">
            {group.members.map((m: any) => (
              <div key={m.id} className="flex items-center gap-3">
                <Avatar initials={m.avatarInitials} color={m.avatarColor} size={28} />
                <span className="text-sm text-text2 flex-1">{m.displayName}</span>
                <input
                  className="w-24 bg-surface2 border border-border rounded-lg px-2 py-1.5 text-sm text-text text-right outline-none focus:border-accent"
                  placeholder="0.00"
                  value={customAmounts[m.id] || ''}
                  onChange={e => setCustomAmounts(prev => ({ ...prev, [m.id]: e.target.value }))}
                />
              </div>
            ))}
            <p className={`text-xs ${Math.abs(customTotal - total) > 0.02 ? 'text-red' : 'text-green'}`}>
              Total parts : {customTotal.toFixed(2)} / {total.toFixed(2)}
            </p>
          </div>
        )}

        {error && <Notice variant="amber" text={error} />}
        <Button label="Ajouter la dépense" type="submit" loading={createMutation.isPending} />
      </form>
    </div>
  )
}

export default function AddExpensePage() {
  return <Suspense><AddExpenseInner /></Suspense>
}
