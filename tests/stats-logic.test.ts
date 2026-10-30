import { beforeEach, describe, expect, it } from 'vitest'
import { setLocale } from '@/i18n'
import { lastClickSentence, pairClicksWithPoints } from '@/stats-logic'

const NOW = new Date(2026, 9, 30, 12, 0, 0).getTime()
const TWO_HOURS_AGO = new Date(NOW - 2 * 3600_000).toISOString()

function click(over: Partial<Parameters<typeof pairClicksWithPoints>[0][number]> = {}) {
  return {
    at: '2026-10-30T09:00:00.000Z',
    country: 'ES',
    browser: 'Safari',
    os: 'iOS',
    device: 'mobile',
    referrerHost: null,
    network: null,
    city: null,
    channel: null,
    ...over,
  }
}

beforeEach(() => setLocale('es'))

describe('lastClickSentence', () => {
  it.each([
    [
      'country and device',
      { country: 'ES', device: 'mobile' },
      'La última, hace 2 h, desde España en un móvil.',
    ],
    ['country only', { country: 'ES', device: 'toaster' }, 'La última, hace 2 h, desde España.'],
    ['device only', { country: null, device: 'mobile' }, 'La última, hace 2 h, en un móvil.'],
    ['neither', { country: null, device: 'toaster' }, 'La última, hace 2 h.'],
  ])('with %s', (_name, over, expected) => {
    const stats = { lastAt: TWO_HOURS_AGO, recent: [click(over)] }
    expect(lastClickSentence(stats, NOW)).toBe(expected)
  })

  it('falls back to the time alone without a recent click', () => {
    expect(lastClickSentence({ lastAt: TWO_HOURS_AGO, recent: [] }, NOW)).toBe(
      'La última, hace 2 h.',
    )
  })

  it('is null when nobody has clicked', () => {
    expect(lastClickSentence({ lastAt: null, recent: [] }, NOW)).toBeNull()
  })
})

describe('pairClicksWithPoints', () => {
  const at1 = '2026-10-30T09:00:00.000Z'
  const at2 = '2026-10-30T10:00:00.000Z'
  const at3 = '2026-10-29T10:00:00.000Z'

  it('attaches the point recorded at the same instant and leaves the rest unmatched', () => {
    const p1 = { lat: 40, lon: -3, at: at1 }
    const p3 = { lat: 41, lon: 2, at: at3 }
    const recent = [click({ at: at1 }), click({ at: at2 })]
    expect(pairClicksWithPoints(recent, [p1, p3])).toEqual({
      clicks: [
        { click: recent[0], point: p1 },
        { click: recent[1], point: null },
      ],
      unmatched: [p3],
    })
  })

  it('is empty for no data', () => {
    expect(pairClicksWithPoints([], [])).toEqual({ clicks: [], unmatched: [] })
  })
})
