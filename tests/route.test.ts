import { describe, expect, it } from 'vitest'
import { normalizeChannel, parseRoute, shortLink, statsHash, statsLink } from '@/route'

const TOKEN = 'A'.repeat(43)

describe('parseRoute', () => {
  it('parses a short code', () => {
    expect(parseRoute('#Ab3dE9x')).toEqual({ kind: 'go', code: 'Ab3dE9x', channel: null })
  })
  it.each(['#Ab3dE9x/', '#Ab3dE9x%20', '#Ab3dE9x?utm=1', '#Ab3dE9x ', '#Ab3dE9x.'])(
    'tolerates trailing junk in %s',
    (hash) => {
      expect(parseRoute(hash)).toEqual({ kind: 'go', code: 'Ab3dE9x', channel: null })
    },
  )
  it('reads a channel and lowercases it', () => {
    expect(parseRoute('#Ab3dE9x/instagram')).toEqual({
      kind: 'go',
      code: 'Ab3dE9x',
      channel: 'instagram',
    })
    expect(parseRoute('#Ab3dE9x/Ig-Story-2')).toEqual({
      kind: 'go',
      code: 'Ab3dE9x',
      channel: 'ig-story-2',
    })
    expect(parseRoute(`#Ab3dE9x/${'a'.repeat(24)}`)).toMatchObject({ channel: 'a'.repeat(24) })
  })
  it.each([
    '#Ab3dE9x/',
    `#Ab3dE9x/${'a'.repeat(25)}`,
    '#Ab3dE9x/a_b',
    '#Ab3dE9x/a b',
    '#Ab3dE9x/ñ',
    '#Ab3dE9x/a/b',
    '#Ab3dE9x/a?x=1',
  ])('keeps the go route but drops the invalid channel in %s', (hash) => {
    expect(parseRoute(hash)).toEqual({ kind: 'go', code: 'Ab3dE9x', channel: null })
  })
  it('normalizes typed channels', () => {
    expect(normalizeChannel(' Insta Gram!_ ')).toBe('-insta-gram-')
    expect(normalizeChannel('a'.repeat(30))).toBe('a'.repeat(24))
    expect(normalizeChannel('###')).toBe('')
  })
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
  it('adds the channel to the short link', () => {
    expect(shortLink('Ab3dE9x', base, 'instagram')).toBe(
      'https://endika.github.io/txiki/#Ab3dE9x/instagram',
    )
    expect(parseRoute(new URL(shortLink('Ab3dE9x', base, 'tv-1')).hash)).toEqual({
      kind: 'go',
      code: 'Ab3dE9x',
      channel: 'tv-1',
    })
  })
  it('round-trips through parseRoute', () => {
    const hash = new URL(statsLink('Ab3dE9x', TOKEN, base)).hash
    expect(parseRoute(hash)).toEqual({ kind: 'stats', code: 'Ab3dE9x', token: TOKEN })
  })
  it('round-trips statsHash through parseRoute', () => {
    expect(parseRoute(statsHash('Ab3dE9x', TOKEN))).toEqual({
      kind: 'stats',
      code: 'Ab3dE9x',
      token: TOKEN,
    })
  })
})
