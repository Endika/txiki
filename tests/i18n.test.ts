import { describe, expect, it } from 'vitest'
import { LOCALES, detectLocale, setLocale, t, tCount, tables } from '@/i18n'

describe('i18n', () => {
  it('gives every locale exactly the same non-empty keys', () => {
    const keys = Object.keys(tables.es).sort()
    for (const locale of LOCALES) {
      expect(Object.keys(tables[locale]).sort(), locale).toEqual(keys)
      for (const [key, value] of Object.entries(tables[locale])) {
        expect(value.trim(), `${locale}.${key}`).not.toBe('')
      }
    }
  })

  it('keeps the same placeholders in every locale', () => {
    const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort()
    for (const locale of LOCALES) {
      for (const key of Object.keys(tables.es) as (keyof typeof tables.es)[]) {
        expect(placeholders(tables[locale][key]), `${locale}.${key}`).toEqual(
          placeholders(tables.es[key]),
        )
      }
    }
  })

  it('detects by primary subtag and falls back to English', () => {
    expect(detectLocale(['eu-ES'])).toBe('eu')
    expect(detectLocale(['pt-BR'])).toBe('en')
    expect(detectLocale(['pt-BR', 'gl'])).toBe('gl')
    expect(detectLocale([])).toBe('en')
  })

  it('fills placeholders', () => {
    setLocale('en')
    expect(t('blockDaysNote', { n: 14 })).toBe('last 14')
  })

  it('picks the singular and plural answer', () => {
    setLocale('es')
    expect(tCount('answerTimes', 1)).toBe('Lo han abierto una vez,')
    expect(tCount('answerTimes', 12)).toBe('Lo han abierto 12 veces,')
    expect(tCount('answerPeople', 1)).toBe('una persona.')
    expect(tCount('answerPeople', 9)).toBe('9 personas.')
    expect(tCount('answerTimes', 1200)).toBe('Lo han abierto 1200 veces,')
    setLocale('en')
    expect(tCount('answerPeople', 1)).toBe('by one person.')
    expect(tCount('answerPeople', 2)).toBe('by 2 people.')
    setLocale('es')
  })
})
