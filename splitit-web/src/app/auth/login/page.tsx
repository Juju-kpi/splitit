'use client'
// src/app/auth/login/page.tsx
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuthStore } from '@/store/authStore'
import { Button, Input } from '@/components/ui'

const LAST_EMAIL_KEY = 'splitit_last_email'

export default function LoginPage() {
  const router = useRouter()
  const login = useAuthStore(s => s.login)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [rememberMe, setRememberMe] = useState(true)

  useEffect(() => {
    const v = localStorage.getItem(LAST_EMAIL_KEY)
    if (v) setEmail(v)
  }, [])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password) { setError('Remplis tous les champs.'); return }
    setLoading(true); setError('')
    try {
      await login(email.toLowerCase().trim(), password)
      if (rememberMe) localStorage.setItem(LAST_EMAIL_KEY, email.toLowerCase().trim())
      router.replace('/home')
    } catch (e: any) {
      const msg = e?.response?.data?.error
      setError(msg === 'Invalid email or password' ? 'Email ou mot de passe incorrect.' : (msg || 'Connexion impossible. Vérifie ta connexion.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-5 py-10">
      <form onSubmit={handleLogin} className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-9">
          <div className="w-[60px] h-[60px] rounded-2xl bg-accent/10 border border-accent/30 flex items-center justify-center mb-4 shadow-lg shadow-accent/25">
            <span className="text-3xl font-extrabold text-accent">S</span>
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight text-text">Split<span className="text-accent">it</span></h1>
          <p className="text-xs text-text3 mt-1.5 font-medium">Partagez sans prise de tête</p>
        </div>

        <div className="glass rounded-2xl p-5 mb-5">
          <h2 className="text-xl font-bold text-text mb-5 tracking-tight">Connexion</h2>
          <Input label="Email" placeholder="toi@exemple.com" value={email} onChange={v => { setEmail(v); setError('') }} type="email" />
          <Input label="Mot de passe" placeholder="••••••••" value={password} onChange={v => { setPassword(v); setError('') }} type="password" />

          <div className="flex items-center justify-between mt-1 mb-4">
            <button type="button" onClick={() => setRememberMe(r => !r)} className="flex items-center gap-2 min-h-[44px]">
              <div className={`w-[22px] h-[22px] rounded-md border-[1.5px] flex items-center justify-center ${rememberMe ? 'bg-accent border-accent' : 'border-border2'}`}>
                {rememberMe && <span className="text-white text-xs font-extrabold">✓</span>}
              </div>
              <span className="text-[13px] text-text2 font-medium">Rester connecté</span>
            </button>
            <Link href="/auth/forgot-password" className="text-[13px] text-accent2 font-semibold min-h-[44px] flex items-center">
              Mot de passe oublié ?
            </Link>
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red/10 border border-red/20 rounded-lg p-3 mb-3 text-sm">
              <span className="text-red">⚠</span>
              <p className="text-red text-[13px] flex-1">{error}</p>
            </div>
          )}

          <Button label="Se connecter" type="submit" loading={loading} />
        </div>

        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 h-px bg-white/5" />
          <span className="text-xs text-text3 font-medium">ou</span>
          <div className="flex-1 h-px bg-white/5" />
        </div>

        <Link href="/auth/register">
          <button type="button" className="w-full bg-surface2 border border-border rounded-xl py-[15px] text-[15px] font-semibold text-text2 min-h-[52px]">
            Créer un compte
          </button>
        </Link>
      </form>
    </div>
  )
}
