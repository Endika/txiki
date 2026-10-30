import { describe, expect, it } from 'vitest'
import { barList, dayLine, hourColumns } from '@/charts'

const label = (k: string | null): string => (k === null ? 'none' : k)
const columnOpts = { summary: 'Clicks', label: (i: number, v: number) => `${i}: ${v}` }

describe('barList', () => {
  it('groups the tail of 12 keys into one “Otros” row with the sum', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ key: `k${i}`, count: 12 - i }))
    const rows = barList(items, { label, otherLabel: 'Otros', max: 8 }).querySelectorAll('li')
    expect(rows).toHaveLength(8)
    expect(rows[7]!.querySelector('.name')!.textContent).toBe('Otros')
    const tail = items.slice(7).reduce((sum, i) => sum + i.count, 0)
    expect(rows[7]!.querySelector('.v')!.textContent).toContain(String(tail))
  })

  it('shows everything when it fits and uses the default of 8', () => {
    const items = Array.from({ length: 8 }, (_, i) => ({ key: `k${i}`, count: 1 }))
    expect(barList(items, { label }).querySelectorAll('li')).toHaveLength(8)
    expect(
      barList([...items, { key: 'k8', count: 1 }], { label }).querySelectorAll('li'),
    ).toHaveLength(8)
  })

  it('renders the server’s __other__ bucket as “Otros” and merges it with the overflow', () => {
    const rows = barList(
      [
        { key: 'a', count: 5 },
        { key: '__other__', count: 3 },
      ],
      { label, otherLabel: 'Otros' },
    ).querySelectorAll('li')
    expect(rows).toHaveLength(2)
    expect(rows[1]!.querySelector('.name')!.textContent).toBe('Otros')
    const merged = barList(
      Array.from({ length: 9 }, (_, i) => ({ key: `k${i}`, count: 1 })).concat([
        { key: '__other__', count: 10 },
      ]),
      { label, otherLabel: 'Otros', max: 3 },
    ).querySelectorAll('li')
    expect(merged).toHaveLength(3)
    expect(merged[2]!.querySelector('.v')!.textContent).toContain('17')
  })

  it('labels null keys, shows shares and sizes the bars by share', () => {
    const list = barList(
      [
        { key: null, count: 3 },
        { key: 'x', count: 1 },
      ],
      { label: (k) => (k === null ? 'Directo' : k), locale: 'es' },
    )
    expect(list.querySelector('.name')!.textContent).toBe('Directo')
    expect(list.querySelector('.pct')!.textContent).toMatch(/75\s?%/)
    expect(list.querySelector<HTMLElement>('em')!.style.width).toBe('75%')
    expect(list.querySelector('em')!.getAttribute('aria-hidden')).toBe('true')
  })

  it('never shows 0 % for a real count', () => {
    const list = barList(
      [
        { key: 'a', count: 1000 },
        { key: 'b', count: 1 },
      ],
      { label },
    )
    expect(list.querySelectorAll('.pct')[1]!.textContent).toBe('<1 %')
  })

  it('is empty for no items', () => {
    expect(barList([], { label }).children).toHaveLength(0)
  })
})

describe('hourColumns', () => {
  it('draws 24 columns with a text equivalent', () => {
    const byHour = new Array<number>(24).fill(0)
    byHour[9] = 2
    byHour[16] = 3
    const svg = hourColumns(byHour, columnOpts)
    expect(svg.querySelectorAll('rect')).toHaveLength(24)
    expect(svg.getAttribute('role')).toBe('img')
    expect(svg.getAttribute('aria-label')).toBe('Clicks. 9: 2; 16: 3')
    expect(svg.querySelectorAll('rect.z')).toHaveLength(22)
    expect(svg.querySelectorAll('rect.on')).toHaveLength(2)
  })

  it('requires exactly 24 values', () => {
    expect(() => hourColumns([1, 2, 3], columnOpts)).toThrow()
    expect(() => hourColumns(new Array<number>(25).fill(0), columnOpts)).toThrow()
  })

  it('scales to the tallest column and keeps zeros visible but short', () => {
    const byHour = new Array<number>(24).fill(0)
    byHour[0] = 4
    byHour[1] = 2
    const rects = hourColumns(byHour, columnOpts).querySelectorAll('rect')
    expect(rects[0]!.getAttribute('height')).toBe('100')
    expect(rects[1]!.getAttribute('height')).toBe('50')
    expect(Number(rects[2]!.getAttribute('height'))).toBeGreaterThan(0)
    expect(Number(rects[2]!.getAttribute('height'))).toBeLessThan(5)
  })
})

describe('dayLine', () => {
  const dayOpts = { summary: 'Days', label: (d: string, v: number) => `${d}: ${v}` }

  it('fills the days without clicks between the first and last day', () => {
    const svg = dayLine(
      [
        { day: '2026-10-01', count: 2 },
        { day: '2026-10-04', count: 1 },
      ],
      dayOpts,
    )
    expect(svg.querySelectorAll('rect')).toHaveLength(4)
    expect(svg.querySelectorAll('rect.z')).toHaveLength(2)
  })

  it('covers a fixed window ending at the given day and drops older clicks', () => {
    const svg = dayLine(
      [
        { day: '2026-09-01', count: 9 },
        { day: '2026-10-30', count: 1 },
      ],
      { ...dayOpts, days: 14, end: '2026-10-30' },
    )
    expect(svg.querySelectorAll('rect')).toHaveLength(14)
    expect(svg.querySelectorAll('rect.on')).toHaveLength(1)
    expect(svg.getAttribute('aria-label')).toBe('Days. 2026-10-30: 1')
  })

  it('handles month boundaries and no data', () => {
    const svg = dayLine([], { ...dayOpts, days: 3, end: '2026-03-01' })
    expect([...svg.querySelectorAll('title')].map((t) => t.textContent)).toEqual([
      '2026-02-27: 0',
      '2026-02-28: 0',
      '2026-03-01: 0',
    ])
    expect(dayLine([], dayOpts).querySelectorAll('rect')).toHaveLength(0)
  })
})
