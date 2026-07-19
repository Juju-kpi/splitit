// src/i18n/index.ts
// Lightweight i18n for the web app, sharing the SAME locale files as mobile.
// Dot-path keys ("auth.login"), {{var}} interpolation, fallback to French.

import fr from './locales/fr.json'
import en from './locales/en.json'
import de from './locales/de.json'
import es from './locales/es.json'
import it from './locales/it.json'

type Dict = Record<string, any>
const TABLES: Record<string, Dict> = { fr, en, de, es, it }

export const SUPPORTED_LOCALES = ['fr', 'en', 'de', 'es', 'it'] as const

function lookup(table: Dict, key: string): unknown {
  return key.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), table)
}

export function translate(locale: string, key: string, vars?: Record<string, any>): string {
  const table = TABLES[locale] ?? TABLES.fr
  let val = lookup(table, key)
  if (typeof val !== 'string') val = lookup(TABLES.fr, key) // fallback FR
  if (typeof val !== 'string') return key                   // last resort: the key itself
  return vars ? val.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? '')) : val
}
