import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadLinks, removeLink, saveLink, type SavedLink } from '@/storage'

const link = (code: string): SavedLink => ({
  code,
  token: 'B'.repeat(43),
  target: 'https://example.com/',
  createdAt: '2026-10-30T10:00:00Z',
})

beforeEach(() => localStorage.clear())

describe('loadLinks', () => {
  it('returns [] when empty', () => {
    expect(loadLinks(localStorage)).toEqual([])
  })
  it('survives invalid JSON', () => {
    localStorage.setItem('txiki.links', '{')
    expect(loadLinks(localStorage)).toEqual([])
  })
  it('ignores non-arrays', () => {
    localStorage.setItem('txiki.links', '{"a":1}')
    expect(loadLinks(localStorage)).toEqual([])
  })
  it('keeps only valid entries', () => {
    const good = link('Ab3dE9x')
    const { token: _token, ...noToken } = link('Cd4eF0y')
    void _token
    localStorage.setItem('txiki.links', JSON.stringify([good, noToken, null, 7, link('short')]))
    expect(loadLinks(localStorage)).toEqual([good])
  })
  it('drops entries with a bad token', () => {
    const short = { ...link('Ab3dE9x'), token: 'B'.repeat(42) }
    const padded = { ...link('Cd4eF0y'), token: `${'B'.repeat(42)}=` }
    localStorage.setItem('txiki.links', JSON.stringify([short, padded]))
    expect(loadLinks(localStorage)).toEqual([])
  })
  it('drops unknown fields', () => {
    localStorage.setItem('txiki.links', JSON.stringify([{ ...link('Ab3dE9x'), extra: 1 }]))
    expect(loadLinks(localStorage)[0]).toEqual(link('Ab3dE9x'))
  })
  it('never throws when getItem throws', () => {
    const broken = {
      getItem() {
        throw new Error('denied')
      },
    } as unknown as Storage
    expect(loadLinks(broken)).toEqual([])
  })
})

describe('saveLink', () => {
  it('stores and dedupes by code', () => {
    expect(saveLink(localStorage, link('Ab3dE9x'))).toBe(true)
    expect(saveLink(localStorage, link('Ab3dE9x'))).toBe(true)
    expect(loadLinks(localStorage)).toHaveLength(1)
  })
  it('puts the newest first', () => {
    saveLink(localStorage, link('Ab3dE9x'))
    saveLink(localStorage, link('Cd4eF0y'))
    expect(loadLinks(localStorage).map((l) => l.code)).toEqual(['Cd4eF0y', 'Ab3dE9x'])
  })
  it('does not write and returns false when reading throws', () => {
    const setItem = vi.fn()
    const broken = {
      getItem() {
        throw new Error('denied')
      },
      setItem,
    } as unknown as Storage
    expect(saveLink(broken, link('Ab3dE9x'))).toBe(false)
    expect(setItem).not.toHaveBeenCalled()
  })
  it('refuses an invalid link', () => {
    expect(saveLink(localStorage, { ...link('Ab3dE9x'), token: 'x' })).toBe(false)
    expect(saveLink(localStorage, link('bad'))).toBe(false)
    expect(loadLinks(localStorage)).toEqual([])
  })
  it('returns false when storage fails', () => {
    const broken = {
      getItem: () => null,
      setItem() {
        throw new Error('quota')
      },
    } as unknown as Storage
    expect(saveLink(broken, link('Ab3dE9x'))).toBe(false)
  })
})

describe('removeLink', () => {
  it('removes by code', () => {
    saveLink(localStorage, link('Ab3dE9x'))
    saveLink(localStorage, link('Cd4eF0y'))
    removeLink(localStorage, 'Ab3dE9x')
    expect(loadLinks(localStorage).map((l) => l.code)).toEqual(['Cd4eF0y'])
  })
})
