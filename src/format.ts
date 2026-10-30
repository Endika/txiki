import { getLocale } from '@/i18n'

const MINUTE = 60
const HOUR = 3600
const DAY = 86400

export function formatNumber(n: number): string {
  return new Intl.NumberFormat(getLocale()).format(n)
}

function startOfDay(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function calendarDays(at: number, now: number): number {
  return Math.round((startOfDay(at) - startOfDay(now)) / (DAY * 1000))
}

export function relativeTime(iso: string, now: number): string {
  const at = Date.parse(iso)
  const seconds = Math.round((at - now) / 1000)
  const abs = Math.abs(seconds)
  const short = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto', style: 'short' })
  const long = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto', style: 'long' })
  if (abs < MINUTE) return short.format(0, 'second')
  if (abs < HOUR) return short.format(Math.trunc(seconds / MINUTE), 'minute')
  if (abs < DAY) return short.format(Math.trunc(seconds / HOUR), 'hour')
  const days = calendarDays(at, now)
  if (Math.abs(days) < 30) return long.format(days, 'day')
  if (Math.abs(days) < 365) return long.format(Math.trunc(days / 30), 'month')
  return long.format(Math.trunc(days / 365), 'year')
}

export function isRecent(iso: string, now: number): boolean {
  const age = now - Date.parse(iso)
  return age >= 0 && age < DAY * 1000
}

export function clockTime(iso: string, now: number): string {
  const at = Date.parse(iso)
  const time = new Intl.DateTimeFormat(getLocale(), { hour: '2-digit', minute: '2-digit' }).format(
    at,
  )
  const days = calendarDays(at, now)
  if (days === 0 || days === -1) {
    const word = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' }).format(days, 'day')
    return `${word} ${time}`
  }
  const date = new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'short' }).format(at)
  return `${date} ${time}`
}

export function shortDate(iso: string): string {
  return new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'short' }).format(
    Date.parse(iso),
  )
}

export function localDay(ms: number): string {
  const d = new Date(ms)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

export function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Intl.DateTimeFormat(getLocale(), {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1))
}

export function countryName(code: string): string | null {
  try {
    return (
      new Intl.DisplayNames([getLocale()], { type: 'region', fallback: 'none' }).of(code) ?? null
    )
  } catch {
    return null
  }
}

export function languageName(tag: string): string {
  try {
    return (
      new Intl.DisplayNames([getLocale()], { type: 'language', fallback: 'none' }).of(tag) ?? tag
    )
  } catch {
    return tag
  }
}

export function shiftDay(day: string, offset: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + offset)).toISOString().slice(0, 10)
}
