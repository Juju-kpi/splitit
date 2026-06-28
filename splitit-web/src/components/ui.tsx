// src/components/ui.tsx
'use client'
import React from 'react'
import { Loader2 } from 'lucide-react'

// ── Avatar ───────────────────────────────────────────────────────────────────
export function Avatar({ initials, color, size = 36, ring = false }: {
  initials: string; color: string; size?: number; ring?: boolean
}) {
  return (
    <div
      className={`rounded-full flex items-center justify-center font-bold flex-shrink-0 ${ring ? 'ring-2 ring-offset-1 ring-offset-bg' : ''}`}
      style={{ width: size, height: size, backgroundColor: color, fontSize: size * 0.36 }}
    >
      <span className="text-white">{initials}</span>
    </div>
  )
}

export function AvatarRow({ members, max = 5 }: { members: { id: string; avatarInitials: string; avatarColor: string; displayName: string }[]; max?: number }) {
  const shown = members.slice(0, max)
  const extra = members.length - shown.length
  return (
    <div className="flex items-center -space-x-2 mt-2">
      {shown.map(m => (
        <div key={m.id} title={m.displayName} className="ring-2 ring-[#16161A] rounded-full">
          <Avatar initials={m.avatarInitials} color={m.avatarColor} size={28} />
        </div>
      ))}
      {extra > 0 && (
        <div className="ring-2 ring-[#16161A] rounded-full bg-surface3 w-7 h-7 flex items-center justify-center text-[11px] font-semibold text-text2">
          +{extra}
        </div>
      )}
    </div>
  )
}

// ── Button ────────────────────────────────────────────────────────────────────
export function Button({ label, onClick, variant = 'primary', loading, disabled, icon, className = '', type = 'button' }: {
  label: string; onClick?: () => void; variant?: 'primary' | 'ghost' | 'danger'
  loading?: boolean; disabled?: boolean; icon?: React.ReactNode; className?: string; type?: 'button' | 'submit'
}) {
  const base = 'flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm transition-all duration-150 min-h-[48px] w-full'
  const variants = {
    primary: 'bg-accent text-white hover:bg-accent/90 shadow-lg shadow-accent/25',
    ghost: 'bg-surface2 text-text2 border border-border hover:bg-surface3',
    danger: 'bg-red/10 text-red border border-red/30 hover:bg-red/20',
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`${base} ${variants[variant]} ${(disabled || loading) ? 'opacity-40 cursor-not-allowed' : ''} ${className}`}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : icon}
      {label}
    </button>
  )
}

// ── Input ─────────────────────────────────────────────────────────────────────
export function Input({ label, placeholder, value, onChange, type = 'text', error, autoFocus, required }: {
  label?: string; placeholder?: string; value: string
  onChange: (v: string) => void; type?: string; error?: string
  autoFocus?: boolean; required?: boolean
}) {
  return (
    <div className="mb-4">
      {label && <label className="block text-xs font-semibold text-text3 uppercase tracking-widest mb-2">{label}</label>}
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        autoFocus={autoFocus}
        required={required}
        className={`w-full bg-surface2 border rounded-xl px-4 py-3 text-text placeholder-text3 text-sm outline-none transition-colors
          ${error ? 'border-red focus:border-red' : 'border-border focus:border-accent'}`}
      />
      {error && <p className="text-red text-xs mt-1">{error}</p>}
    </div>
  )
}

// ── Card ──────────────────────────────────────────────────────────────────────
export function Card({ children, className = '', onClick }: {
  children: React.ReactNode; className?: string; onClick?: () => void
}) {
  return (
    <div
      onClick={onClick}
      className={`glass-card rounded-2xl p-4 mb-3 ${onClick ? 'cursor-pointer hover:border-accent/30 transition-colors' : ''} ${className}`}
    >
      {children}
    </div>
  )
}

export function GlassCard({ children, className = '', glow = false }: {
  children: React.ReactNode; className?: string; glow?: boolean
}) {
  return (
    <div className={`glass-card rounded-2xl p-5 mb-3 relative overflow-hidden ${glow ? 'glow-accent border-accent/20' : ''} ${className}`}>
      {glow && <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-accent/10 blur-2xl" />}
      {children}
    </div>
  )
}

export function Pill({ label, variant = 'accent' }: { label: string; variant?: 'accent' | 'green' | 'amber' | 'red' }) {
  const variants = {
    accent: 'bg-accent/10 text-accent2 border border-accent/25',
    green: 'bg-green/10 text-green border border-green/25',
    amber: 'bg-amber/10 text-amber border border-amber/25',
    red: 'bg-red/10 text-red border border-red/25',
  }
  return <span className={`text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap ${variants[variant]}`}>{label}</span>
}

export function SectionLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 my-5">
      <div className="flex-1 h-px bg-white/5" />
      <span className="text-[10px] font-bold text-text3 uppercase tracking-[2px]">{label}</span>
      <div className="flex-1 h-px bg-white/5" />
    </div>
  )
}

export function Notice({ text, variant = 'accent' }: { text: string; variant?: 'accent' | 'amber' | 'green' }) {
  const variants = {
    accent: 'bg-accent/10 border-accent/25 text-accent2',
    amber: 'bg-amber/10 border-amber/25 text-amber',
    green: 'bg-green/10 border-green/25 text-green',
  }
  return (
    <div className={`flex gap-2 items-start border rounded-xl p-3 mb-3 text-sm ${variants[variant]}`}>
      <div className="w-1.5 h-1.5 rounded-full bg-current mt-1.5 flex-shrink-0" />
      <p>{text}</p>
    </div>
  )
}

export function Chip({ label, selected, onClick, avatar }: {
  label: string; selected: boolean; onClick: () => void
  avatar?: { initials: string; color: string }
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors mr-2 mb-2
        ${selected ? 'border-accent bg-accent/10 text-accent2' : 'border-border bg-surface2 text-text2 hover:border-border2'}`}
    >
      {avatar && (
        <div className="w-5 h-5 rounded-full flex items-center justify-center text-white font-bold flex-shrink-0"
          style={{ backgroundColor: avatar.color, fontSize: 8 }}>
          {avatar.initials}
        </div>
      )}
      {label}
    </button>
  )
}

export function Divider() {
  return <div className="h-px bg-white/5 my-2" />
}

export function Spinner({ className = '' }: { className?: string }) {
  return <Loader2 className={`animate-spin text-accent ${className}`} />
}

export function FullScreenSpinner() {
  return (
    <div className="min-h-screen bg-bg flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

export function MiniBar({ value, max, color = '#7C6EFA' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div className="h-1 bg-surface3 rounded-full overflow-hidden mt-2">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  )
}

// ── ScreenHeader ──────────────────────────────────────────────────────────────
export function ScreenHeader({ title, accentWord, subtitle, rightContent }: {
  title: string; accentWord?: string; subtitle?: string; rightContent?: React.ReactNode
}) {
  const base = accentWord ? title.replace(accentWord, '') : title
  return (
    <div className="px-5 pt-[max(env(safe-area-inset-top),20px)] pb-4 sticky top-0 z-20 glass">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-text">
            {base}{accentWord && <span className="text-accent">{accentWord}</span>}
          </h1>
          {subtitle && <p className="text-xs text-text3 mt-1 font-medium">{subtitle}</p>}
        </div>
        {rightContent && <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">{rightContent}</div>}
      </div>
    </div>
  )
}

export function ActionPill({ label, icon, primary, onClick }: { label: string; icon?: string; primary?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`text-xs font-semibold px-3 py-2 rounded-full transition-colors whitespace-nowrap
        ${primary ? 'bg-accent text-white shadow-lg shadow-accent/25' : 'bg-surface2 text-text2 border border-border'}`}
    >
      {icon && <span className="mr-1">{icon}</span>}{label}
    </button>
  )
}

export function EmptyState({ emoji, title, subtitle, actions }: { emoji: string; title: string; subtitle: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center pt-16 px-5 text-center">
      <div className="w-20 h-20 rounded-3xl bg-accent/10 border border-accent/20 flex items-center justify-center mb-5">
        <span className="text-4xl">{emoji}</span>
      </div>
      <h3 className="text-xl font-bold text-text mb-2 tracking-tight">{title}</h3>
      <p className="text-sm text-text3 mb-8 leading-relaxed max-w-xs">{subtitle}</p>
      {actions && <div className="flex flex-col gap-2.5 w-full max-w-xs">{actions}</div>}
    </div>
  )
}
