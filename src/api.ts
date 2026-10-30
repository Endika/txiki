export type ClickResult = {
  target: string
  askLocation: boolean
  locationToken: string | null
}

export type Count = { key: string | null; count: number }

export type Stats = {
  target: string
  createdAt: string
  askLocation: boolean
  disabled: boolean
  total: number
  uniques: number
  firstAt: string | null
  lastAt: string | null
  byDay: { day: string; count: number }[]
  byHour: number[]
  countries: Count[]
  browsers: Count[]
  os: Count[]
  devices: Count[]
  referrers: Count[]
  langs: Count[]
  recent: {
    at: string
    country: string | null
    browser: string
    os: string
    device: string
    referrerHost: string | null
  }[]
  points: { lat: number; lon: number; at: string }[]
}

export interface TxikiApi {
  create(
    url: string,
    askLocation: boolean,
    turnstileToken: string,
  ): Promise<{ code: string; token: string }>
  click(
    code: string,
    ctx: { lang: string; tz: string; referrer: string },
  ): Promise<ClickResult | null>
  addLocation(token: string, lat: number, lon: number): Promise<boolean>
  stats(code: string, token: string, tz: string): Promise<Stats | null>
  remove(code: string, token: string): Promise<boolean>
}

export class NetworkError extends Error {
  constructor(options?: ErrorOptions) {
    super('Network or server error', options)
    this.name = 'NetworkError'
  }
}

export class RequestError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`Request rejected (${status})`)
    this.name = 'RequestError'
    this.status = status
  }
}

export class CaptchaError extends Error {
  constructor() {
    super('Captcha verification failed')
    this.name = 'CaptchaError'
  }
}

export class RateLimitedError extends Error {
  constructor() {
    super('Too many requests')
    this.name = 'RateLimitedError'
  }
}

export class CapacityError extends Error {
  constructor() {
    super('The service is at capacity')
    this.name = 'CapacityError'
  }
}

export class InvalidUrlError extends Error {
  constructor() {
    super('Invalid URL')
    this.name = 'InvalidUrlError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function bad(): never {
  throw new Error('invalid stats')
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : bad()
}

function strOrNull(v: unknown): string | null {
  return v === null ? null : str(v)
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : bad()
}

function bool(v: unknown): boolean {
  return typeof v === 'boolean' ? v : bad()
}

function rec(v: unknown): Record<string, unknown> {
  return isRecord(v) ? v : bad()
}

function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : bad()
}

function counts(v: unknown): Count[] {
  return list(v).map((e) => {
    const r = rec(e)
    return { key: strOrNull(r.key), count: num(r.count) }
  })
}

export function parseStats(raw: unknown): Stats {
  const r = rec(raw)
  const byHour = list(r.by_hour).map(num)
  if (byHour.length !== 24) bad()
  return {
    target: str(r.target),
    createdAt: str(r.created_at),
    askLocation: bool(r.ask_location),
    disabled: bool(r.disabled),
    total: num(r.total),
    uniques: num(r.uniques),
    firstAt: strOrNull(r.first_at),
    lastAt: strOrNull(r.last_at),
    byDay: list(r.by_day).map((e) => {
      const d = rec(e)
      return { day: str(d.day), count: num(d.count) }
    }),
    byHour,
    countries: counts(r.countries),
    browsers: counts(r.browsers),
    os: counts(r.os),
    devices: counts(r.devices),
    referrers: counts(r.referrers),
    langs: counts(r.langs),
    recent: list(r.recent).map((e) => {
      const c = rec(e)
      return {
        at: str(c.at),
        country: strOrNull(c.country),
        browser: str(c.browser),
        os: str(c.os),
        device: str(c.device),
        referrerHost: strOrNull(c.referrer_host),
      }
    }),
    points: list(r.points).map((e) => {
      const p = rec(e)
      return { lat: num(p.lat), lon: num(p.lon), at: str(p.at) }
    }),
  }
}

const CODE = /^[0-9A-Za-z]{7}$/
const TOKEN = /^[A-Za-z0-9_-]{43}$/

export function createHttpApi(
  url: string,
  anonKey: string,
  fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
): TxikiApi {
  const base = url.endsWith('/') ? url.slice(0, -1) : url

  async function send(
    target: string,
    init: RequestInit,
  ): Promise<{ status: number; data: unknown }> {
    let response: Response
    try {
      response = await fetchFn(target, {
        method: 'POST',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        credentials: 'omit',
        ...init,
      })
    } catch (cause) {
      throw new NetworkError({ cause })
    }
    if (response.status >= 500 && response.status !== 503) throw new NetworkError()
    let data: unknown = null
    try {
      data = await response.json()
    } catch {
      if (response.ok) throw new NetworkError()
    }
    return { status: response.status, data }
  }

  async function fn(name: string, body: Record<string, unknown>) {
    const res = await send(`${base}/functions/v1/${name}`, {
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(body),
    })
    const code = isRecord(res.data) ? res.data.error : undefined
    return { ...res, code }
  }

  async function rpc(name: string, body: Record<string, unknown>): Promise<unknown> {
    const res = await send(`${base}/rest/v1/rpc/${name}`, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
        'Content-Profile': 'txiki',
        'Accept-Profile': 'txiki',
      },
      body: JSON.stringify(body),
    })
    if (res.status === 503) throw new NetworkError()
    if (res.status >= 400) throw new RequestError(res.status)
    return res.data
  }

  return {
    async create(target, askLocation, turnstileToken) {
      const res = await fn('txiki-create', { url: target, askLocation, turnstileToken })
      if (res.status === 200) {
        const d = res.data
        if (isRecord(d) && typeof d.code === 'string' && typeof d.token === 'string') {
          if (CODE.test(d.code) && TOKEN.test(d.token)) return { code: d.code, token: d.token }
        }
        throw new NetworkError()
      }
      if (res.status === 400 && res.code === 'invalid_url') throw new InvalidUrlError()
      if (res.status === 403 && res.code === 'captcha') throw new CaptchaError()
      if (res.status === 429) throw new RateLimitedError()
      if (res.status === 503) {
        if (res.code === 'capacity') throw new CapacityError()
        throw new NetworkError()
      }
      throw new RequestError(res.status)
    },
    async click(code, ctx) {
      const res = await fn('txiki-click', { code, ...ctx })
      if (res.status === 404) return null
      if (res.status === 503) throw new NetworkError()
      if (res.status !== 200) throw new RequestError(res.status)
      const d = res.data
      if (
        !isRecord(d) ||
        typeof d.target !== 'string' ||
        typeof d.askLocation !== 'boolean' ||
        !(d.locationToken === null || typeof d.locationToken === 'string')
      ) {
        throw new NetworkError()
      }
      try {
        const protocol = new URL(d.target).protocol
        if (protocol !== 'http:' && protocol !== 'https:') throw new Error('protocol')
      } catch (cause) {
        throw new NetworkError({ cause })
      }
      return { target: d.target, askLocation: d.askLocation, locationToken: d.locationToken }
    },
    async addLocation(token, lat, lon) {
      const data = await rpc('add_location', { p_token: token, p_lat: lat, p_lon: lon })
      if (typeof data !== 'boolean') throw new NetworkError()
      return data
    },
    async stats(code, token, tz) {
      const data = await rpc('link_stats', { p_code: code, p_token: token, p_tz: tz })
      if (data === null) return null
      try {
        return parseStats(data)
      } catch (cause) {
        throw new NetworkError({ cause })
      }
    },
    async remove(code, token) {
      const data = await rpc('delete_link', { p_code: code, p_token: token })
      if (typeof data !== 'boolean') throw new NetworkError()
      return data
    },
  }
}
