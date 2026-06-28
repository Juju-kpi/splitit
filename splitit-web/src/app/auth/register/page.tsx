'use client'
// src/app/auth/register/page.tsx
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuthStore } from '@/store/authStore'
import { Button, Input } from '@/components/ui'

export default function RegisterPage() {
  const router = useRouter()
  const register = useAuthStore(s => s.register)

  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    if (!email || !username || !password) { setError('Remplis tous les champs.'); return }
    if (password.length < 8) { setError('Mot de passe : 8 caractères minimum.'); return }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) { setError("Nom d'utilisateur : lettres, chiffres et _ uniquement."); return }
    setLoading(true); setError('')
    try {
      await register(email.toLowerCase().trim(), username.trim(), password)
      router.replace('/home')
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Inscription impossible.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-5 py-10">
      <form onSubmit={handleRegister} className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-[60px] h-[60px] rounded-2xl bg-accent/10 border border-accent/30 flex items-center justify-center mb-3.5 shadow-lg shadow-accent/25">
            <span className="text-3xl font-extrabold text-accent">S</span>
          </div>
          <h1 className="text-[34px] font-extrabold tracking-tight text-text">Split<span className="text-accent">it</span></h1>
          <p className="text-xs text-text3 mt-1.5 font-medium">Créer un compte</p>
        </div>

        <div className="glass rounded-2xl p-5 mb-5">
          <h2 className="text-xl font-bold text-text mb-5 tracking-tight">Inscription</h2>
          <Input label="Email" placeholder="toi@exemple.com" value={email} onChange={v => { setEmail(v); setError('') }} type="email" />
          <Input label="Nom d'utilisateur" placeholder="alicia42" value={username} onChange={v => { setUsername(v); setError('') }} />
          <Input label="Mot de passe" placeholder="8 caractères minimum" value={password} onChange={v => { setPassword(v); setError('') }} type="password" />

          {error && (
            <div className="flex items-center gap-2 bg-red/10 border border-red/20 rounded-lg p-3 mb-3 text-sm">
              <span className="text-red">⚠</span>
              <p className="text-red text-[13px] flex-1">{error}</p>
            </div>
          )}

          <Button label="Créer mon compte" type="submit" loading={loading} />
        </div>

        <Link href="/auth/login" className="flex justify-center py-4 min-h-[52px] items-center">
          <span className="text-sm text-text3 font-medium">Déjà un compte ? <span className="text-accent2">Se connecter</span></span>
        </Link>
      </form>
    </div>
  )
}
