import { referrerHost } from '../supabase/functions/_shared/request.ts'
import { CaptchaError, InvalidUrlError, type ClickResult, type Stats, type TxikiApi } from '@/api'

type FakeClick = { at: string; lang: string; tz: string; referrer: string }

export type FakeLink = {
  code: string
  token: string
  target: string
  askLocation: boolean
  createdAt: string
  clicks: FakeClick[]
  points: { lat: number; lon: number; at: string }[]
}

export type FakeApi = TxikiApi & {
  links(): ReadonlyMap<string, Readonly<FakeLink>>
  failNext(error: Error): void
}

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const LOCATION_WINDOW_MS = 10 * 60 * 1000

function random(alphabet: string, length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

function validTarget(url: string): boolean {
  if (url.length > 2048) return false
  try {
    const parsed = new URL(url.trim())
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    return !parsed.username && !parsed.password
  } catch {
    return false
  }
}

function tally(values: (string | null)[]): { key: string | null; count: number }[] {
  const map = new Map<string | null, number>()
  for (const v of values) map.set(v, (map.get(v) ?? 0) + 1)
  return [...map]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)))
}

export function createFakeApi(options: { now?: () => number } = {}): FakeApi {
  const now = options.now ?? Date.now
  const links = new Map<string, FakeLink>()
  const locationTokens = new Map<string, { link: FakeLink; expiresAt: number }>()
  let pendingFailure: Error | undefined

  function takeFailure(): void {
    if (!pendingFailure) return
    const error = pendingFailure
    pendingFailure = undefined
    throw error
  }

  function owned(code: string, token: string): FakeLink | undefined {
    const link = links.get(code)
    return link && link.token === token ? link : undefined
  }

  return {
    links: () => links,
    failNext(error) {
      pendingFailure = error
    },
    async create(url, askLocation, turnstileToken) {
      takeFailure()
      if (!validTarget(url)) throw new InvalidUrlError()
      if (!turnstileToken) throw new CaptchaError()
      let code = random(B62, 7)
      while (links.has(code)) code = random(B62, 7)
      const token = random(B64URL, 43)
      links.set(code, {
        code,
        token,
        target: new URL(url.trim()).href,
        askLocation,
        createdAt: new Date(now()).toISOString(),
        clicks: [],
        points: [],
      })
      return { code, token }
    },
    async click(code, ctx): Promise<ClickResult | null> {
      takeFailure()
      const link = links.get(code)
      if (!link) return null
      link.clicks.push({
        at: new Date(now()).toISOString(),
        ...ctx,
        referrer: referrerHost(ctx.referrer) ?? '',
      })
      let locationToken: string | null = null
      if (link.askLocation) {
        locationToken = random(B64URL, 43)
        locationTokens.set(locationToken, { link, expiresAt: now() + LOCATION_WINDOW_MS })
      }
      return { target: link.target, askLocation: link.askLocation, locationToken }
    },
    async addLocation(token, lat, lon) {
      takeFailure()
      const entry = locationTokens.get(token)
      if (!entry || entry.expiresAt <= now()) return false
      if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) return false
      locationTokens.delete(token)
      entry.link.points.unshift({
        lat: Math.round(lat * 100) / 100,
        lon: Math.round(lon * 100) / 100,
        at: new Date(now()).toISOString(),
      })
      return true
    },
    async stats(code, token): Promise<Stats | null> {
      takeFailure()
      const link = owned(code, token)
      if (!link) return null
      const byDay = new Map<string, number>()
      const byHour = new Array<number>(24).fill(0)
      for (const c of link.clicks) {
        const day = c.at.slice(0, 10)
        byDay.set(day, (byDay.get(day) ?? 0) + 1)
        const hour = new Date(c.at).getUTCHours()
        byHour[hour] = (byHour[hour] ?? 0) + 1
      }
      return {
        target: link.target,
        createdAt: link.createdAt,
        askLocation: link.askLocation,
        disabled: false,
        total: link.clicks.length,
        uniques: link.clicks.length,
        firstAt: link.clicks[0]?.at ?? null,
        lastAt: link.clicks.at(-1)?.at ?? null,
        byDay: [...byDay].sort().map(([day, count]) => ({ day, count })),
        byHour,
        countries: [],
        browsers: tally(link.clicks.map(() => 'Other')),
        os: tally(link.clicks.map(() => 'Other')),
        devices: tally(link.clicks.map(() => 'desktop')),
        referrers: tally(link.clicks.map((c) => c.referrer || null)),
        langs: tally(link.clicks.map((c) => c.lang || null)),
        recent: link.clicks
          .slice(-50)
          .reverse()
          .map((c) => ({
            at: c.at,
            country: null,
            browser: 'Other',
            os: 'Other',
            device: 'desktop',
            referrerHost: c.referrer || null,
          })),
        points: link.points.slice(0, 500),
      }
    },
    async remove(code, token) {
      takeFailure()
      if (!owned(code, token)) return false
      links.delete(code)
      return true
    },
  }
}
