'use client'
// src/app/expense/add/page.tsx
// Port complet de AddExpenseScreen (app) vers le web :
//   - Step 1 : select (Scanner OCR / Manuel)
//   - Step 2 : ocr — scan + assignation item par item
//   - Step 3 : manual — description + montant + répartition égale/custom
//   - Step 4 : who_paid — multi-payeurs
//   - Step 5 : summary — résumé + confirmation
//   - Edit mode : si ?expenseId=&edit=true, pré-remplit depuis l'API
import { useState, useEffect, useMemo, Suspense, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { groupsApi, expensesApi, ocrApi } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { Avatar, Button, Input, Chip, FullScreenSpinner, Notice, SectionLabel } from '@/components/ui'

// ── Types ─────────────────────────────────────────────────────────────────────
type Step = 'select' | 'ocr' | 'manual' | 'who_paid' | 'summary'
type SplitMode = 'equal' | 'custom'

interface PayerEntry { memberId: string; amount: string }

interface OcrItemLocal {
  id: string; name: string; price: number
  ocrRaw?: string; ocrPriceRaw?: string; confidence?: number
  corrected: boolean; assignedTo: string[]
  editName: string; editPrice: string; editing: boolean
}

// ── Step header ───────────────────────────────────────────────────────────────
function StepHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="px-5 pt-[max(env(safe-area-inset-top),16px)] pb-4 sticky top-0 z-20 glass border-b border-white/5 mb-1">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="bg-surface2 border border-border/50 px-3 py-1.5 rounded-full text-xs font-medium text-text2 shrink-0">
          ← Retour
        </button>
        <h1 className="text-base font-bold text-text truncate">{title}</h1>
      </div>
    </div>
  )
}

// ── Balance bar ───────────────────────────────────────────────────────────────
function BalanceBar({ current, target, label }: { current: number; target: number; label?: string }) {
  const ok = target > 0 && Math.abs(current - target) < 0.02
  return (
    <div className={`rounded-xl p-3 mb-3 text-center text-sm font-mono font-semibold ${ok ? 'bg-green/10 text-green' : 'bg-amber/10 text-amber'}`}>
      {ok ? `✓ Équilibré — ${current.toFixed(2)}` : `${current.toFixed(2)} / ${target.toFixed(2)}${label ? ` ${label}` : ''}`}
    </div>
  )
}

// ── Main inner component ──────────────────────────────────────────────────────
function AddExpenseInner() {
  const router = useRouter()
  const params = useSearchParams()
  const groupId = params.get('groupId') || ''
  const expenseId = params.get('expenseId') || ''
  const editMode = params.get('edit') === 'true' && !!expenseId
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const fileRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>(editMode ? 'ocr' : 'select')
  const [initialized, setInitialized] = useState(false)

  // Manuel
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [splitMode, setSplitMode] = useState<SplitMode>('equal')
  const [splitMemberIds, setSplitMemberIds] = useState<string[]>([])
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({})

  // OCR
  const [ocrItems, setOcrItems] = useState<OcrItemLocal[]>([])
  const [ocrImageUrl, setOcrImageUrl] = useState<string>('')
  const [showReceipt, setShowReceipt] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState('')

  // Payeurs
  const [payers, setPayers] = useState<PayerEntry[]>([{ memberId: '', amount: '' }])
  const [error, setError] = useState('')

  const { data: group, isLoading } = useQuery({
    queryKey: ['group', groupId],
    queryFn: () => groupsApi.get(groupId),
    enabled: !!groupId,
  })

  const { data: existingExpense } = useQuery({
    queryKey: ['expense', expenseId],
    queryFn: () => expensesApi.get(expenseId),
    enabled: editMode && !!expenseId,
  })

  const members: any[] = group?.members || []
  const myMember = members.find((m: any) => m.userId === user?.id)

  // Pré-remplir en mode edit
  useEffect(() => {
    if (!editMode || !existingExpense || !members.length || initialized) return
    const exp = existingExpense as any
    setDescription(exp.description || '')
    setOcrImageUrl(exp.receiptImageUrl || '')
    if (exp.items?.length > 0) {
      setOcrItems(exp.items.map((item: any, i: number) => ({
        id: `existing_${i}`, name: item.name, price: item.price,
        ocrRaw: item.ocrRaw, confidence: item.ocrConfidence, corrected: item.corrected,
        assignedTo: (item.assignedTo || []).map((a: any) => a.memberId),
        editName: item.name, editPrice: item.price.toFixed(2), editing: false,
      })))
      setStep('ocr')
    } else {
      setAmount(exp.totalAmount?.toFixed(2) || '')
      setStep('manual')
    }
    if (exp.payments?.length > 0) {
      setPayers(exp.payments.map((p: any) => ({ memberId: p.memberId, amount: p.amount.toFixed(2) })))
    }
    setInitialized(true)
  }, [existingExpense, members, editMode, initialized])

  // Mutations
  const createMutation = useMutation({
    mutationFn: expensesApi.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['group', groupId] }); router.replace(`/group/${groupId}`) },
    onError: (e: any) => setError(e?.response?.data?.error || "Impossible d'ajouter la dépense"),
  })
  const updateMutation = useMutation({
    mutationFn: ({ items, payments, desc }: any) => expensesApi.updateItems(expenseId, { items, payments, description: desc }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['group', groupId] }); qc.invalidateQueries({ queryKey: ['expense', expenseId] }); router.back() },
    onError: (e: any) => setError(e?.response?.data?.error || 'Impossible de mettre à jour'),
  })

  // Calculs
  const totalAmount = useMemo(() => {
    if (ocrItems.length > 0) return ocrItems.reduce((s, i) => s + i.price, 0)
    return parseFloat(amount.replace(',', '.')) || 0
  }, [ocrItems, amount])

  const activeMemberIds = splitMemberIds.length > 0 ? splitMemberIds : members.map((m: any) => m.id)

  const manualSplits = useMemo(() => {
    if (splitMode === 'equal') {
      const share = activeMemberIds.length > 0 ? totalAmount / activeMemberIds.length : 0
      return activeMemberIds.map(id => ({ memberId: id, amount: share }))
    }
    return activeMemberIds.map(id => ({
      memberId: id, amount: parseFloat((customAmounts[id] || '0').replace(',', '.')) || 0,
    }))
  }, [splitMode, activeMemberIds, totalAmount, customAmounts])

  const customTotal = useMemo(() => manualSplits.reduce((s, r) => s + r.amount, 0), [manualSplits])
  const isCustomBalanced = splitMode === 'equal' || Math.abs(customTotal - totalAmount) < 0.02

  const ocrSplitByMember = useMemo(() => {
    const result: Record<string, number> = {}
    ocrItems.forEach(item => {
      if (!item.assignedTo.length) return
      const share = item.price / item.assignedTo.length
      item.assignedTo.forEach(mid => { result[mid] = (result[mid] || 0) + share })
    })
    return result
  }, [ocrItems])

  const resolvedPayments = useMemo(() =>
    payers.filter(p => p.memberId && parseFloat(p.amount.replace(',', '.')) > 0)
      .map(p => ({ memberId: p.memberId, amount: parseFloat(p.amount.replace(',', '.')) })),
    [payers])

  const payerTotal = useMemo(() => resolvedPayments.reduce((s, p) => s + p.amount, 0), [resolvedPayments])
  const isPayerBalanced = totalAmount > 0 && Math.abs(payerTotal - totalAmount) < 0.02
  const unassignedItems = ocrItems.filter(i => i.assignedTo.length === 0)

  function memberById(id: string) { return members.find((m: any) => m.id === id) }

  function toggleSplitMember(id: string) {
    setSplitMemberIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  function availableMembers(currentIdx: number): any[] {
    const usedIds = payers.filter((_, i) => i !== currentIdx).map(p => p.memberId).filter(Boolean)
    return members.filter((m: any) => !usedIds.includes(m.id))
  }

  function setPayerMember(idx: number, memberId: string) {
    setPayers(prev => {
      const next = prev.map((p, i) => i === idx ? { ...p, memberId } : p)
      if (next.length === 1 && totalAmount > 0) next[0].amount = totalAmount.toFixed(2)
      return next
    })
  }

  function assignRemainingToMe() {
    if (!myMember) return
    setOcrItems(prev => prev.map(item => item.assignedTo.length === 0 ? { ...item, assignedTo: [myMember.id] } : item))
  }

  function goToWhoPaid() {
    setError('')
    if (ocrItems.length > 0) {
      const assigned = ocrItems.some(i => i.assignedTo.length > 0)
      if (!assigned && !editMode) { setError('Assigne au moins un article à un membre.'); return }
    } else {
      if (!description.trim()) { setError('Description manquante.'); return }
      if (totalAmount <= 0) { setError('Montant invalide.'); return }
      if (!isCustomBalanced) { setError(`Total des parts (${customTotal.toFixed(2)}) ≠ montant (${totalAmount.toFixed(2)}).`); return }
    }
    setPayers(prev => {
      if (prev.length === 1 && (!prev[0].amount || prev[0].amount === '0') && totalAmount > 0) {
        return [{ ...prev[0], amount: totalAmount.toFixed(2) }]
      }
      return prev
    })
    setStep('who_paid')
  }

  async function handleScan(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setScanning(true); setScanError('')
    try {
      const result = await ocrApi.scan(file)
      // Port complet : on génère des OcrItemLocal à partir des items retournés
      if (result.items?.length > 0) {
        const localItems: OcrItemLocal[] = result.items.map((it: any, i: number) => ({
          id: `ocr_${i}`, name: it.name, price: it.price,
          ocrRaw: it.ocrRaw, ocrPriceRaw: it.ocrPriceRaw, confidence: it.confidence,
          corrected: false, assignedTo: [],
          editName: it.name, editPrice: it.price.toFixed(2), editing: false,
        }))
        setOcrItems(localItems)
        if (result.vendor && !description) setDescription(result.vendor)
      } else {
        // Fallback : pas d'items détectés, on remplit juste le montant
        const sum = (result.items || []).reduce((s: number, it: any) => s + it.price, 0)
        if (result.vendor && !description) setDescription(result.vendor)
        if (sum > 0) setAmount(sum.toFixed(2))
        setScanError('Aucun article détecté — montant total extrait uniquement.')
      }
    } catch {
      setScanError('Scan impossible, renseigne le montant manuellement.')
    } finally {
      setScanning(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function handleSubmit() {
    setError('')
    if (resolvedPayments.length === 0) { setError('Sélectionne au moins un payeur.'); return }
    if (!isPayerBalanced) { setError(`Total payeurs (${payerTotal.toFixed(2)}) ≠ total (${totalAmount.toFixed(2)}).`); return }

    if (editMode) {
      updateMutation.mutate({
        items: ocrItems.map(item => ({
          name: item.name, price: item.price, ocrRaw: item.ocrRaw,
          ocrConfidence: item.confidence, corrected: item.corrected, assignedToMemberIds: item.assignedTo,
        })),
        payments: resolvedPayments,
        desc: description.trim() || (existingExpense as any)?.description || 'Ticket scanné',
      })
      return
    }

    if (ocrItems.length > 0) {
      createMutation.mutate({
        groupId, description: description.trim() || 'Ticket scanné',
        totalAmount, payments: resolvedPayments, splitType: 'ITEMIZED',
        receiptImageUrl: ocrImageUrl || undefined,
        items: ocrItems.map(item => ({
          name: item.name, price: item.price, ocrRaw: item.ocrRaw,
          ocrConfidence: item.confidence, corrected: item.corrected, assignedToMemberIds: item.assignedTo,
        })),
      })
    } else if (splitMode === 'custom') {
      createMutation.mutate({ groupId, description: description.trim(), totalAmount, payments: resolvedPayments, splitType: 'CUSTOM', customSplits: manualSplits, items: [] })
    } else {
      createMutation.mutate({ groupId, description: description.trim(), totalAmount, payments: resolvedPayments, splitType: 'EQUAL', splitMemberIds: activeMemberIds, items: [] })
    }
  }

  if (isLoading || !group) return <FullScreenSpinner />

  // ══════════════════════════════════════════════════════════════════════
  // STEP: select
  // ══════════════════════════════════════════════════════════════════════
  if (step === 'select') {
    return (
      <div className="min-h-screen bg-bg">
        <StepHeader title="Nouvelle dépense" onBack={() => router.back()} />
        <div className="px-5 py-4">
          <p className="text-sm text-text3 mb-5">{group.emoji} {group.name}</p>
          <Notice text="Le scan OCR détecte les articles automatiquement. Chacun coche ce qu'il a pris." />
          <div className="grid grid-cols-2 gap-3 mt-5">
            <label className="relative block">
              <div className={`glass-card rounded-2xl p-6 text-center cursor-pointer border-accent/30 bg-accent/10 hover:bg-accent/20 transition-colors ${scanning ? 'opacity-50' : ''}`}>
                <div className="text-3xl mb-2">{scanning ? '⏳' : '📷'}</div>
                <p className="text-sm font-bold text-white">{scanning ? 'Analyse…' : 'Scanner'}</p>
                <p className="text-xs text-accent2 mt-1">OCR gratuit</p>
              </div>
              <input ref={fileRef} type="file" accept="image/*" capture="environment" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleScan} disabled={scanning} />
            </label>
            <button onClick={() => setStep('manual')} className="glass-card rounded-2xl p-6 text-center hover:border-border2 transition-colors">
              <div className="text-3xl mb-2">✏️</div>
              <p className="text-sm font-bold text-text">Manuel</p>
              <p className="text-xs text-text3 mt-1">Montant global</p>
            </button>
          </div>
          {scanError && <Notice variant="amber" text={scanError} />}
          {ocrItems.length > 0 && (
            <div className="mt-4">
              <Notice variant="green" text={`${ocrItems.length} articles détectés — assignez-les aux membres.`} />
              <Button label="Voir les articles →" onClick={() => setStep('ocr')} />
            </div>
          )}
        </div>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════
  // STEP: ocr — assignation item par item
  // ══════════════════════════════════════════════════════════════════════
  if (step === 'ocr') {
    // Si pas d'items encore (scan venant d'être fait), rediriger vers select
    if (!editMode && ocrItems.length === 0) { setStep('select'); return null }

    return (
      <div className="min-h-screen bg-bg pb-28">
        <StepHeader title={editMode ? 'Compléter la dépense' : 'Articles scannés'} onBack={() => editMode ? router.back() : setStep('select')} />
        <div className="px-5 py-4">
          {ocrImageUrl && (
            <div className="mb-4">
              <button onClick={() => setShowReceipt(v => !v)} className="w-full glass-card rounded-xl py-2.5 text-sm text-accent2 font-medium text-center">
                {showReceipt ? '🙈 Masquer le ticket' : '🧾 Voir le ticket scanné'}
              </button>
              {showReceipt && <img src={ocrImageUrl} alt="Ticket" className="w-full rounded-xl mt-2 object-contain max-h-80" />}
            </div>
          )}

          {unassignedItems.length > 0 && (
            <>
              <Notice variant="amber" text={`${unassignedItems.length} article${unassignedItems.length > 1 ? 's' : ''} sans assignation.`} />
              {myMember && (
                <button onClick={assignRemainingToMe} className="w-full mb-3 py-2.5 px-4 rounded-xl bg-accent/10 border border-accent/25 text-accent2 text-sm font-semibold">
                  📌 Assigner les {unassignedItems.length} articles non assignés à moi
                </button>
              )}
            </>
          )}

          <SectionLabel label="ARTICLES" />
          <div className="space-y-3">
            {ocrItems.map((item, idx) => (
              <div key={item.id} className="glass-card rounded-xl p-4">
                <div className="flex items-start justify-between mb-3">
                  {item.editing ? (
                    <div className="flex-1 flex gap-2 mr-2">
                      <input
                        className="flex-1 bg-surface2 border border-accent/40 rounded-lg px-2 py-1 text-sm text-text outline-none"
                        value={item.editName}
                        onChange={e => setOcrItems(prev => prev.map((it, i) => i === idx ? { ...it, editName: e.target.value } : it))}
                      />
                      <input
                        className="w-20 bg-surface2 border border-accent/40 rounded-lg px-2 py-1 text-sm text-text text-right outline-none font-mono"
                        value={item.editPrice}
                        onChange={e => setOcrItems(prev => prev.map((it, i) => i === idx ? { ...it, editPrice: e.target.value } : it))}
                      />
                    </div>
                  ) : (
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-text">{item.name}</p>
                      {item.confidence !== undefined && item.confidence < 0.7 && (
                        <p className="text-xs text-amber mt-0.5">⚠ Confiance faible — vérifie le nom et le prix</p>
                      )}
                    </div>
                  )}
                  <div className="flex items-center gap-2 shrink-0">
                    {!item.editing && <span className="font-mono text-sm font-semibold text-accent2">{item.price.toFixed(2)}</span>}
                    <button
                      onClick={() => {
                        if (item.editing) {
                          // Sauvegarder les corrections
                          const newPrice = parseFloat(item.editPrice.replace(',', '.')) || item.price
                          const corrected = item.editName !== item.name || newPrice !== item.price
                          setOcrItems(prev => prev.map((it, i) => i === idx ? {
                            ...it, name: it.editName, price: newPrice, editing: false, corrected: corrected || it.corrected,
                          } : it))
                          if (corrected && item.ocrRaw) {
                            ocrApi.saveCorrection({
                              receiptId: `web_${Date.now()}`, itemIndex: idx,
                              ocrRaw: item.ocrRaw, ocrPriceRaw: item.ocrPriceRaw || '',
                              correctedName: item.editName, correctedPrice: newPrice,
                              confidence: item.confidence || 0.5,
                            }).catch(() => {})
                          }
                        } else {
                          setOcrItems(prev => prev.map((it, i) => i === idx ? { ...it, editing: true, editName: it.name, editPrice: it.price.toFixed(2) } : it))
                        }
                      }}
                      className="text-xs bg-surface2 border border-border px-2 py-1 rounded-lg text-text2"
                    >
                      {item.editing ? '✓ OK' : '✏️'}
                    </button>
                  </div>
                </div>
                <p className="text-[10px] uppercase tracking-widest text-text3 font-semibold mb-2">Qui a pris cet article ?</p>
                <div className="flex flex-wrap">
                  {members.map((m: any) => (
                    <Chip
                      key={m.id} label={m.displayName} selected={item.assignedTo.includes(m.id)}
                      avatar={{ initials: m.avatarInitials, color: m.avatarColor }}
                      onClick={() => setOcrItems(prev => prev.map((it, i) => {
                        if (i !== idx) return it
                        const already = it.assignedTo.includes(m.id)
                        return { ...it, assignedTo: already ? it.assignedTo.filter(id => id !== m.id) : [...it.assignedTo, m.id] }
                      }))}
                    />
                  ))}
                </div>
                <p className={`text-xs mt-1.5 ${item.assignedTo.length === 0 ? 'text-amber' : 'text-green'}`}>
                  {item.assignedTo.length === 0 ? '⚠ Non assigné' : `✓ ${item.assignedTo.map(id => memberById(id)?.displayName).filter(Boolean).join(', ')}`}
                </p>
              </div>
            ))}
          </div>

          {error && <Notice variant="amber" text={error} />}
        </div>
        <div className="fixed bottom-0 left-0 right-0 px-5 pb-[max(env(safe-area-inset-bottom),16px)] pt-3 glass border-t border-white/5">
          <Button label="Continuer → Qui a payé ?" onClick={goToWhoPaid} />
        </div>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════
  // STEP: manual
  // ══════════════════════════════════════════════════════════════════════
  if (step === 'manual') {
    return (
      <div className="min-h-screen bg-bg pb-28">
        <StepHeader title="Saisie manuelle" onBack={() => editMode ? router.back() : setStep('select')} />
        <div className="px-5 py-4">
          <Input label="Description" placeholder="Dîner restaurant, courses…" value={description} onChange={setDescription} autoFocus />
          <p className="text-xs font-semibold text-text3 uppercase tracking-widest mb-2">Montant total</p>
          <div className="relative mb-4">
            <input
              type="text" inputMode="decimal" placeholder="0.00" value={amount}
              onChange={e => setAmount(e.target.value)}
              className="w-full bg-surface2 border border-border rounded-xl px-4 py-4 text-text text-2xl font-mono outline-none focus:border-accent pr-14"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-text3 text-sm font-mono">CHF</span>
          </div>

          <SectionLabel label="QUI PARTAGE ?" />
          <p className="text-xs text-text3 mb-2">Aucune sélection = tout le monde</p>
          <div className="flex flex-wrap mb-4">
            {members.map((m: any) => (
              <Chip key={m.id} label={m.displayName}
                selected={splitMemberIds.includes(m.id) || splitMemberIds.length === 0}
                avatar={{ initials: m.avatarInitials, color: m.avatarColor }}
                onClick={() => toggleSplitMember(m.id)} />
            ))}
          </div>

          <SectionLabel label="RÉPARTITION" />
          <div className="flex gap-2 mb-4">
            {(['equal', 'custom'] as SplitMode[]).map(mode => (
              <button key={mode} onClick={() => setSplitMode(mode)}
                className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-colors ${splitMode === mode ? 'border-accent bg-accent/10 text-accent2' : 'border-border bg-surface2 text-text2'}`}>
                {mode === 'equal' ? '⚖️ Équitable' : '✏️ Personnalisé'}
              </button>
            ))}
          </div>

          {splitMode === 'equal' && totalAmount > 0 && (
            <div className="glass-card rounded-xl p-4 mb-4 space-y-2">
              <p className="text-xs text-text3 font-semibold mb-1">Chaque personne paie</p>
              {manualSplits.map(({ memberId, amount: amt }) => {
                const m = memberById(memberId); if (!m) return null
                return (
                  <div key={memberId} className="flex items-center gap-3">
                    <Avatar initials={m.avatarInitials} color={m.avatarColor} size={28} />
                    <span className="flex-1 text-sm text-text">{m.displayName}</span>
                    <span className="font-mono text-sm text-amber">{amt.toFixed(2)}</span>
                  </div>
                )
              })}
            </div>
          )}

          {splitMode === 'custom' && (
            <div className="glass-card rounded-xl p-4 mb-4 space-y-2">
              <p className="text-xs text-text3 font-semibold mb-1">Entre le montant pour chacun</p>
              {activeMemberIds.map(mid => {
                const m = memberById(mid); if (!m) return null
                return (
                  <div key={mid} className="flex items-center gap-3">
                    <Avatar initials={m.avatarInitials} color={m.avatarColor} size={28} />
                    <span className="flex-1 text-sm text-text">{m.displayName}</span>
                    <input
                      type="text" inputMode="decimal" placeholder="0.00"
                      value={customAmounts[mid] || ''}
                      onChange={e => setCustomAmounts(prev => ({ ...prev, [mid]: e.target.value }))}
                      className="w-24 bg-surface3 border border-border rounded-lg px-2 py-1.5 text-sm text-text text-right outline-none focus:border-accent font-mono"
                    />
                  </div>
                )
              })}
              <p className={`text-xs text-right font-mono pt-1 border-t border-white/5 ${isCustomBalanced && totalAmount > 0 ? 'text-green' : 'text-amber'}`}>
                {customTotal.toFixed(2)} / {totalAmount.toFixed(2)}{isCustomBalanced && totalAmount > 0 ? ' ✓' : ''}
              </p>
            </div>
          )}

          {error && <Notice variant="amber" text={error} />}
        </div>
        <div className="fixed bottom-0 left-0 right-0 px-5 pb-[max(env(safe-area-inset-bottom),16px)] pt-3 glass border-t border-white/5">
          <Button label="Continuer → Qui a payé ?" onClick={goToWhoPaid} />
        </div>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════
  // STEP: who_paid
  // ══════════════════════════════════════════════════════════════════════
  if (step === 'who_paid') {
    const sourceStep: Step = ocrItems.length > 0 ? 'ocr' : 'manual'
    return (
      <div className="min-h-screen bg-bg pb-28">
        <StepHeader title="Qui a payé en caisse ?" onBack={() => setStep(sourceStep)} />
        <div className="px-5 py-4">
          <div className="glass-card rounded-xl p-4 mb-4">
            <p className="text-sm font-semibold text-text">{ocrItems.length > 0 ? 'Ticket scanné' : description}</p>
            <p className="text-2xl font-mono font-light text-accent2 mt-1">{totalAmount.toFixed(2)} CHF</p>
            {ocrItems.length > 0 && <p className="text-xs text-text3 mt-1">{ocrItems.length} article{ocrItems.length > 1 ? 's' : ''}</p>}
          </div>
          <Notice text="Indique qui a physiquement payé et combien. Plusieurs personnes peuvent avoir payé des parts différentes." />

          <div className="flex items-center justify-between mb-3 mt-4">
            <p className="text-xs font-semibold text-text3 uppercase tracking-widest">Payeurs</p>
            {payers.length < members.length && (
              <button onClick={() => setPayers(prev => [...prev, { memberId: '', amount: '' }])}
                className="text-xs font-semibold text-accent2 bg-accent/10 border border-accent/25 px-3 py-1 rounded-full">
                + Ajouter payeur
              </button>
            )}
          </div>

          {payers.map((payer, idx) => {
            const selected = memberById(payer.memberId)
            const otherTotal = resolvedPayments.filter(p => p.memberId !== payer.memberId).reduce((s, p) => s + p.amount, 0)
            const reste = Math.max(0, totalAmount - otherTotal)
            return (
              <div key={idx} className="glass-card rounded-xl p-4 mb-3">
                <p className="text-[10px] uppercase tracking-widest text-text3 font-semibold mb-2">Membre</p>
                <div className="flex flex-wrap mb-3">
                  {availableMembers(idx).concat(selected ? [selected] : [])
                    .filter((m, i, arr) => arr.findIndex((x: any) => x.id === m.id) === i)
                    .map((m: any) => (
                      <Chip key={m.id} label={m.displayName} selected={payer.memberId === m.id}
                        avatar={{ initials: m.avatarInitials, color: m.avatarColor }}
                        onClick={() => setPayerMember(idx, m.id)} />
                    ))}
                </div>
                <p className="text-[10px] uppercase tracking-widest text-text3 font-semibold mb-2">Montant payé</p>
                <div className="flex items-center gap-2">
                  <input type="text" inputMode="decimal" placeholder={totalAmount > 0 ? totalAmount.toFixed(2) : '0.00'}
                    value={payer.amount} onChange={e => setPayers(prev => prev.map((p, i) => i === idx ? { ...p, amount: e.target.value } : p))}
                    className="flex-1 bg-surface2 border border-border rounded-xl px-3 py-3 text-xl font-mono text-text outline-none focus:border-accent"
                  />
                  <span className="text-text3 text-sm">CHF</span>
                  {payers.length > 1 && (
                    <button onClick={() => setPayers(prev => prev.filter((_, i) => i !== idx))}
                      className="text-xs text-text3 bg-surface2 border border-border px-2 py-1 rounded-lg">✕</button>
                  )}
                </div>
                {payers.length > 1 && reste > 0.01 && (
                  <button onClick={() => setPayers(prev => prev.map((p, i) => i === idx ? { ...p, amount: reste.toFixed(2) } : p))}
                    className="mt-2 text-xs text-accent2 bg-accent/10 px-3 py-1.5 rounded-lg">
                    Payer le reste ({reste.toFixed(2)} CHF)
                  </button>
                )}
              </div>
            )
          })}

          <BalanceBar current={payerTotal} target={totalAmount} label="CHF" />
          {error && <Notice variant="amber" text={error} />}
        </div>
        <div className="fixed bottom-0 left-0 right-0 px-5 pb-[max(env(safe-area-inset-bottom),16px)] pt-3 glass border-t border-white/5">
          <Button label="Voir le résumé →" onClick={() => {
            setError('')
            if (resolvedPayments.length === 0) { setError('Sélectionne au moins un payeur.'); return }
            if (!isPayerBalanced) { setError(`Total payeurs (${payerTotal.toFixed(2)}) ≠ total (${totalAmount.toFixed(2)}).`); return }
            setStep('summary')
          }} />
        </div>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════
  // STEP: summary
  // ══════════════════════════════════════════════════════════════════════
  const correctionCount = ocrItems.filter(i => i.corrected).length
  const isPending = createMutation.isPending || updateMutation.isPending

  return (
    <div className="min-h-screen bg-bg pb-36">
      <StepHeader title="Résumé" onBack={() => setStep('who_paid')} />
      <div className="px-5 py-4">
        <Input
          label={ocrItems.length > 0 ? 'Description (optionnel)' : 'Description'}
          placeholder="Ticket La Stanza, dîner, courses…"
          value={description} onChange={setDescription}
        />

        {/* Payé en caisse */}
        <div className="glass-card rounded-xl p-4 mb-3">
          <p className="text-xs text-text3 font-semibold mb-2">💳 Payé en caisse</p>
          {resolvedPayments.map(p => {
            const m = memberById(p.memberId); if (!m) return null
            return (
              <div key={p.memberId} className="flex items-center gap-3 py-2 border-b border-white/5 last:border-0">
                <Avatar initials={m.avatarInitials} color={m.avatarColor} size={28} />
                <span className="flex-1 text-sm text-text">{m.displayName}</span>
                <span className="font-mono text-sm font-semibold text-accent2">{p.amount.toFixed(2)} CHF</span>
              </div>
            )
          })}
        </div>

        {/* OCR : ce que chacun a pris */}
        {ocrItems.length > 0 && (
          <div className="glass-card rounded-xl p-4 mb-3">
            <p className="text-xs text-text3 font-semibold mb-2">🍽 Ce que chacun a pris</p>
            {Object.entries(ocrSplitByMember).map(([mid, amt]) => {
              const m = memberById(mid); if (!m) return null
              return (
                <div key={mid} className="flex items-center gap-3 py-2 border-b border-white/5 last:border-0">
                  <Avatar initials={m.avatarInitials} color={m.avatarColor} size={28} />
                  <span className="flex-1 text-sm text-text">{m.displayName}</span>
                  <span className="font-mono text-sm text-amber">{(amt as number).toFixed(2)} CHF</span>
                </div>
              )
            })}
            {unassignedItems.length > 0 && (
              <p className="text-xs text-amber mt-2">⏳ {unassignedItems.length} article{unassignedItems.length > 1 ? 's' : ''} non assigné{unassignedItems.length > 1 ? 's' : ''} — dépense marquée "à compléter"</p>
            )}
            <div className="flex justify-between border-t border-white/5 mt-2 pt-2">
              <span className="text-xs text-text3">Total scanné</span>
              <span className="font-mono text-sm text-text">{totalAmount.toFixed(2)} CHF</span>
            </div>
          </div>
        )}

        {/* Manuel : répartition */}
        {ocrItems.length === 0 && (
          <div className="glass-card rounded-xl p-4 mb-3">
            <p className="text-xs text-text3 font-semibold mb-2">{splitMode === 'equal' ? '⚖️ Parts égales' : '✏️ Répartition personnalisée'}</p>
            {manualSplits.map(({ memberId, amount: amt }) => {
              const m = memberById(memberId); if (!m) return null
              return (
                <div key={memberId} className="flex items-center gap-3 py-2 border-b border-white/5 last:border-0">
                  <Avatar initials={m.avatarInitials} color={m.avatarColor} size={28} />
                  <span className="flex-1 text-sm text-text">{m.displayName}</span>
                  <span className="font-mono text-sm text-amber">{amt.toFixed(2)} CHF</span>
                </div>
              )
            })}
            <div className="flex justify-between border-t border-white/5 mt-2 pt-2">
              <span className="text-xs text-text3">Total</span>
              <span className="font-mono text-sm text-text">{totalAmount.toFixed(2)} CHF</span>
            </div>
          </div>
        )}

        {ocrImageUrl && (
          <div className="mb-3">
            <button onClick={() => setShowReceipt(v => !v)} className="w-full glass-card rounded-xl py-2.5 text-sm text-accent2 font-medium text-center">
              {showReceipt ? '🙈 Masquer le ticket' : '🧾 Voir le ticket scanné'}
            </button>
            {showReceipt && <img src={ocrImageUrl} alt="Ticket" className="w-full rounded-xl mt-2 object-contain max-h-80" />}
          </div>
        )}

        {correctionCount > 0 && <Notice variant="amber" text={`${correctionCount} correction(s) OCR enregistrée(s). Merci !`} />}
        {error && <Notice variant="amber" text={error} />}
      </div>
      <div className="fixed bottom-0 left-0 right-0 px-5 pb-[max(env(safe-area-inset-bottom),16px)] pt-3 glass border-t border-white/5 space-y-2">
        <Button label={editMode ? '✓ Mettre à jour la dépense' : 'Confirmer la dépense →'} onClick={handleSubmit} loading={isPending} />
        <Button label="← Modifier les payeurs" onClick={() => setStep('who_paid')} variant="ghost" />
      </div>
    </div>
  )
}

export default function AddExpensePage() {
  return <Suspense fallback={<FullScreenSpinner />}><AddExpenseInner /></Suspense>
}
