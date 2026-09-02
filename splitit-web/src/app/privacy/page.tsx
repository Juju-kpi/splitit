'use client'
// src/app/privacy/page.tsx
//
// La politique de confidentialité, dans les cinq langues, sur une seule URL.
//
// L'ordre de choix de la langue est délibéré :
//   1. ?lang=de — c'est ce que passe l'application, qui connaît la langue
//      réellement choisie par l'utilisateur dans ses réglages ;
//   2. la langue du navigateur, pour un visiteur qui arrive depuis le Play
//      Store ou un moteur de recherche ;
//   3. l'anglais, qui parle au plus grand nombre.
//
// Une seule URL suffit donc partout : Play Console, App Store et les deux
// applications. Le contenu vient de privacy.ts, généré depuis les markdown.

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { PRIVACY, PRIVACY_LANGS, type PolicyLang, type PolicyBlock } from '@/content/privacy'

/** Rend le gras `**...**` sans tirer une dépendance de rendu markdown. */
function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**')
          ? <strong key={i} className="text-text font-medium">{part.slice(2, -2)}</strong>
          : <span key={i}>{part}</span>
      )}
    </>
  )
}

function Block({ block }: { block: PolicyBlock }) {
  if (block.type === 'ul') {
    return (
      <ul className="flex flex-col gap-2.5 mt-3">
        {block.items.map((item, i) => (
          <li key={i} className="flex gap-3 text-[15px] text-text2 leading-relaxed">
            <span className="mt-[9px] w-1 h-1 rounded-full bg-text3 shrink-0" />
            <span><RichText text={item} /></span>
          </li>
        ))}
      </ul>
    )
  }
  return (
    <p className="text-[15px] text-text2 leading-relaxed mt-3">
      <RichText text={block.text} />
    </p>
  )
}

function PrivacyInner() {
  const params = useSearchParams()
  const asked = params.get('lang')
  const [lang, setLang] = useState<PolicyLang>('en')

  useEffect(() => {
    // L'application passe ?lang= ; sinon on suit le navigateur.
    const wanted = (asked || navigator.language || 'en').slice(0, 2).toLowerCase()
    setLang(PRIVACY_LANGS.includes(wanted as PolicyLang) ? (wanted as PolicyLang) : 'en')
  }, [asked])

  const policy = PRIVACY[lang]

  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-2xl mx-auto px-6 py-12 sm:py-16">

        <div className="flex flex-wrap gap-2 mb-10">
          {PRIVACY_LANGS.map(code => (
            <button
              key={code}
              onClick={() => setLang(code)}
              className={`px-3.5 min-h-[36px] rounded-full text-[13px] font-medium transition-colors ${
                code === lang
                  ? 'bg-primary text-onPrimary'
                  : 'bg-surface2 text-text2 hover:bg-surface3'
              }`}
            >
              {PRIVACY[code].label}
            </button>
          ))}
        </div>

        <h1 className="text-[30px] sm:text-[34px] font-semibold tracking-[-0.03em] text-text leading-[1.15]">
          {policy.title}
        </h1>
        <p className="text-[13px] text-text3 mt-3">{policy.updated}</p>

        <div className="flex flex-col gap-9 mt-12">
          {policy.sections.map((section, i) => (
            <section key={i}>
              <h2 className="text-[17px] font-semibold text-text tracking-[-0.01em]">
                {section.heading}
              </h2>
              {section.blocks.map((block, j) => <Block key={j} block={block} />)}
            </section>
          ))}
        </div>

        <div className="h-px bg-white/[0.06] mt-14 mb-6" />
        <p className="text-[13px] text-text3">Splitit</p>
      </div>
    </div>
  )
}

export default function PrivacyPage() {
  // useSearchParams impose une frontière Suspense au rendu statique.
  return (
    <Suspense fallback={<div className="min-h-screen bg-bg" />}>
      <PrivacyInner />
    </Suspense>
  )
}
