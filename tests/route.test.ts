import { describe, expect, it } from 'vitest'
import { parseRoute, shortLink, statsLink } from '@/route'

const TOKEN = 'A'.repeat(43)

describe('parseRoute', () => {
  it('parses a short code', () => {
    expect(parseRoute('#Ab3dE9x')).toEqual({ kind: 'go', code: 'Ab3dE9x' })
  })
  it.each(['#Ab3dE9x/', '#Ab3dE9x%20', '#Ab3dE9x?utm=1', '#Ab3dE9x ', '#Ab3dE9x.'])(
    'tolerates trailing junk in %s',
    (hash) => {
      expect(parseRoute(hash)).toEqual({ kind: 'go', code: 'Ab3dE9x' })
    },
  )
  it('sends 8 base62 characters to home', () => {
    expect(parseRoute('#Ab3dE9xY')).toEqual({ kind: 'home' })
  })
  it('sends 6 characters to home', () => {
    expect(parseRoute('#Ab3dE9')).toEqual({ kind: 'home' })
  })
  it('parses stats links', () => {
    expect(parseRoute(`#s/Ab3dE9x.${TOKEN}`)).toEqual({
      kind: 'stats',
      code: 'Ab3dE9x',
      token: TOKEN,
    })
  })
  it('rejects malformed stats links', () => {
    expect(parseRoute('#s/Ab3dE9x.short')).toEqual({ kind: 'home' })
    expect(parseRoute(`#s/Ab3dE9x.${TOKEN}x`)).toEqual({ kind: 'home' })
  })
  it('tolerates trailing junk after a stats link', () => {
    for (const junk of ['/', '%20', '?x=1', ' ', '=']) {
      expect(parseRoute(`#s/Ab3dE9x.${TOKEN}${junk}`)).toEqual({
        kind: 'stats',
        code: 'Ab3dE9x',
        token: TOKEN,
      })
    }
  })
  it('parses the fixed pages', () => {
    expect(parseRoute('#/links')).toEqual({ kind: 'links' })
    expect(parseRoute('#/privacy')).toEqual({ kind: 'privacy' })
  })
  it('falls back to home', () => {
    expect(parseRoute('')).toEqual({ kind: 'home' })
    expect(parseRoute('#')).toEqual({ kind: 'home' })
    expect(parseRoute('#/nope')).toEqual({ kind: 'home' })
    expect(parseRoute('#/links/x')).toEqual({ kind: 'home' })
  })
})

describe('link builders', () => {
  const base = 'https://endika.github.io/txiki/'
  it('builds short and stats links', () => {
    expect(shortLink('Ab3dE9x', base)).toBe('https://endika.github.io/txiki/#Ab3dE9x')
    expect(statsLink('Ab3dE9x', TOKEN, base)).toBe(
      `https://endika.github.io/txiki/#s/Ab3dE9x.${TOKEN}`,
    )
  })
  it('round-trips through parseRoute', () => {
    const hash = new URL(statsLink('Ab3dE9x', TOKEN, base)).hash
    expect(parseRoute(hash)).toEqual({ kind: 'stats', code: 'Ab3dE9x', token: TOKEN })
  })
})
