import { h } from '@/dom'

const SVG_NS = 'http://www.w3.org/2000/svg'
const MIN_HEIGHT = 2

export const OTHER_KEY = '__other__'

export interface BarItem {
  key: string | null
  count: number
}

export interface BarListOptions {
  label: (key: string | null) => string
  otherLabel?: string
  max?: number
  locale?: string
}

function percent(share: number, locale: string | undefined): string {
  if (share > 0 && share < 0.005) return '<1 %'
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(share)
}

export function collapse(items: BarItem[], max: number): BarItem[] {
  const limit = Math.max(2, max)
  const real = items.filter((i) => i.key !== OTHER_KEY)
  let rest = items.filter((i) => i.key === OTHER_KEY).reduce((sum, i) => sum + i.count, 0)
  let shown = real
  if (real.length + (rest > 0 ? 1 : 0) > limit) {
    shown = real.slice(0, limit - 1)
    rest += real.slice(limit - 1).reduce((sum, i) => sum + i.count, 0)
  }
  return rest > 0 ? [...shown, { key: OTHER_KEY, count: rest }] : shown
}

export function barList(items: BarItem[], opts: BarListOptions): HTMLElement {
  const rows = collapse(items, opts.max ?? 8).map((i) => ({
    label: i.key === OTHER_KEY ? (opts.otherLabel ?? opts.label(OTHER_KEY)) : opts.label(i.key),
    count: i.count,
  }))
  const total = rows.reduce((sum, r) => sum + r.count, 0)
  const number = new Intl.NumberFormat(opts.locale)

  const list = h('ul', { class: 'hl' })
  for (const row of rows) {
    const share = total > 0 ? row.count / total : 0
    const bar = h('em', { 'aria-hidden': 'true' })
    bar.style.width = `${Math.max(share * 100, 1).toFixed(1)}%`
    list.append(
      h(
        'li',
        {},
        h('span', { class: 'k' }, h('span', { class: 'name' }, row.label), bar),
        h(
          'span',
          { class: 'v' },
          number.format(row.count),
          h('span', { class: 'pct' }, percent(share, opts.locale)),
        ),
      ),
    )
  }
  return list
}

export interface ColumnOptions {
  summary: string
  label: (index: number, value: number) => string
}

function columns(values: number[], opts: ColumnOptions, className: string): SVGElement {
  const peak = Math.max(...values, 0)
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('class', `cols ${className}`)
  svg.setAttribute('viewBox', `0 0 ${values.length * 10} 100`)
  svg.setAttribute('preserveAspectRatio', 'none')
  svg.setAttribute('role', 'img')
  const described = values
    .map((v, i) => [i, v] as const)
    .filter(([, v]) => v > 0)
    .map(([i, v]) => opts.label(i, v))
  svg.setAttribute('aria-label', [opts.summary, described.join('; ')].filter(Boolean).join('. '))
  values.forEach((value, i) => {
    const height = peak > 0 ? Math.max((value / peak) * 100, MIN_HEIGHT) : MIN_HEIGHT
    const rect = document.createElementNS(SVG_NS, 'rect')
    rect.setAttribute('x', String(i * 10 + 1))
    rect.setAttribute('width', '8')
    rect.setAttribute('y', String(100 - height))
    rect.setAttribute('height', String(height))
    rect.setAttribute('class', value > 0 ? 'on' : 'z')
    const title = document.createElementNS(SVG_NS, 'title')
    title.textContent = opts.label(i, value)
    rect.append(title)
    svg.append(rect)
  })
  return svg
}

export function hourColumns(byHour: number[], opts: ColumnOptions): SVGElement {
  if (byHour.length !== 24) throw new Error('hourColumns needs exactly 24 values')
  return columns(byHour, opts, 'hours')
}

function utc(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export interface DayOptions {
  days?: number
  end?: string
  summary: string
  label: (day: string, value: number) => string
}

export function dayLine(byDay: { day: string; count: number }[], opts: DayOptions): SVGElement {
  const counts = new Map(byDay.map((d) => [d.day, d.count]))
  let first: number
  let last: number
  if (opts.days !== undefined) {
    last = utc(opts.end ?? iso(Date.now()))
    first = last - (opts.days - 1) * 86_400_000
  } else {
    const times = byDay.map((d) => utc(d.day))
    if (times.length === 0) return columns([], { summary: opts.summary, label: () => '' }, 'days')
    first = Math.min(...times)
    last = Math.max(...times)
  }
  const days: string[] = []
  for (let t = first; t <= last; t += 86_400_000) days.push(iso(t))
  return columns(
    days.map((d) => counts.get(d) ?? 0),
    { summary: opts.summary, label: (i, v) => opts.label(days[i] ?? '', v) },
    'days',
  )
}
