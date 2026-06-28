'use client'
// src/app/(tabs)/settings/page.tsx
// Port complet de app/app/(tabs)/settings.tsx :
//   - Profil avec couleur avatar (picker)
//   - Langue (FR/EN/DE/ES/IT)
//   - Devise (CHF/EUR/USD/GBP)
//   - Notifications web push (via Web Push API / VAPID)
//     → Safari iOS 16.4+ PWA supporté ; texte explicatif si non supporté
//   - OCR stats
//   - Export, suppression compte, déconnexion

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/store/authStore'
import { userApi, authApi, ocrApi } from '@/lib/api'
import { Avatar, GlassCard, SectionLabel, Button, Input, Notice } from '@/components/ui'
import { useLangStore } from '@/store/langStore'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'

const AVATAR_COLORS = ['#4F46E5','#7C3AED','#DB2777','#DC2626','#EA580C','#CA8A04','#16A34A','#0891B2','#2563EB','#475569']

const LANGUAGES = [
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'it', label: 'Italiano', flag: '🇮🇹' },
]

const CURRENCIES = [
  { code: 'CHF', label: 'CHF — Franc suisse', symbol: 'Fr.' },
  { code: 'EUR', label: 'EUR — Euro', symbol: '€' },
  { code: 'USD', label: 'USD — Dollar US', symbol: '$' },
  { code: 'GBP', label: 'GBP — Livre sterling', symbol: '£' },
]

// ── Web Push helpers ──────────────────────────────────────────────────────────
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}

async function getWebPushSubscription(): Promise<string | null> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null
    const reg = await navigator.serviceWorker.ready
    const existing = await reg.pushManager.getSubscription()
    if (existing) return JSON.stringify(existing)

    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    if (!vapidKey) return null
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    })
    return JSON.stringify(sub)
  } catch { return null }
}

function isWebPushSupported(): boolean {
  if (typeof window === 'undefined') return false
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

// ── Toggle switch ─────────────────────────────────────────────────────────────
function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative w-12 h-6 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-surface3'} ${disabled ? 'opacity-40' : ''}`}
      aria-checked={checked} role="switch"
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : ''}`} />
    </button>
  )
}

// ── Setting row ───────────────────────────────────────────────────────────────
function SettingRow({ icon, label, value, onClick, destructive, right }: {
  icon: string; label: string; value?: string; onClick?: () => void; destructive?: boolean; right?: React.ReactNode
}) {
  return (
    <div onClick={onClick} className={`flex items-center gap-3 px-4 py-3.5 min-h-[52px] ${onClick ? 'cursor-pointer hover:bg-surface3/40 transition-colors' : ''}`}>
      <div className={`w-8 h-8 rounded-[9px] flex items-center justify-center text-base shrink-0 ${destructive ? 'bg-red/10' : 'bg-surface3'}`}>
        {icon}
      </div>
      <span className={`flex-1 text-sm font-medium ${destructive ? 'text-red' : 'text-text'}`}>{label}</span>
      {value && <span className="text-xs text-text3">{value}</span>}
      {right}
      {onClick && !right && <span className={`text-lg font-light ${destructive ? 'text-red' : 'text-text3'}`}>›</span>}
    </div>
  )
}

function RowSep() { return <div className="h-px bg-white/5 ml-[68px]" /> }

// ── Modal ─────────────────────────────────────────────────────────────────────
function Modal({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!visible) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-surface border border-border rounded-t-3xl sm:rounded-3xl p-6 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-bold text-text">{title}</h2>
          <button onClick={onClose} className="bg-surface2 border border-border px-3 py-1.5 rounded-full text-xs text-text2">Fermer</button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const router = useRouter()
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const setUser = useAuthStore(s => s.setUser)
  const logout = useAuthStore(s => s.logout)

  // Modals
  const [colorModal, setColorModal] = useState(false)
  const [langModal, setLangModal] = useState(false)
  const [currencyModal, setCurrencyModal] = useState(false)
  const [deleteModal, setDeleteModal] = useState(false)

  // Color picker
  const [selectedColor, setSelectedColor] = useState(user?.avatarColor || AVATAR_COLORS[0])

  // Langue & devise
  const [selectedLang, setSelectedLang] = useState((user as any)?.preferredLanguage ?? 'fr')
  const [selectedCurrency, setSelectedCurrency] = useState((user as any)?.preferredCurrency ?? 'CHF')

  // Notifications
  const [notifExpense, setNotifExpense] = useState(user?.notifExpense ?? false)
  const [notifReminder, setNotifReminder] = useState(user?.notifReminder ?? false)
  const [notifLoading, setNotifLoading] = useState(false)
  const [notifSupported, setNotifSupported] = useState(false)
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | null>(null)
  const [swReady, setSwReady] = useState(false)

  // Delete
  const [deleteStep, setDeleteStep] = useState<'confirm' | 'password'>('confirm')
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteError, setDeleteError] = useState('')

  // Export
  const [exportSent, setExportSent] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)

  // OCR stats
  const { data: ocrStats } = useQuery({ queryKey: ['ocrStats'], queryFn: ocrApi.getStats, refetchInterval: 60_000 })
  const accuracy = ocrStats?.accuracyEstimate || 72
  const total = ocrStats?.totalCorrections || 0
  const untrained = ocrStats?.untrainedCount || 0

  // ── Web Push init ────────────────────────────────────────────────────
  useEffect(() => {
    const supported = isWebPushSupported()
    setNotifSupported(supported)
    if (!supported) return

    setNotifPermission(Notification.permission)

    navigator.serviceWorker.ready.then(() => setSwReady(true)).catch(() => {})
  }, [])

  useEffect(() => {
    if (user?.notifExpense !== undefined) setNotifExpense(user.notifExpense)
    if (user?.notifReminder !== undefined) setNotifReminder(user.notifReminder)
    if ((user as any)?.preferredLanguage) setSelectedLang((user as any).preferredLanguage)
    if ((user as any)?.preferredCurrency) setSelectedCurrency((user as any).preferredCurrency)
    setSelectedColor(user?.avatarColor || AVATAR_COLORS[0])
  }, [user?.id])

  // ── Notification toggle ──────────────────────────────────────────────
  const handleNotifToggle = useCallback(async (type: 'expense' | 'reminder', value: boolean) => {
    if (!notifSupported) return
    setNotifLoading(true)
    try {
      let token: string | null = null

      if (value) {
        // Demande permission si nécessaire
        if (Notification.permission !== 'granted') {
          const perm = await Notification.requestPermission()
          setNotifPermission(perm)
          if (perm !== 'granted') {
            alert('Active les notifications dans les réglages de ton navigateur.')
            setNotifLoading(false); return
          }
        }
        token = await getWebPushSubscription()
        if (!token) {
          alert('Impossible d\'obtenir le token de notification.')
          setNotifLoading(false); return
        }
      }

      const updated = await userApi.updateNotificationPrefs({
        pushToken: token,
        notifExpense: type === 'expense' ? value : notifExpense,
        notifReminder: type === 'reminder' ? value : notifReminder,
      })
      setUser(updated)
      if (type === 'expense') setNotifExpense(value)
      else setNotifReminder(value)
    } catch (e: any) {
      console.error('[Notif]', e)
    } finally {
      setNotifLoading(false)
    }
  }, [notifSupported, notifExpense, notifReminder])

  // ── Mutations ────────────────────────────────────────────────────────
  const colorMutation = useMutation({
    mutationFn: (color: string) => userApi.updateProfile({ avatarColor: color }),
    onSuccess: (data) => { setUser(data); setColorModal(false) },
  })

  const langMutation = useMutation({
    mutationFn: (lang: string) => userApi.updatePreferences({ preferredLanguage: lang }),
    onSuccess: (_, lang) => { useLangStore.getState().setLocale(lang); setUser({ ...(user as any), preferredLanguage: lang }); setLangModal(false) },
  })

  const currencyMutation = useMutation({
    mutationFn: (currency: string) => userApi.updatePreferences({ preferredCurrency: currency }),
    onSuccess: (_, currency) => { useLangStore.getState().setCurrency(currency); setUser({ ...(user as any), preferredCurrency: currency }); setCurrencyModal(false) },
  })

  const deleteMutation = useMutation({
    mutationFn: (password: string) => authApi.deleteAccount(password),
    onSuccess: async () => { setDeleteModal(false); await logout(); router.replace('/auth/login') },
    onError: (e: any) => setDeleteError(e?.response?.data?.error || 'Mot de passe incorrect.'),
  })

  const currentLang = LANGUAGES.find(l => l.code === selectedLang) ?? LANGUAGES[0]
  const currentCurrency = CURRENCIES.find(c => c.code === selectedCurrency) ?? CURRENCIES[0]

  return (
    <div className="min-h-screen bg-bg">
      {/* Header */}
      <div className="px-5 pt-[max(env(safe-area-inset-top),20px)] pb-4 sticky top-0 z-20 glass border-b border-white/5">
        <h1 className="text-2xl font-extrabold tracking-tight text-text">Réglages</h1>
        <p className="text-sm text-text3 mt-0.5">Compte et préférences</p>
      </div>

      <div className="px-5 pb-28">
        {/* Profil */}
        <div className="glass-card rounded-2xl p-5 mt-4 mb-3 relative overflow-hidden">
          <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-accent/10 blur-2xl pointer-events-none" />
          <div className="flex items-center gap-4">
            <button onClick={() => setColorModal(true)} className="relative">
              <Avatar initials={(user?.username ?? '??').slice(0, 2).toUpperCase()} color={user?.avatarColor || '#7C6EFA'} size={60} ring />
              <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-surface border border-border flex items-center justify-center text-xs">✏️</div>
            </button>
            <div>
              <p className="text-base font-bold text-text">{user?.username}</p>
              <p className="text-xs text-text3 mt-0.5">{user?.email}</p>
              <span className="inline-block mt-2 text-[10px] font-bold text-accent2 bg-accent/10 border border-accent/20 px-2.5 py-1 rounded-full">✦ Membre actif</span>
            </div>
          </div>
        </div>

        {/* OCR stats */}
        <SectionLabel label="Entraînement OCR" />
        <div className="glass-card rounded-2xl p-4 mb-1">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-bold text-text">🧠 Modèle · v1.4</span>
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${accuracy >= 80 ? 'bg-green/10 text-green' : 'bg-amber/10 text-amber'}`}>
              {accuracy.toFixed(0)}% précis
            </span>
          </div>
          <div className="grid grid-cols-3 divide-x divide-white/5 mb-3">
            {[
              { num: total, label: 'Corrections', color: 'text-accent2' },
              { num: `${accuracy.toFixed(0)}%`, label: 'Précision', color: 'text-green' },
              { num: untrained, label: 'En attente', color: untrained > 0 ? 'text-amber' : 'text-text3' },
            ].map(s => (
              <div key={s.label} className="flex flex-col items-center py-1">
                <span className={`text-2xl font-light font-mono ${s.color}`}>{s.num}</span>
                <span className="text-[10px] text-text3 uppercase tracking-wider mt-1">{s.label}</span>
              </div>
            ))}
          </div>
          <div className="h-1 bg-surface3 rounded-full overflow-hidden mb-1.5">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.min(accuracy, 100)}%` }} />
          </div>
          <p className="text-[11px] text-text3">{untrained > 0 ? `${untrained} corrections avant le prochain affinement` : '✓ Modèle à jour'}</p>
        </div>
        <Notice text="Chaque correction améliore l'OCR pour tout le monde. Les données sont anonymisées." variant="accent" />

        {/* Mon compte */}
        <SectionLabel label="Mon compte" />
        <div className="glass-card rounded-2xl overflow-hidden p-0 mb-3">
          <SettingRow icon="📅" label="Membre depuis" value={user?.createdAt ? format(new Date(user.createdAt), 'MMM yyyy', { locale: fr }) : '—'} />
          <RowSep />
          <SettingRow icon="🎨" label="Couleur de profil" onClick={() => setColorModal(true)}
            right={<div className="w-6 h-6 rounded-full border-2 border-border" style={{ backgroundColor: user?.avatarColor || '#7C6EFA' }} />}
          />
        </div>

        {/* Langue & Devise */}
        <SectionLabel label="Langue & Devise" />
        <div className="glass-card rounded-2xl overflow-hidden p-0 mb-1">
          <SettingRow icon="🌍" label="Langue" value={`${currentLang.flag} ${currentLang.label}`} onClick={() => setLangModal(true)} />
          <RowSep />
          <SettingRow icon="💱" label="Devise" value={`${currentCurrency.symbol} ${currentCurrency.code}`} onClick={() => setCurrencyModal(true)} />
        </div>
        <Notice text="La devise est utilisée pour l'affichage uniquement. Pas de conversion de taux." variant="amber" />

        {/* Notifications */}
        <SectionLabel label="Notifications" />
        {!notifSupported ? (
          <Notice variant="amber" text="Les notifications push ne sont pas disponibles dans ce navigateur. Sur iPhone, installe l'app sur l'écran d'accueil (Safari → Partager → Sur l'écran d'accueil) et réessaie." />
        ) : (
          <>
            {notifPermission === 'granted' && <Notice text="Les notifications push sont activées." variant="accent" />}
            {notifPermission === 'denied' && <Notice variant="amber" text="Notifications bloquées. Autorise-les dans les réglages de ton navigateur." />}
          </>
        )}
        <div className={`glass-card rounded-2xl overflow-hidden p-0 mb-3 ${!notifSupported ? 'opacity-50' : ''}`}>
          <SettingRow icon="🔔" label="Nouvelle dépense dans un groupe"
            right={<Toggle checked={notifExpense} onChange={v => handleNotifToggle('expense', v)} disabled={notifLoading || !notifSupported || !swReady} />}
          />
          <RowSep />
          <SettingRow icon="⏰" label="Rappel dépenses à compléter"
            right={<Toggle checked={notifReminder} onChange={v => handleNotifToggle('reminder', v)} disabled={notifLoading || !notifSupported || !swReady} />}
          />
        </div>

        {/* Confidentialité */}
        <SectionLabel label="Confidentialité & données" />
        <div className="glass-card rounded-2xl overflow-hidden p-0 mb-3">
          <SettingRow icon="📦" label="Exporter mes données" onClick={async () => {
            setExportLoading(true)
            try { await userApi.requestDataExport(); setExportSent(true) } catch {} finally { setExportLoading(false) }
          }} value={exportSent ? '✓ Email envoyé' : undefined} />
          <RowSep />
          <SettingRow icon="🔒" label="Politique de confidentialité" onClick={() => window.open('https://juju-kpi.github.io/splitit/privacy-policy.md', '_blank')} />
        </div>

        {/* À propos */}
        <SectionLabel label="À propos" />
        <div className="glass-card rounded-2xl overflow-hidden p-0 mb-3">
          <SettingRow icon="🌐" label="Version web" value="1.2.1" />
          <RowSep />
          <SettingRow icon="💬" label="Envoyer un feedback" onClick={() => window.open('mailto:ares88775@gmail.com?subject=Feedback SplitIt', '_blank')} />
        </div>

        {/* Danger */}
        <SectionLabel label="Zone de danger" />
        <div className="glass-card rounded-2xl overflow-hidden p-0">
          <SettingRow icon="👋" label="Se déconnecter" onClick={async () => { if (confirm('Te déconnecter ?')) { await logout(); router.replace('/auth/login') } }} />
          <RowSep />
          <SettingRow icon="🗑" label="Supprimer mon compte" destructive onClick={() => { setDeleteModal(true); setDeleteStep('confirm'); setDeleteConfirm(''); setDeletePassword(''); setDeleteError('') }} />
        </div>

        <p className="text-center text-[11px] text-text3 mt-8 mb-4">SplitIt Web · Fait avec ❤️</p>
      </div>

      {/* ── Color picker modal ── */}
      <Modal visible={colorModal} onClose={() => setColorModal(false)} title="Couleur de profil">
        <p className="text-sm text-text3 mb-4">Choisis une couleur pour ton avatar</p>
        <div className="grid grid-cols-5 gap-3 mb-6">
          {AVATAR_COLORS.map(color => (
            <button key={color} onClick={() => setSelectedColor(color)}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${selectedColor === color ? 'ring-2 ring-offset-2 ring-offset-surface ring-white scale-110' : ''}`}
              style={{ backgroundColor: color }}>
              {selectedColor === color && <span className="text-white font-bold text-lg">✓</span>}
            </button>
          ))}
        </div>
        <div className="flex justify-center mb-6">
          <Avatar initials={(user?.username ?? '??').slice(0, 2).toUpperCase()} color={selectedColor} size={72} ring />
        </div>
        <Button label="Sauvegarder" onClick={() => colorMutation.mutate(selectedColor)} loading={colorMutation.isPending} />
      </Modal>

      {/* ── Langue modal ── */}
      <Modal visible={langModal} onClose={() => setLangModal(false)} title="🌍 Langue">
        <div className="space-y-1 mb-6">
          {LANGUAGES.map(lang => (
            <button key={lang.code} onClick={() => setSelectedLang(lang.code)}
              className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-colors ${selectedLang === lang.code ? 'bg-accent/10 border border-accent/25' : 'hover:bg-surface2'}`}>
              <span className="text-2xl">{lang.flag}</span>
              <span className={`flex-1 text-sm text-left ${selectedLang === lang.code ? 'text-accent2 font-bold' : 'text-text'}`}>{lang.label}</span>
              {selectedLang === lang.code && <span className="text-accent2 font-bold">✓</span>}
            </button>
          ))}
        </div>
        <Button label="Appliquer" onClick={() => langMutation.mutate(selectedLang)} loading={langMutation.isPending} />
      </Modal>

      {/* ── Devise modal ── */}
      <Modal visible={currencyModal} onClose={() => setCurrencyModal(false)} title="💱 Devise">
        <Notice text="Affichage uniquement — aucune conversion de taux appliquée." variant="amber" />
        <div className="space-y-1 my-4">
          {CURRENCIES.map(currency => (
            <button key={currency.code} onClick={() => setSelectedCurrency(currency.code)}
              className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-colors ${selectedCurrency === currency.code ? 'bg-accent/10 border border-accent/25' : 'hover:bg-surface2'}`}>
              <span className="w-8 text-center font-semibold text-text">{currency.symbol}</span>
              <span className={`flex-1 text-sm text-left ${selectedCurrency === currency.code ? 'text-accent2 font-bold' : 'text-text'}`}>{currency.label}</span>
              {selectedCurrency === currency.code && <span className="text-accent2 font-bold">✓</span>}
            </button>
          ))}
        </div>
        <Button label="Appliquer" onClick={() => currencyMutation.mutate(selectedCurrency)} loading={currencyMutation.isPending} />
      </Modal>

      {/* ── Delete modal ── */}
      <Modal visible={deleteModal} onClose={() => setDeleteModal(false)} title="Supprimer mon compte">
        {deleteStep === 'confirm' ? (
          <>
            <div className="bg-red/5 border border-red/20 rounded-xl p-4 mb-5">
              <p className="text-sm font-bold text-red mb-2">⚠️ Action irréversible</p>
              <p className="text-sm text-text2 leading-relaxed">
                • Suppression définitive de ton profil{'\n'}
                • Déconnexion de tous tes groupes{'\n'}
                • Toutes tes sessions seront invalidées
              </p>
            </div>
            <p className="text-sm text-text2 mb-2">Tape <span className="text-red font-bold">supprimer</span> pour confirmer</p>
            <Input label="" placeholder="supprimer" value={deleteConfirm} onChange={setDeleteConfirm} />
            <Button label="Continuer →" variant="danger"
              onClick={() => { if (deleteConfirm.toLowerCase() === 'supprimer') setDeleteStep('password') }}
              disabled={deleteConfirm.toLowerCase() !== 'supprimer'} />
          </>
        ) : (
          <>
            <p className="text-sm text-text2 mb-3">Entre ton mot de passe pour finaliser.</p>
            <Input label="Mot de passe" type="password" value={deletePassword} onChange={setDeletePassword} />
            {deleteError && <p className="text-red text-xs mb-2">{deleteError}</p>}
            <Button label={deleteMutation.isPending ? 'Suppression…' : 'Supprimer définitivement'} variant="danger"
              onClick={() => deleteMutation.mutate(deletePassword)} loading={deleteMutation.isPending} />
            <button onClick={() => setDeleteStep('confirm')} className="w-full text-xs text-text3 mt-3 py-2">← Retour</button>
          </>
        )}
      </Modal>
    </div>
  )
}
