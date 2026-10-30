import { beforeEach, describe, expect, it } from 'vitest'
import {
  clockTime,
  countryName,
  dayLabel,
  isRecent,
  languageName,
  localDay,
  relativeTime,
  shiftDay,
} from '@/format'
import { displayTarget, displayUrl, normalizeUrl } from '@/url'
import { LOCALES, setLocale } from '@/i18n'

const NOW = new Date(2026, 9, 30, 12, 0, 0).getTime()

beforeEach(() => setLocale('es'))

describe('format', () => {
  it('writes relative times the way the mockup does', () => {
    expect(relativeTime(new Date(NOW - 2 * 3600_000).toISOString(), NOW)).toBe('hace 2 h')
    expect(relativeTime(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe('hace 5 min')
    expect(relativeTime(new Date(NOW - 5 * 86400_000).toISOString(), NOW)).toBe('hace 5 días')
    expect(relativeTime(new Date(NOW - 86400_000).toISOString(), NOW)).toBe('ayer')
  })

  it('counts calendar days like the clock labels, so 47 h is never “ayer”', () => {
    const at = new Date(2026, 9, 28, 13, 0).toISOString()
    expect(relativeTime(at, NOW)).toBe('anteayer')
    expect(
      relativeTime(
        new Date(2026, 9, 29, 0, 30).toISOString(),
        new Date(2026, 9, 30, 2, 0).getTime(),
      ),
    ).toBe('ayer')
    expect(
      relativeTime(
        new Date(2026, 9, 28, 23, 30).toISOString(),
        new Date(2026, 9, 30, 0, 30).getTime(),
      ),
    ).toBe('anteayer')
  })

  it('knows what a recent click is', () => {
    expect(isRecent(new Date(NOW - 3600_000).toISOString(), NOW)).toBe(true)
    expect(isRecent(new Date(NOW - 2 * 86400_000).toISOString(), NOW)).toBe(false)
  })

  it('labels clicks as today, yesterday or a date', () => {
    expect(clockTime(new Date(2026, 9, 30, 9, 10).toISOString(), NOW)).toMatch(/^hoy 09:10$/)
    expect(clockTime(new Date(2026, 9, 29, 17, 5).toISOString(), NOW)).toMatch(/^ayer 17:05$/)
    expect(clockTime(new Date(2026, 9, 20, 17, 5).toISOString(), NOW)).toMatch(/^20 oct\.? 17:05$/)
  })

  it('does day arithmetic on date strings', () => {
    expect(localDay(NOW)).toBe('2026-10-30')
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01')
    expect(dayLabel('2026-10-17')).toMatch(/17 oct/)
  })

  it('names countries in every locale without throwing', () => {
    const names = LOCALES.map((locale) => {
      setLocale(locale)
      return countryName('ES')
    })
    expect(names).toEqual(['España', 'Spain', 'Espainia', 'Espanya', 'España'])
    expect(countryName('ZZZZ')).toBeNull()
    expect(countryName('XX')).toBeNull()
    expect(languageName('es-ES')).toBe('español de España')
    expect(languageName('!!')).toBe('!!')
  })

  it('normalizes what people type', () => {
    expect(normalizeUrl('endika.dev/x')).toBe('https://endika.dev/x')
    expect(normalizeUrl('  http://a.es  ')).toBe('http://a.es')
    expect(normalizeUrl('localhost:3000')).toBe('https://localhost:3000')
    for (const bad of ['', 'javascript:alert(1)', 'a b', 'ftp://x.es', 'x', 'https://u:p@x.es']) {
      expect(normalizeUrl(bad), bad).toBeNull()
    }
    expect(displayUrl('https://localhost/txiki/#a')).toBe('localhost/txiki/#a')
  })

  it('shows destinations without the protocol', () => {
    expect(displayTarget('https://endika.dev/cv-2026.pdf')).toBe('endika.dev/cv-2026.pdf')
    expect(displayTarget('https://example.com/')).toBe('example.com')
    expect(displayTarget('not a url')).toBe('not a url')
  })
})
