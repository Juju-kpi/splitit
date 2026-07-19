'use client'
// src/app/auth/forgot-password/page.tsx
import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button, Input, Notice } from '@/components/ui'
import { authApi } from '@/lib/api'
import { useT } from '@/store/langStore'

function ForgotPasswordInner() {
  const t = useT()
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
    if (!email.trim()) { setError(t('auth.enter_email')); return }
    setLoading(true); setError('')
    try { await authApi.forgotPassword(email.toLowerCase().trim()) } catch {}
    finally { setSent(true); setLoading(false) }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) { setError(t('auth.password_too_short')); return }
    if (password !== confirm) { setError(t('auth.passwords_mismatch')); return }
    setLoading(true); setError('')
    try {
      await authApi.resetPassword(token!, password)
      setResetDone(true)
    } catch (e: any) {
      setError(e?.response?.data?.error || t('auth.reset_link_invalid'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen px-5 py-6 max-w-sm mx-auto">
      <button onClick={() => router.back()} className="bg-surface2 border border-border/50 px-3 py-1.5 rounded-full text-xs font-medium text-text2 mb-8">
        {t('common.back')}
      </button>

      {token ? (
        resetDone ? (
          <>
            <div className="mb-7">
              <h1 className="text-[26px] font-bold text-text mb-2">{t('auth.password_updated')}</h1>
              <p className="text-sm text-text3 leading-relaxed">{t('auth.password_updated_sub')}</p>
            </div>
            <Button label={t('auth.sign_in')} onClick={() => router.replace('/auth/login')} />
          </>
        ) : (
          <form onSubmit={handleReset}>
            <div className="mb-7">
              <h1 className="text-[26px] font-bold text-text mb-2">{t('auth.new_password')}</h1>
              <p className="text-sm text-text3 leading-relaxed">{t('auth.choose_password')}</p>
            </div>
            <Input label={t('auth.new_password')} placeholder="••••••••" value={password} onChange={v => { setPassword(v); setError('') }} type="password" autoFocus />
            <Input label={t('auth.confirm_short')} placeholder="••••••••" value={confirm} onChange={v => { setConfirm(v); setError('') }} type="password" />
            {error && <p className="text-red text-[13px] mb-2">{error}</p>}
            <Button label={t('auth.save_password')} type="submit" loading={loading} />
          </form>
        )
      ) : (
        <>
          <div className="mb-7">
            <h1 className="text-[26px] font-bold text-text mb-2">{t('auth.forgot_title')}</h1>
            <p className="text-sm text-text3 leading-relaxed">
              {t('auth.forgot_sub_long')}
            </p>
          </div>
          {sent ? (
            <>
              <Notice variant="green" text={t('auth.link_sent_long')} />
              <Button label={t('auth.back_to_login')} onClick={() => router.replace('/auth/login')} />
            </>
          ) : (
            <form onSubmit={handleSend}>
              <Input label={t('auth.email')} placeholder={t('auth.email_ph')} value={email} onChange={v => { setEmail(v); setError('') }} type="email" autoFocus />
              {error && <p className="text-red text-[13px] mb-2">{error}</p>}
              <Button label={t('auth.send_link')} type="submit" loading={loading} />
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
