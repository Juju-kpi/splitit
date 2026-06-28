'use client'
// src/app/expense/[id]/page.tsx
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

  return (
    <div className="min-h-screen px-5 py-6 max-w-sm mx-auto pb-10">
      <button onClick={() => router.push(`/group/${expense.groupId}`)} className="bg-surface2 border border-border/50 px-3 py-1.5 rounded-full text-xs font-medium text-text2 mb-6">
        ← Groupe
      </button>

      <h1 className="text-2xl font-bold text-text mb-1">{expense.description}</h1>
      <p className="text-xs text-text3 mb-5">{new Date(expense.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</p>

      <div className="glass-card rounded-2xl p-5 mb-5">
        <p className="text-[11px] uppercase tracking-widest text-text3 font-semibold mb-1">Montant total</p>
        <p className="text-3xl font-light text-text font-mono">{formatMoney(expense.totalAmount, expense.currency)}</p>
      </div>

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

      <p className="text-xs font-semibold text-text3 uppercase tracking-widest mb-2">Répartition</p>
      <div className="space-y-2 mb-6">
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
                className="text-xs font-semibold text-accent2 bg-accent/10 border border-accent/25 px-2.5 py-1 rounded-full"
              >
                Marquer réglé
              </button>
            )}
          </div>
        ))}
      </div>

      {expense.items && expense.items.length > 0 && (
        <>
          <p className="text-xs font-semibold text-text3 uppercase tracking-widest mb-2">Articles</p>
          <div className="space-y-1.5 mb-6">
            {expense.items.map((it: any) => (
              <div key={it.id} className="flex items-center justify-between text-sm py-1.5 border-b border-white/5">
                <span className="text-text2">{it.name}</span>
                <span className="font-mono text-text">{formatMoney(it.price, expense.currency)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="space-y-2.5">
        <Button label="Dupliquer cette dépense" variant="ghost" onClick={() => duplicateMutation.mutate()} loading={duplicateMutation.isPending} />
        <Button label="Supprimer" variant="danger" onClick={() => { if (confirm('Supprimer cette dépense ?')) deleteMutation.mutate() }} loading={deleteMutation.isPending} />
      </div>
    </div>
  )
}
