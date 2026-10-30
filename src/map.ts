import { formatNumber } from '@/format'

export type ViewBox = [x: number, y: number, width: number, height: number]

export interface World {
  viewBox: ViewBox
  countries: { code: string; d: string }[]
}

export interface MapPoint {
  lat: number
  lon: number
  at: string
}

export interface PointGroup {
  lat: number
  lon: number
  count: number
  lastAt: string
}

const MIN_WIDTH = 8
const MARGIN = 0.3

export function project(lat: number, lon: number): { x: number; y: number } {
  return { x: lon, y: -lat }
}

export function groupPoints(points: MapPoint[]): PointGroup[] {
  const groups = new Map<string, PointGroup>()
  for (const p of points) {
    const lat = Number(p.lat.toFixed(2)) + 0
    const lon = Number(p.lon.toFixed(2)) + 0
    const key = `${lat},${lon}`
    const g = groups.get(key)
    if (!g) groups.set(key, { lat, lon, count: 1, lastAt: p.at })
    else {
      g.count++
      if (Date.parse(p.at) > Date.parse(g.lastAt)) g.lastAt = p.at
    }
  }
  return [...groups.values()].sort(
    (a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt) || a.lat - b.lat || a.lon - b.lon,
  )
}

export function fitViewBox(groups: PointGroup[], world: World): ViewBox {
  if (groups.length === 0) return world.viewBox
  const [wx, wy, ww, wh] = world.viewBox
  const xy = groups.map((g) => project(g.lat, g.lon))
  const minX = Math.min(...xy.map((p) => p.x))
  const maxX = Math.max(...xy.map((p) => p.x))
  const minY = Math.min(...xy.map((p) => p.y))
  const maxY = Math.max(...xy.map((p) => p.y))
  const aspect = ww / wh
  let w = Math.max((maxX - minX) * (1 + MARGIN), MIN_WIDTH)
  let h = w / aspect
  if (h < (maxY - minY) * (1 + MARGIN)) {
    h = (maxY - minY) * (1 + MARGIN)
    w = h * aspect
  }
  if (w >= ww || h >= wh) return world.viewBox
  const x = Math.min(Math.max((minX + maxX) / 2 - w / 2, wx), wx + ww - w)
  const y = Math.min(Math.max((minY + maxY) / 2 - h / 2, wy), wy + wh - h)
  return [x, y, w, h]
}

export function tier(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0 || max <= 0) return 0
  return Math.min(4, Math.max(1, Math.ceil((count / max) * 4))) as 1 | 2 | 3 | 4
}

const TIERS = [1, 2, 3, 4] as const
const MIN_DOT = 12
const MAX_DOT = 24

export function tierRanges(max: number): { tier: number; label: string }[] {
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

export function dotSize(count: number): number {
  return Math.min(MAX_DOT, Math.round(MIN_DOT + 4 * Math.log2(count)))
}
