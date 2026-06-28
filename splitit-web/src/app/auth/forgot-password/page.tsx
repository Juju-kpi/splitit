'use client'
// src/app/auth/forgot-password/page.tsx
import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button, Input, Notice } from '@/components/ui'
import { authApi } from '@/lib/api'

function ForgotPasswordInner() {
  const router = useRouter()
  const params = useSearchParams()
  const token = params.get('token') || undefined

  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [resetDone, setResetDone] = useState(false)

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) { setError('Entre ton adresse email.'); return }
    setLoading(true); setError('')
    try { await authApi.forgotPassword(email.toLowerCase().trim()) } catch {}
    finally { setSent(true); setLoading(false) }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) { setError('Le mot de passe doit faire au moins 8 caractères.'); return }
    if (password !== confirm) { setError('Les mots de passe ne correspondent pas.'); return }
    setLoading(true); setError('')
    try {
      await authApi.resetPassword(token!, password)
      setResetDone(true)
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Lien invalide ou expiré. Refais une demande.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen px-5 py-6 max-w-sm mx-auto">
      <button onClick={() => router.back()} className="bg-surface2 border border-border/50 px-3 py-1.5 rounded-full text-xs font-medium text-text2 mb-8">
        ← Retour
      </button>

      {token ? (
        resetDone ? (
          <>
            <div className="mb-7">
              <h1 className="text-[26px] font-bold text-text mb-2">Mot de passe mis à jour ✓</h1>
              <p className="text-sm text-text3 leading-relaxed">Tu peux maintenant te connecter avec ton nouveau mot de passe.</p>
            </div>
            <Button label="Se connecter" onClick={() => router.replace('/auth/login')} />
          </>
        ) : (
          <form onSubmit={handleReset}>
            <div className="mb-7">
              <h1 className="text-[26px] font-bold text-text mb-2">Nouveau mot de passe</h1>
              <p className="text-sm text-text3 leading-relaxed">Choisis un mot de passe d'au moins 8 caractères.</p>
            </div>
            <Input label="Nouveau mot de passe" placeholder="••••••••" value={password} onChange={v => { setPassword(v); setError('') }} type="password" autoFocus />
            <Input label="Confirmer" placeholder="••••••••" value={confirm} onChange={v => { setConfirm(v); setError('') }} type="password" />
            {error && <p className="text-red text-[13px] mb-2">{error}</p>}
            <Button label="Enregistrer" type="submit" loading={loading} />
          </form>
        )
      ) : (
        <>
          <div className="mb-7">
            <h1 className="text-[26px] font-bold text-text mb-2">Mot de passe oublié</h1>
            <p className="text-sm text-text3 leading-relaxed">
              Entre ton adresse email. Si un compte existe, tu recevras un lien de réinitialisation.
            </p>
          </div>
          {sent ? (
            <>
              <Notice variant="green" text="Si un compte existe pour cet email, un lien a été envoyé. Vérifie ta boîte mail (et tes spams)." />
              <Button label="Retour à la connexion" onClick={() => router.replace('/auth/login')} />
            </>
          ) : (
            <form onSubmit={handleSend}>
              <Input label="Email" placeholder="toi@exemple.com" value={email} onChange={v => { setEmail(v); setError('') }} type="email" autoFocus />
              {error && <p className="text-red text-[13px] mb-2">{error}</p>}
              <Button label="Envoyer le lien" type="submit" loading={loading} />
            </form>
          )}
        </>
      )}
    </div>
  )
}

export default function ForgotPasswordPage() {
  return <Suspense><ForgotPasswordInner /></Suspense>
}
