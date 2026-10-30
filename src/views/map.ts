import type { Stats } from '@/api'
import { OTHER_KEY } from '@/charts'
import { h } from '@/dom'
import { clockTime, countryName, formatNumber } from '@/format'
import { t, tCount } from '@/i18n'
import {
  fitViewBox,
  groupPoints,
  project,
  tier,
  type PointGroup,
  type ViewBox,
  type World,
} from '@/map'

const SVG_NS = 'http://www.w3.org/2000/svg'
const TIERS = [1, 2, 3, 4] as const
const MIN_DOT = 12
const MAX_DOT = 24
const GAP = 8

export function osmLink(lat: number, lon: number, text: string): HTMLAnchorElement {
  const la = lat.toFixed(2)
  const lo = lon.toFixed(2)
  return h(
    'a',
    {
      href: `https://www.openstreetmap.org/?mlat=${la}&mlon=${lo}#map=13/${la}/${lo}`,
      target: '_blank',
      rel: 'noopener noreferrer',
    },
    text,
  )
}

export interface WorldMap {
  el: HTMLElement
  dispose: () => void
}

interface Painted {
  code: string
  name: string
  count: number
}

function paintedCountries(stats: Pick<Stats, 'countries'>, world: World): Painted[] {
  const known = new Set(world.countries.map((c) => c.code))
  const out: Painted[] = []
  for (const c of stats.countries) {
    if (c.key === null || c.key === OTHER_KEY || !known.has(c.key)) continue
    out.push({ code: c.key, name: countryName(c.key) ?? c.key, count: c.count })
  }
  return out
}

function summary(countries: number, places: number): string {
  const parts: string[] = []
  if (countries > 0) parts.push(tCount('mapInCountries', countries))
  if (places > 0) parts.push(tCount('mapInPlaces', places))
  return `${t('mapSummaryLead')} ${parts.join(` ${t('mapAnd')} `)}`
}

function tierRanges(max: number): { tier: number; label: string }[] {
  const out: { tier: number; label: string }[] = []
  for (const n of TIERS) {
    const lo = Math.floor(((n - 1) * max) / 4) + 1
    const hi = Math.floor((n * max) / 4)
    if (hi < lo) continue
    const label = lo === hi ? formatNumber(lo) : `${formatNumber(lo)}–${formatNumber(hi)}`
    out.push({ tier: n, label })
  }
  return out
}

function svgEl(tag: string, attrs: Record<string, string>): SVGElement {
  const el = document.createElementNS(SVG_NS, tag)
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value)
  return el
}

function dotSize(count: number): number {
  return Math.min(MAX_DOT, Math.round(MIN_DOT + 4 * Math.log2(count)))
}

function sameView(a: ViewBox, b: ViewBox): boolean {
  return a.every((v, i) => v === b[i])
}

export function worldMap(
  stats: Pick<Stats, 'countries' | 'points'>,
  world: World,
  now: number,
): WorldMap | null {
  const painted = paintedCountries(stats, world)
  const groups = groupPoints(stats.points)
  if (painted.length === 0 && groups.length === 0) return null

  const max = Math.max(0, ...painted.map((c) => c.count))
  const byCode = new Map(painted.map((c) => [c.code, c]))
  const fit = fitViewBox(groups, world)
  let view: ViewBox = fit

  const svg = svgEl('svg', {
    class: 'map-svg',
    role: 'img',
    'aria-label': summary(painted.length, groups.length),
    viewBox: view.join(' '),
  })
  for (const c of world.countries) {
    const hit = byCode.get(c.code)
    const path = svgEl('path', { d: c.d, class: `land t${hit ? tier(hit.count, max) : 0}` })
    if (hit) {
      const title = svgEl('title', {})
      title.textContent = `${hit.name}: ${formatNumber(hit.count)}`
      path.append(title)
    }
    svg.append(path)
  }

  const layer = h('div', { class: 'map-points' })
  const stage = h('div', { class: 'map-stage' }, svg, layer)
  const pop = h('div', { class: 'map-pop', role: 'group', hidden: true })
  const wrap = h('div', { class: 'map-wrap' }, stage, pop)

  const buttons = new Map<PointGroup, HTMLButtonElement>()
  let openGroup: PointGroup | null = null

  function place(): void {
    const [vx, vy, vw, vh] = view
    for (const [g, btn] of buttons) {
      const { x, y } = project(g.lat, g.lon)
      btn.style.left = `${(((x - vx) / vw) * 100).toFixed(3)}%`
      btn.style.top = `${(((y - vy) / vh) * 100).toFixed(3)}%`
    }
    svg.setAttribute('viewBox', view.join(' '))
  }

  function describe(g: PointGroup): string {
    const time = clockTime(g.lastAt, now)
    return g.count > 1
      ? t('mapPointMany', { n: formatNumber(g.count), time })
      : t('mapPointOne', { time })
  }

  function position(g: PointGroup): void {
    const W = wrap.clientWidth
    const H = wrap.clientHeight
    if (W === 0) return
    const [vx, vy, vw, vh] = view
    const { x, y } = project(g.lat, g.lon)
    const cx = ((x - vx) / vw) * W
    const cy = ((y - vy) / vh) * H
    const edge = GAP / 2
    const left = Math.min(cx - pop.offsetWidth / 2, W - pop.offsetWidth - edge)
    pop.style.left = `${Math.max(left, edge)}px`
    const clearance = dotSize(g.count) / 2 + edge
    if (cy > H / 2) {
      pop.style.top = 'auto'
      pop.style.bottom = `${H - cy + clearance}px`
    } else {
      pop.style.bottom = 'auto'
      pop.style.top = `${cy + clearance}px`
    }
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') close(true)
  }

  function onPointerDown(event: Event): void {
    const target = event.target as Node
    if (!wrap.isConnected || (!pop.contains(target) && !layer.contains(target))) close(false)
  }

  function close(refocus: boolean): void {
    if (!openGroup) return
    const btn = buttons.get(openGroup)
    btn?.setAttribute('aria-expanded', 'false')
    pop.hidden = true
    pop.replaceChildren()
    openGroup = null
    document.removeEventListener('keydown', onKey)
    document.removeEventListener('pointerdown', onPointerDown)
    if (refocus) btn?.focus()
  }

  function open(g: PointGroup): void {
    close(false)
    openGroup = g
    buttons.get(g)?.setAttribute('aria-expanded', 'true')
    const link = osmLink(g.lat, g.lon, t('mapOpenOsm'))
    pop.replaceChildren(h('p', {}, h('time', { datetime: g.lastAt }, describe(g))), link)
    pop.hidden = false
    position(g)
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointerDown)
    link.focus()
  }

  for (const g of groups) {
    const size = `${dotSize(g.count)}px`
    const btn = h(
      'button',
      {
        type: 'button',
        class: 'map-pt',
        'aria-label': describe(g),
        'aria-expanded': 'false',
        onclick: () => (openGroup === g ? close(true) : open(g)),
      },
      g.count > 1 ? formatNumber(g.count) : null,
    )
    btn.style.width = size
    btn.style.height = size
    buttons.set(g, btn)
    layer.append(btn)
  }
  place()

  const legendItems = [
    painted.length > 0 ? h('li', { class: 'lt' }, t('mapLegendTitle')) : null,
    painted.length > 0 ? h('li', {}, h('i', { class: 'sw t0' }), t('mapLegendNone')) : null,
    ...(painted.length > 0
      ? tierRanges(max).map((r) => h('li', {}, h('i', { class: `sw t${r.tier}` }), r.label))
      : []),
    groups.length > 0 ? h('li', {}, h('i', { class: 'sw pt' }), t('mapLegendPoint')) : null,
  ]

  let toggle: HTMLButtonElement | null = null
  if (groups.length > 0 && !sameView(fit, world.viewBox)) {
    toggle = h('button', { type: 'button', class: 'link-btn' }, t('mapShowWorld'))
    const button = toggle
    button.addEventListener('click', () => {
      close(false)
      const zoomed = sameView(view, fit)
      view = zoomed ? world.viewBox : fit
      button.textContent = zoomed ? t('mapShowPoints') : t('mapShowWorld')
      place()
    })
  }

  const el = h(
    'div',
    { class: 'map' },
    wrap,
    h('div', { class: 'map-foot' }, h('ul', { class: 'map-legend' }, ...legendItems), toggle),
  )
  return { el, dispose: () => close(false) }
}
