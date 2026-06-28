'use client'
// src/app/expense/[id]/page.tsx
// Ajouts vs original :
//   - Bouton "Compléter la dépense" si isComplete=false (edit mode → add/page)
//   - Assignation des articles visible item par item avec membres assignés
//   - Note de la dépense si présente
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { expensesApi } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { Avatar, Button, Pill, FullScreenSpinner } from '@/components/ui'
import { formatMoney } from '@/store/langStore'

export default function ExpenseDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)

  const { data: expense, isLoading } = useQuery({
    queryKey: ['expense', id],
    queryFn: () => expensesApi.get(id),
    enabled: !!id,
  })

  const settleMutation = useMutation({
    mutationFn: (memberId: string) => expensesApi.settle(id, memberId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expense', id] }),
  })

  const deleteMutation = useMutation({
    mutationFn: () => expensesApi.delete(id),
    onSuccess: () => router.replace(`/group/${expense?.groupId}`),
  })

  const duplicateMutation = useMutation({
    mutationFn: () => expensesApi.duplicate(id),
    onSuccess: (e: any) => router.replace(`/expense/${e.id}`),
  })

  if (isLoading || !expense) return <FullScreenSpinner />

  const isIncomplete = expense.isComplete === false || (
    (expense.items || []).some((it: any) => !it.assignedTo || it.assignedTo.length === 0)
  )

  return (
    <div className="min-h-screen pb-10">
      {/* Header sticky */}
      <div className="px-5 pt-[max(env(safe-area-inset-top),16px)] pb-4 sticky top-0 z-20 glass border-b border-white/5">
        <div className="flex items-center justify-between">
          <button onClick={() => router.push(`/group/${expense.groupId}`)}
            className="bg-surface2 border border-border/50 px-3 py-1.5 rounded-full text-xs font-medium text-text2">
            ← Groupe
          </button>
          {isIncomplete && <Pill label="⏳ À compléter" variant="amber" />}
        </div>
      </div>

      <div className="px-5 py-5 max-w-sm mx-auto">
        <h1 className="text-2xl font-bold text-text mb-1">{expense.description}</h1>
        <p className="text-xs text-text3 mb-4">
          {new Date(expense.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
          {expense.note && <span className="ml-2 text-text3">· {expense.note}</span>}
        </p>

        {/* Montant */}
        <div className="glass-card rounded-2xl p-5 mb-4">
          <p className="text-[11px] uppercase tracking-widest text-text3 font-semibold mb-1">Montant total</p>
          <p className="text-3xl font-light text-text font-mono">{formatMoney(expense.totalAmount, expense.currency)}</p>
        </div>

        {/* Bannière "À compléter" avec CTA */}
        {isIncomplete && (
          <div className="bg-amber/5 border border-amber/20 rounded-xl p-4 mb-4">
            <p className="text-sm font-semibold text-amber mb-1">⏳ Dépense à compléter</p>
            <p className="text-xs text-text2 mb-3">Certains articles n'ont pas encore été assignés à un membre.</p>
            <button
              onClick={() => router.push(`/expense/add?groupId=${expense.groupId}&expenseId=${expense.id}&edit=true`)}
              className="text-xs font-semibold text-accent2 bg-accent/10 border border-accent/25 px-4 py-2 rounded-full">
              Compléter la dépense →
            </button>
          </div>
        )}

        {/* Payé par */}
        <p className="text-xs font-semibold text-text3 uppercase tracking-widest mb-2">Payé par</p>
        <div className="space-y-2 mb-5">
          {(expense.payments || []).map((p: any) => (
            <div key={p.id} className="flex items-center gap-3 glass-card rounded-xl p-3">
              <Avatar initials={p.member?.avatarInitials || '?'} color={p.member?.avatarColor || '#666'} size={32} />
              <span className="flex-1 text-sm text-text">{p.member?.displayName}</span>
              <span className="font-mono text-sm font-semibold text-text">{formatMoney(p.amount, expense.currency)}</span>
            </div>
          ))}
        </div>

        {/* Répartition */}
        <p className="text-xs font-semibold text-text3 uppercase tracking-widest mb-2">Répartition</p>
        <div className="space-y-2 mb-5">
          {(expense.splits || []).map((s: any) => (
            <div key={s.id} className="flex items-center gap-3 glass-card rounded-xl p-3">
              <Avatar initials={s.member?.avatarInitials || '?'} color={s.member?.avatarColor || '#666'} size={32} />
              <span className="flex-1 text-sm text-text">{s.member?.displayName}</span>
              <span className="font-mono text-sm font-semibold text-text mr-2">{formatMoney(s.amount, expense.currency)}</span>
              {s.settled ? (
                <Pill label="✓ Réglé" variant="green" />
              ) : (
                <button
                  onClick={() => settleMutation.mutate(s.memberId)}
                  disabled={settleMutation.isPending}
                  className="text-xs font-semibold text-accent2 bg-accent/10 border border-accent/25 px-2.5 py-1 rounded-full">
                  Marquer réglé
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Articles OCR avec assignation */}
        {expense.items && expense.items.length > 0 && (
          <>
            <p className="text-xs font-semibold text-text3 uppercase tracking-widest mb-2">Articles scannés</p>
            <div className="space-y-2 mb-5">
              {expense.items.map((it: any) => {
                const assigned: any[] = it.assignedTo || []
                return (
                  <div key={it.id} className="glass-card rounded-xl p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-text">{it.name}</span>
                      <span className="font-mono text-sm text-text">{formatMoney(it.price, expense.currency)}</span>
                    </div>
                    {assigned.length > 0 ? (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {assigned.map((a: any) => (
                          <span key={a.memberId || a.id} className="text-[10px] bg-accent/10 text-accent2 border border-accent/20 px-2 py-0.5 rounded-full">
                            {a.member?.displayName || a.displayName || '?'}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[11px] text-amber mt-1.5">⚠ Non assigné</p>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}

        {/* Actions */}
        <div className="space-y-2.5">
          {isIncomplete && (
            <Button
              label="✏️ Compléter la dépense"
              onClick={() => router.push(`/expense/add?groupId=${expense.groupId}&expenseId=${expense.id}&edit=true`)}
            />
          )}
          <Button label="Dupliquer cette dépense" variant="ghost" onClick={() => duplicateMutation.mutate()} loading={duplicateMutation.isPending} />
          <Button label="Supprimer" variant="danger"
            onClick={() => { if (confirm('Supprimer cette dépense ?')) deleteMutation.mutate() }}
            loading={deleteMutation.isPending} />
        </div>
      </div>
    </div>
  )
}
