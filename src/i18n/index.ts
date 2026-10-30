import { es, type MessageKey } from './es'
import { en } from './en'
import { eu } from './eu'
import { ca } from './ca'
import { gl } from './gl'

export type { MessageKey }
export type Locale = 'es' | 'en' | 'eu' | 'ca' | 'gl'

export const LOCALES: readonly Locale[] = ['es', 'en', 'eu', 'ca', 'gl']

export const LOCALE_NAMES: Record<Locale, string> = {
  es: 'Español',
  en: 'English',
  eu: 'Euskara',
  ca: 'Català',
  gl: 'Galego',
}

export const tables: Record<Locale, Record<MessageKey, string>> = { es, en, eu, ca, gl }

let current: Locale = 'es'

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

export function setLocale(locale: Locale): void {
  current = locale
}

export function getLocale(): Locale {
  return current
}

export function detectLocale(langs: readonly string[]): Locale {
  for (const lang of langs) {
    const primary = lang.toLowerCase().split('-')[0]
    if (isLocale(primary)) return primary
  }
  return 'en'
}

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const text = tables[current][key]
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  )
}

export function tCount(
  base: 'answerTimes' | 'answerPeople' | 'mapInCountries' | 'mapInPlaces',
  n: number,
): string {
  const category = new Intl.PluralRules(current).select(n) === 'one' ? 'one' : 'other'
  return t(`${base}_${category}`, { n: new Intl.NumberFormat(current).format(n) })
}
