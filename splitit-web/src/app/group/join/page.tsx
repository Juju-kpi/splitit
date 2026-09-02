'use client'
// src/app/group/join/page.tsx
//
// Flux aligné sur le mobile (app/app/group/join.tsx) :
//   1. "code"  → saisie du code d'invitation
//   2. "claim" → si le groupe contient des membres sans compte (placeholders),
//                on demande "es-tu l'un d'eux ?" pour récupérer l'historique
//   3. "name"  → sinon (ou si "aucun de ces membres"), on saisit son prénom
//
// Points corrigés :
//   - le champ code ne force plus les majuscules (les codes sont des cuid en
//     minuscules) et désactive l'autocapitalisation du clavier mobile/PWA
//   - le code passé en query string (?code=... des liens d'invitation) est lu
//   - le preview utilise les vrais champs renvoyés par l'API
//     (groupName / groupEmoji / guestMembers)

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { groupsApi } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { Button, Input, Notice, Avatar } from '@/components/ui'
import { useT } from '@/store/langStore'

type GuestMember = {
  id: string
  displayName: string
  avatarColor: string
  avatarInitials: string
}
type Step = 'code' | 'claim' | 'name'

function JoinGroupInner() {
  const router = useRouter()
  const qc = useQueryClient()
  const t = useT()
  const params = useSearchParams()
  const user = useAuthStore(s => s.user)

  const [code, setCode] = useState(params.get('code') || '')
  const [step, setStep] = useState<Step>('code')
  const [preview, setPreview] = useState<{ groupName: string; groupEmoji: string } | null>(null)
  const [guestMembers, setGuestMembers] = useState<GuestMember[]>([])
  const [claimMemberId, setClaimMemberId] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState(user?.username || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Le code est un identifiant : on retire juste les espaces (copier-coller),
  // sans toucher à la casse — le backend compare sans tenir compte de la casse.
  const cleanCode = code.replace(/\s+/g, '')

  async function handlePreview(e: React.FormEvent) {
    e.preventDefault()
    if (!cleanCode) { setError(t('groups.code_missing_msg')); return }
    setLoading(true); setError('')
    try {
      const data = await groupsApi.joinPreview(cleanCode)
      setPreview({ groupName: data.groupName, groupEmoji: data.groupEmoji })
      const guests: GuestMember[] = data.guestMembers || []
      setGuestMembers(guests)
      setStep(guests.length > 0 ? 'claim' : 'name')
    } catch (e: any) {
      const msg = e?.response?.data?.error
      setError(!msg || msg === 'Invalid invite code' ? t('groups.code_invalid_web') : msg)
    } finally { setLoading(false) }
  }

  async function handleJoin() {
    const claimed = claimMemberId ? guestMembers.find(m => m.id === claimMemberId) : null
    const name = claimed ? claimed.displayName : displayName.trim()
    if (!name) { setError(t('groups.name_missing_msg')); return }

    setLoading(true); setError('')
    try {
      const data = await groupsApi.join(cleanCode, name, claimMemberId || undefined)
      qc.invalidateQueries({ queryKey: ['groups'] })
      router.replace(`/group/${data.group.id}`)
    } catch (e: any) {
      const msg = e?.response?.data?.error
      if (msg === 'Already a member') setError(t('groups.already_member_msg'))
      else if (msg === 'Invalid invite code') setError(t('groups.code_invalid_web'))
      else setError(msg || t('groups.join_error_web'))
    } finally { setLoading(false) }
  }

  const goBack = step === 'code'
    ? () => router.back()
    : step === 'claim'
      ? () => { setStep('code'); setError('') }
      : () => { setStep(guestMembers.length > 0 ? 'claim' : 'code'); setError('') }

  return (
    <div className="min-h-screen px-5 max-w-sm mx-auto pt-[max(env(safe-area-inset-top),24px)] pb-[max(env(safe-area-inset-bottom),24px)]">
      <button onClick={goBack} className="bg-surface2 border border-border/50 px-4 py-2 rounded-full text-xs font-medium text-text2 mb-8 min-h-[36px]">
        {t('common.back')}
      </button>

      {preview && step !== 'code' && (
        <div className="flex items-center gap-2.5 bg-accent/10 border border-accent/20 rounded-xl p-3 mb-5">
          <span className="text-2xl">{preview.groupEmoji}</span>
          <span className="text-[15px] font-semibold text-text">{preview.groupName}</span>
        </div>
      )}

      {/* ── Étape 1 : le code ─────────────────────────────────────────── */}
      {step === 'code' && (
        <form onSubmit={handlePreview}>
          <h1 className="text-[26px] font-bold text-text mb-1">{t('groups.join')}</h1>
          <p className="text-sm text-text3 mb-7">{t('groups.join_sub')}</p>
          <Input
            label={t('groups.invite_code')}
            placeholder={t('groups.code_ph')}
            value={code}
            onChange={v => { setCode(v); setError('') }}
            autoFocus
            mono
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
          />
          {error && <p className="text-red text-[13px] mb-2">{error}</p>}
          <Button label={t('common.continue')} type="submit" loading={loading} />
        </form>
      )}

      {/* ── Étape 2 : réclamer un membre placeholder ──────────────────── */}
      {step === 'claim' && (
        <div>
          <h1 className="text-[22px] font-bold text-text mb-2">{t('groups.claim_title')}</h1>
          <p className="text-[13px] text-text3 leading-relaxed mb-4">{t('groups.claim_sub_long')}</p>

          <div className="space-y-2 mb-3">
            {guestMembers.map(m => {
              const selected = claimMemberId === m.id
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setClaimMemberId(selected ? null : m.id)}
                  className={`w-full flex items-center gap-3 rounded-xl p-3.5 border text-left transition-colors ${selected ? 'border-accent bg-accent/10' : 'border-border bg-surface2'}`}
                >
                  <Avatar initials={m.avatarInitials} color={m.avatarColor} size={38} />
                  <span className={`flex-1 text-[15px] font-medium ${selected ? 'text-accent2' : 'text-text'}`}>
                    {m.displayName}
                  </span>
                  <span className={`w-[22px] h-[22px] rounded-full border-2 flex items-center justify-center ${selected ? 'border-accent' : 'border-border2'}`}>
                    {selected && <span className="w-2.5 h-2.5 rounded-full bg-primary" />}
                  </span>
                </button>
              )
            })}
          </div>

          {claimMemberId && <Notice variant="green" text={t('groups.claim_link_notice')} />}
          {error && <p className="text-red text-[13px] mb-2">{error}</p>}

          <Button
            label={claimMemberId
              ? t('groups.claim_confirm', { name: guestMembers.find(m => m.id === claimMemberId)?.displayName })
              : t('common.confirm')}
            onClick={handleJoin}
            loading={loading}
            disabled={!claimMemberId}
          />

          <button
            type="button"
            onClick={() => { setClaimMemberId(null); setError(''); setStep('name') }}
            className="w-full text-[13px] font-medium text-accent2 py-4 min-h-[48px]"
          >
            {t('groups.none_of_these')}
          </button>
        </div>
      )}

      {/* ── Étape 3 : rejoindre avec son propre nom ───────────────────── */}
      {step === 'name' && (
        <div>
          <h1 className="text-[22px] font-bold text-text mb-2">{t('groups.your_name_in_group')}</h1>
          <p className="text-[13px] text-text3 leading-relaxed mb-5">{t('groups.name_step_sub')}</p>
          <Input
            label={t('groups.first_name')}
            placeholder={t('groups.first_name_ph')}
            value={displayName}
            onChange={v => { setDisplayName(v); setError('') }}
            autoFocus
            autoCapitalize="words"
          />
          <Notice variant="accent" text={t('groups.name_hint')} />
          {error && <p className="text-red text-[13px] mb-2">{error}</p>}
          <Button label={t('groups.join_group_btn')} onClick={handleJoin} loading={loading} disabled={!displayName.trim()} />
        </div>
      )}
    </div>
  )
}

export default function JoinGroupPage() {
  return <Suspense><JoinGroupInner /></Suspense>
}
