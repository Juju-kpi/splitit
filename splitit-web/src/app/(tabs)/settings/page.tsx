'use client'
// src/app/(tabs)/settings/page.tsx
// Port complet de app/app/(tabs)/settings.tsx mobile
// Ajouts vs version précédente :
//   - Section À propos : Version web + Conditions d'utilisation + Feedback (comme mobile)
//   - Section Confidentialité : ajout Conditions d'utilisation
//   - Notifications : badge "push activées" aligné sur mobile

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/store/authStore'
import { userApi, authApi, ocrApi } from '@/lib/api'
import { Avatar, GlassCard, SectionLabel, Button, Input, Notice } from '@/components/ui'
import type { LucideIcon } from 'lucide-react'
import {
  Calendar, Droplet, Globe, Repeat, Bell, Clock, Download, Lock,
  FileText, Monitor, Star, MessageCircle, LogOut, Trash2,
} from 'lucide-react'
import { useLangStore, useT } from '@/store/langStore'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'

const APP_VERSION = '1.2.1'
const PRIVACY_URL = 'https://juju-kpi.github.io/splitit/privacy-policy.md'

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
  const buffer = new ArrayBuffer(rawData.length)
  const outputArray = new Uint8Array(buffer)
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}

async function getWebPushSubscription(): Promise<string | null> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null
    const reg = await navigator.serviceWorker.ready
    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    if (!vapidKey) return null

    // On ne réutilise jamais aveuglément un abonnement existant : le push
    // service (FCM) peut l'avoir révoqué côté serveur (410 Gone) sans que le
    // navigateur le sache localement. On désabonne d'abord pour forcer un
    // abonnement frais, garanti valide, à chaque activation du toggle.
    const existing = await reg.pushManager.getSubscription()
    if (existing) {
      try { await existing.unsubscribe() } catch {}
    }

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey) as unknown as Uint8Array<ArrayBuffer>,
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
      className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${checked ? 'bg-primary' : 'bg-surface3'} ${disabled ? 'opacity-40' : ''}`}
      aria-checked={checked} role="switch"
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : ''}`} />
    </button>
  )
}

// ── Setting row ───────────────────────────────────────────────────────────────
function SettingRow({ icon: Icon, label, value, onClick, destructive, right }: {
  icon: LucideIcon; label: string; value?: string; onClick?: () => void; destructive?: boolean; right?: React.ReactNode
}) {
  return (
    <div onClick={onClick} className={`flex items-center gap-3 px-4 py-3.5 min-h-[52px] ${onClick ? 'cursor-pointer hover:bg-surface2 transition-colors' : ''}`}>
      <div className={`w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0 ${destructive ? 'bg-red/10 text-red' : 'bg-surface2 text-text2'}`}>
        <Icon size={17} strokeWidth={1.75} />
      </div>
      <span className={`flex-1 text-sm font-medium ${destructive ? 'text-red' : 'text-text'}`}>{label}</span>
      {value && <span className="text-xs text-text3">{value}</span>}
      {right}
      {onClick && !right && <span className={`text-lg font-light ${destructive ? 'text-red' : 'text-text3'}`}>›</span>}
    </div>
  )
}

function RowSep() { return <div className="h-px bg-white/[0.06] ml-[68px]" /> }

// ── Modal ─────────────────────────────────────────────────────────────────────
function Modal({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const t = useT()
  if (!visible) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-surface border border-border rounded-t-3xl sm:rounded-3xl p-6 pb-[max(env(safe-area-inset-bottom),24px)] max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-bold text-text">{title}</h2>
          <button onClick={onClose} className="bg-surface2 border border-border px-3 py-1.5 rounded-full text-xs text-text2">{t('common.close')}</button>
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
  const t = useT()
  const deleteKeyword = t('settings.delete_keyword').toLowerCase()

  const [colorModal, setColorModal] = useState(false)
  const [langModal, setLangModal] = useState(false)
  const [currencyModal, setCurrencyModal] = useState(false)
  const [deleteModal, setDeleteModal] = useState(false)

  const [selectedColor, setSelectedColor] = useState(user?.avatarColor || AVATAR_COLORS[0])
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

  useEffect(() => {
    const supported = isWebPushSupported()
    setNotifSupported(supported)
    if (!supported) return
    setNotifPermission(Notification.permission)
    navigator.serviceWorker.ready.then(async (reg) => {
      setSwReady(true)
      // notifExpense/notifReminder sont des colonnes partagées avec le mobile :
      // elles peuvent être à `true` alors qu'aucun abonnement push navigateur
      // n'existe encore sur CET appareil/navigateur (ex: notifs activées sur
      // mobile uniquement). On reflète donc l'état RÉEL de l'abonnement web
      // dans les toggles, pas le simple booléen serveur.
      try {
        const existing = await reg.pushManager.getSubscription()
        if (!existing) {
          setNotifExpense(false)
          setNotifReminder(false)
        }
      } catch {}
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (user?.notifExpense !== undefined) setNotifExpense(user.notifExpense)
    if (user?.notifReminder !== undefined) setNotifReminder(user.notifReminder)
    if ((user as any)?.preferredLanguage) setSelectedLang((user as any).preferredLanguage)
    if ((user as any)?.preferredCurrency) setSelectedCurrency((user as any).preferredCurrency)
    setSelectedColor(user?.avatarColor || AVATAR_COLORS[0])
  }, [user?.id])

  const handleNotifToggle = useCallback(async (type: 'expense' | 'reminder', value: boolean) => {
    if (!notifSupported) return
    setNotifLoading(true)
    try {
      // État final des deux toggles APRÈS ce changement (avant: bug où on se
      // basait sur le seul toggle cliqué, ignorant l'état de l'autre).
      const nextExpense = type === 'expense' ? value : notifExpense
      const nextReminder = type === 'reminder' ? value : notifReminder
      const anyEnabled = nextExpense || nextReminder

      let token: string | null = null

      // Sans support navigateur (Safari iOS hors PWA installee, par exemple),
      // on enregistre quand meme la preference : elle pilote aussi les
      // notifications recues sur l'application mobile.
      if (!notifSupported) {
        const updatedPref = await userApi.updateNotificationPrefs({
          webPushToken: user?.webPushToken ?? null,
          notifExpense: type === 'expense' ? value : notifExpense,
          notifReminder: type === 'reminder' ? value : notifReminder,
        })
        setUser(updatedPref)
        if (type === 'expense') setNotifExpense(value)
        else setNotifReminder(value)
        setNotifLoading(false)
        return
      }

      if (anyEnabled) {
        if (Notification.permission !== 'granted') {
          const perm = await Notification.requestPermission()
          setNotifPermission(perm)
          if (perm !== 'granted') {
            alert(t('settings.perm_denied_msg_web'))
            setNotifLoading(false); return
          }
        }
        // On ne touche au token que si on est en train d'ACTIVER un toggle
        // (sinon, si on désactive un toggle alors que l'autre reste actif,
        // on garde l'abonnement existant tel quel, sans le recréer).
        if (value) {
          token = await getWebPushSubscription()
          if (!token) {
            alert(t('settings.push_token_err'))
            setNotifLoading(false); return
          }
        } else {
          token = user?.webPushToken ?? null
        }
      } else {
        // Les deux toggles sont désormais désactivés : on désabonne
        // proprement le navigateur et on efface le token côté serveur.
        try {
          const reg = await navigator.serviceWorker.ready
          const existing = await reg.pushManager.getSubscription()
          if (existing) await existing.unsubscribe()
        } catch {}
        token = null
      }

      const updated = await userApi.updateNotificationPrefs({
        webPushToken: token,
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
    onError: (e: any) => setDeleteError(e?.response?.data?.error || t('settings.wrong_password')),
  })

  const currentLang = LANGUAGES.find(l => l.code === selectedLang) ?? LANGUAGES[0]
  const currentCurrency = CURRENCIES.find(c => c.code === selectedCurrency) ?? CURRENCIES[0]

  return (
    <div className="min-h-screen bg-bg">
      {/* Header */}
      <div className="px-5 pt-[max(env(safe-area-inset-top),20px)] pb-4 sticky top-0 z-20 glass border-b border-white/5">
        <h1 className="text-2xl font-extrabold tracking-tight text-text">{t('settings.title')}</h1>
        <p className="text-sm text-text3 mt-0.5">{t('settings.subtitle')}</p>
      </div>

      <div className="px-5 pb-28">
        {/* Profil hero */}
        <div className="glass-card rounded-2xl p-5 mt-4 mb-3 relative overflow-hidden">
          <div className="flex items-center gap-4">
            <button onClick={() => setColorModal(true)} className="relative">
              <Avatar initials={(user?.username ?? '??').slice(0, 2).toUpperCase()} color={user?.avatarColor || '#7C6EFA'} size={60} ring />
              <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-surface border border-border flex items-center justify-center text-xs">✏️</div>
            </button>
            <div>
              <p className="text-base font-bold text-text">{user?.username}</p>
              <p className="text-xs text-text3 mt-0.5">{user?.email}</p>
              <span className="inline-block mt-2 text-[10px] font-bold text-accent2 bg-accent/10 border border-accent/20 px-2.5 py-1 rounded-full">{t('settings.active_member')}</span>
            </div>
          </div>
        </div>

        {/* OCR stats */}
        <SectionLabel label={t('settings.ocr_title')} />
        <div className="glass-card rounded-2xl p-4 mb-1">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-bold text-text">🧠 {t('settings.ocr_model')} · v1.4</span>
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${accuracy >= 80 ? 'bg-green/10 text-green' : 'bg-amber/10 text-amber'}`}>
              {t('settings.ocr_accurate', { v: accuracy.toFixed(0) })}
            </span>
          </div>
          <div className="grid grid-cols-3 divide-x divide-white/5 mb-3">
            {[
              { num: total, label: t('settings.ocr_corrections'), color: 'text-accent2' },
              { num: `${accuracy.toFixed(0)}%`, label: t('settings.ocr_precision'), color: 'text-green' },
              { num: untrained, label: t('settings.ocr_pending'), color: untrained > 0 ? 'text-amber' : 'text-text3' },
            ].map(s => (
              <div key={s.label} className="flex flex-col items-center py-1">
                <span className={`text-2xl font-light font-mono ${s.color}`}>{s.num}</span>
                <span className="text-[10px] text-text3 uppercase tracking-wider mt-1">{s.label}</span>
              </div>
            ))}
          </div>
          <div className="h-1 bg-surface3 rounded-full overflow-hidden mb-1.5">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(accuracy, 100)}%` }} />
          </div>
          <p className="text-[11px] text-text3">{untrained > 0 ? t('settings.ocr_before_next', { n: untrained }) : t('settings.ocr_uptodate')}</p>
        </div>
        <Notice text={t('settings.ocr_notice')} variant="accent" />

        {/* Mon compte */}
        <SectionLabel label={t('settings.account')} />
        <div className="glass-card rounded-2xl overflow-hidden p-0 mb-3">
          <SettingRow icon={Calendar} label={t('settings.member_since')} value={user?.createdAt ? format(new Date(user.createdAt), 'MMM yyyy', { locale: fr }) : '—'} />
          <RowSep />
          <SettingRow icon={Droplet} label={t('settings.profile_color')} onClick={() => setColorModal(true)}
            right={<div className="w-6 h-6 rounded-full border-2 border-border flex-shrink-0" style={{ backgroundColor: user?.avatarColor || '#7C6EFA' }} />}
          />
        </div>

        {/* Langue & Devise */}
        <SectionLabel label={t('settings.language_currency')} />
        <div className="glass-card rounded-2xl overflow-hidden p-0 mb-1">
          <SettingRow icon={Globe} label={t('settings.language')} value={`${currentLang.flag} ${currentLang.label}`} onClick={() => setLangModal(true)} />
          <RowSep />
          <SettingRow icon={Repeat} label={t('settings.currency')} value={`${currentCurrency.symbol} ${currentCurrency.code}`} onClick={() => setCurrencyModal(true)} />
        </div>
        <Notice text={t('settings.currency_notice')} variant="amber" />

        {/* Notifications */}
        <SectionLabel label={t('settings.notifications')} />
        {notifSupported && notifPermission === 'granted' && (
          <Notice text={t('settings.notif_enabled_device')} variant="accent" />
        )}
        {notifSupported && notifPermission === 'denied' && (
          <Notice variant="amber" text={t('settings.notif_blocked')} />
        )}
        {!notifSupported && (
          <Notice variant="amber" text={t('settings.notif_unsupported_pref')} />
        )}
        <div className="glass-card rounded-2xl overflow-hidden p-0 mb-3">
          <SettingRow icon={Bell} label={t('settings.notif_expense')}
            right={<Toggle checked={notifExpense} onChange={v => handleNotifToggle('expense', v)} disabled={notifLoading || (notifSupported && !swReady)} />}
          />
          <RowSep />
          <SettingRow icon={Clock} label={t('settings.notif_reminder')}
            right={<Toggle checked={notifReminder} onChange={v => handleNotifToggle('reminder', v)} disabled={notifLoading || (notifSupported && !swReady)} />}
          />
        </div>

        {/* Confidentialité */}
        <SectionLabel label={t('settings.privacy')} />
        <div className="glass-card rounded-2xl overflow-hidden p-0 mb-3">
          <SettingRow icon={Download} label={t('settings.export_data')} onClick={async () => {
            setExportLoading(true)
            try { await userApi.requestDataExport(); setExportSent(true) } catch {} finally { setExportLoading(false) }
          }} value={exportSent ? t('settings.export_sent') : exportLoading ? '…' : undefined} />
          <RowSep />
          <SettingRow icon={Lock} label={t('settings.privacy_policy')} onClick={() => window.open(PRIVACY_URL, '_blank')} />
          <RowSep />
          <SettingRow icon={FileText} label={t('settings.terms')} onClick={() => window.open(PRIVACY_URL, '_blank')} />
        </div>

        {/* À propos */}
<SectionLabel label={t('settings.about')} />
<div className="glass-card rounded-2xl overflow-hidden p-0 mb-3">
  <SettingRow icon={Monitor} label={t('settings.web_version')} value={APP_VERSION} />
  <RowSep />
  <SettingRow icon={Star} label={t('settings.download_mobile')} onClick={() => window.open('https://play.google.com/store/apps/details?id=com.julien.splitit', '_blank')} />
  <RowSep />
  <SettingRow icon={MessageCircle} label={t('settings.feedback')} onClick={() => window.open('mailto:ares88775@gmail.com?subject=Feedback SplitIt', '_blank')} />
</div>

        {/* Zone de danger */}
        <SectionLabel label={t('settings.danger')} />
        <div className="glass-card rounded-2xl overflow-hidden p-0">
          <SettingRow icon={LogOut} label={t('settings.logout_row')} onClick={async () => {
            if (confirm(t('settings.logout_confirm_web'))) { await logout(); router.replace('/auth/login') }
          }} />
          <RowSep />
          <SettingRow icon={Trash2} label={t('settings.delete_account')} destructive onClick={() => {
            setDeleteModal(true); setDeleteStep('confirm'); setDeleteConfirm(''); setDeletePassword(''); setDeleteError('')
          }} />
        </div>

        <p className="text-center text-[11px] text-text3 mt-8 mb-4">SplitIt {APP_VERSION} · {t('settings.made_with')}</p>
      </div>

      {/* ── Color picker modal ── */}
      <Modal visible={colorModal} onClose={() => setColorModal(false)} title={t('settings.profile_color')}>
        <p className="text-sm text-text3 mb-4">{t('settings.color_pick_sub')}</p>
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
        <Button label={t('common.save')} onClick={() => colorMutation.mutate(selectedColor)} loading={colorMutation.isPending} />
      </Modal>

      {/* ── Langue modal ── */}
      <Modal visible={langModal} onClose={() => setLangModal(false)} title={`🌍 ${t('settings.language')}`}>
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
        <Button label={t('common.apply')} onClick={() => langMutation.mutate(selectedLang)} loading={langMutation.isPending} />
      </Modal>

      {/* ── Devise modal ── */}
      <Modal visible={currencyModal} onClose={() => setCurrencyModal(false)} title={`💱 ${t('settings.currency')}`}>
        <Notice text={t('settings.currency_notice_short')} variant="amber" />
        <div className="space-y-1 my-4">
          {CURRENCIES.map(currency => (
            <button key={currency.code} onClick={() => setSelectedCurrency(currency.code)}
              className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-colors ${selectedCurrency === currency.code ? 'bg-accent/10 border border-accent/25' : 'hover:bg-surface2'}`}>
              <span className="w-8 text-center font-semibold text-text">{currency.symbol}</span>
              <span className={`flex-1 text-sm text-left ${selectedCurrency === currency.code ? 'text-accent2 font-bold' : 'text-text'}`}>{t(`settings.currency_${currency.code.toLowerCase()}`)}</span>
              {selectedCurrency === currency.code && <span className="text-accent2 font-bold">✓</span>}
            </button>
          ))}
        </div>
        <Button label={t('common.apply')} onClick={() => currencyMutation.mutate(selectedCurrency)} loading={currencyMutation.isPending} />
      </Modal>

      {/* ── Delete modal ── */}
      <Modal visible={deleteModal} onClose={() => setDeleteModal(false)} title={t('settings.delete_account')}>
        {deleteStep === 'confirm' ? (
          <>
            <div className="bg-red/5 border border-red/20 rounded-xl p-4 mb-5">
              <p className="text-sm font-bold text-red mb-2">⚠️ {t('settings.delete_warning')}</p>
              <p className="text-sm text-text2 leading-relaxed whitespace-pre-line">
                {t('settings.delete_bullets')}
              </p>
            </div>
            <p className="text-sm text-text2 mb-2">{t('settings.delete_type_before')} <span className="text-red font-bold">{t('settings.delete_keyword')}</span> {t('settings.delete_type_after')}</p>
            <Input label="" placeholder={t('settings.delete_keyword')} value={deleteConfirm} onChange={setDeleteConfirm} />
            <Button label={`${t('common.continue')} →`} variant="danger"
              onClick={() => { if (deleteConfirm.trim().toLowerCase() === deleteKeyword) setDeleteStep('password') }}
              disabled={deleteConfirm.trim().toLowerCase() !== deleteKeyword} />
          </>
        ) : (
          <>
            <div className="bg-red/5 border border-red/20 rounded-xl p-4 mb-5">
              <p className="text-sm font-bold text-red mb-1">🔑 {t('settings.delete_confirm_pw')}</p>
              <p className="text-sm text-text2">{t('settings.delete_confirm_pw_sub')}</p>
            </div>
            <Input label={t('auth.password')} type="password" value={deletePassword} onChange={setDeletePassword} />
            {deleteError && <p className="text-red text-xs mb-2">{deleteError}</p>}
            <Button label={deleteMutation.isPending ? t('settings.deleting') : t('settings.delete_final')} variant="danger"
              onClick={() => deleteMutation.mutate(deletePassword)} loading={deleteMutation.isPending} />
            <button onClick={() => setDeleteStep('confirm')} className="w-full text-xs text-text3 mt-3 py-2">{t('common.back')}</button>
          </>
        )}
      </Modal>
    </div>
  )
}