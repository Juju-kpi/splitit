'use client'
// src/app/(tabs)/settings/page.tsx
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/authStore'
import { userApi, authApi } from '@/lib/api'
import { ScreenHeader, Avatar, GlassCard, SectionLabel, Button, Input, Notice } from '@/components/ui'

const CURRENCIES = ['EUR', 'CHF', 'USD', 'GBP']

export default function SettingsPage() {
  const router = useRouter()
  const user = useAuthStore(s => s.user)
  const setUser = useAuthStore(s => s.setUser)
  const logout = useAuthStore(s => s.logout)

  const [notifExpense, setNotifExpense] = useState(user?.notifExpense ?? true)
  const [notifReminder, setNotifReminder] = useState(user?.notifReminder ?? true)
  const [currency, setCurrency] = useState(user?.preferredCurrency || 'EUR')
  const [savingPrefs, setSavingPrefs] = useState(false)
  const [deletePwd, setDeletePwd] = useState('')
  const [showDelete, setShowDelete] = useState(false)
  const [error, setError] = useState('')
  const [exportSent, setExportSent] = useState(false)

  async function savePrefs() {
    setSavingPrefs(true)
    try {
      const updated = await userApi.updatePreferences({ preferredCurrency: currency })
      setUser(updated)
    } finally { setSavingPrefs(false) }
  }

  async function saveNotifs(next: { notifExpense?: boolean; notifReminder?: boolean }) {
    try {
      const updated = await userApi.updateNotificationPrefs({
        pushToken: null,
        notifExpense: next.notifExpense ?? notifExpense,
        notifReminder: next.notifReminder ?? notifReminder,
      })
      setUser(updated)
    } catch {}
  }

  async function handleExport() {
    try { await userApi.requestDataExport(); setExportSent(true) } catch {}
  }

  async function handleDeleteAccount() {
    setError('')
    try {
      await authApi.deleteAccount(deletePwd)
      await logout()
      router.replace('/auth/login')
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Mot de passe incorrect.')
    }
  }

  return (
    <div>
      <ScreenHeader title="Réglages" />
      <div className="px-5 pb-10">
        <GlassCard className="flex items-center gap-3">
          <Avatar initials={(user?.username || '?').slice(0, 2).toUpperCase()} color={user?.avatarColor || '#7C6EFA'} size={48} />
          <div>
            <p className="text-base font-semibold text-text">{user?.username}</p>
            <p className="text-xs text-text3">{user?.email}</p>
          </div>
        </GlassCard>

        <SectionLabel label="Préférences" />
        <GlassCard>
          <p className="text-xs font-semibold text-text3 uppercase tracking-widest mb-2">Devise</p>
          <div className="flex gap-2 mb-1">
            {CURRENCIES.map(c => (
              <button key={c} onClick={() => setCurrency(c)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${currency === c ? 'border-accent bg-accent/10 text-accent2' : 'border-border bg-surface2 text-text2'}`}>
                {c}
              </button>
            ))}
          </div>
        </GlassCard>
        <Button label="Enregistrer les préférences" variant="ghost" onClick={savePrefs} loading={savingPrefs} className="mb-5" />

        <SectionLabel label="Notifications" />
        <GlassCard>
          <label className="flex items-center justify-between py-2">
            <span className="text-sm text-text2">Nouvelle dépense ajoutée</span>
            <input type="checkbox" checked={notifExpense} onChange={e => { setNotifExpense(e.target.checked); saveNotifs({ notifExpense: e.target.checked }) }} className="w-5 h-5 accent-[#7C6EFA]" />
          </label>
          <label className="flex items-center justify-between py-2">
            <span className="text-sm text-text2">Rappels de remboursement</span>
            <input type="checkbox" checked={notifReminder} onChange={e => { setNotifReminder(e.target.checked); saveNotifs({ notifReminder: e.target.checked }) }} className="w-5 h-5 accent-[#7C6EFA]" />
          </label>
        </GlassCard>
        <p className="text-xs text-text3 mt-2 mb-5 leading-relaxed">
          Les notifications push ne sont pas disponibles dans la version web. Active-les depuis l'app mobile pour être notifié en temps réel.
        </p>

        <SectionLabel label="Données" />
        {exportSent ? (
          <Notice variant="green" text="Export demandé. Tu recevras un email avec tes données." />
        ) : (
          <Button label="Exporter mes données" variant="ghost" onClick={handleExport} className="mb-5" />
        )}

        <SectionLabel label="Compte" />
        <Button label="Se déconnecter" variant="ghost" onClick={async () => { await logout(); router.replace('/auth/login') }} className="mb-2.5" />
        {!showDelete ? (
          <Button label="Supprimer mon compte" variant="danger" onClick={() => setShowDelete(true)} />
        ) : (
          <GlassCard>
            <p className="text-sm text-text2 mb-3">Confirme ton mot de passe pour supprimer définitivement ton compte.</p>
            <Input label="Mot de passe" type="password" value={deletePwd} onChange={setDeletePwd} />
            {error && <p className="text-red text-[13px] mb-2">{error}</p>}
            <Button label="Confirmer la suppression" variant="danger" onClick={handleDeleteAccount} />
          </GlassCard>
        )}
      </div>
    </div>
  )
}
