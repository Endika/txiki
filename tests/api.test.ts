import { describe, expect, it, vi } from 'vitest'
import {
  CapacityError,
  CaptchaError,
  InvalidUrlError,
  NetworkError,
  RateLimitedError,
  RequestError,
  createHttpApi,
  parseStats,
} from '@/api'
import { createFakeApi } from './fake-api'

const URL_ = 'https://proj.supabase.co'
const KEY = 'anon-key'
const CODE = 'Ab3dE9x'
const TOKEN = 'C'.repeat(43)

function reply(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function setup(response: Response | (() => Promise<Response>)) {
  const fetchFn = vi.fn<typeof fetch>(async () =>
    typeof response === 'function' ? response() : response.clone(),
  )
  return { api: createHttpApi(URL_, KEY, fetchFn), fetchFn }
}

const rawStats = () => ({
  target: 'https://example.com/',
  created_at: '2026-10-30T10:00:00Z',
  ask_location: true,
  disabled: false,
  total: 3,
  uniques: 2,
  first_at: '2026-10-30T10:00:00Z',
  last_at: null,
  by_day: [{ day: '2026-10-30', count: 3 }],
  by_hour: Array.from({ length: 24 }, (_, i) => (i === 10 ? 3 : 0)),
  countries: [
    { key: 'ES', count: 2 },
    { key: null, count: 1 },
  ],
  browsers: [
    { key: 'Firefox', count: 2 },
    { key: '__other__', count: 1 },
  ],
  os: [],
  devices: [],
  referrers: [{ key: null, count: 3 }],
  langs: [],
  recent: [
    {
      at: '2026-10-30T10:00:00Z',
      country: null,
      browser: 'Firefox',
      os: 'Linux',
      device: 'desktop',
      referrer_host: null,
    },
  ],
  points: [{ lat: 43.26, lon: -2.93, at: '2026-10-30T10:00:00Z' }],
})

describe('base url', () => {
  it('does not double the slash', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => reply(200, true))
    const api = createHttpApi(`${URL_}/`, KEY, fetchFn)
    await api.remove(CODE, TOKEN)
    expect(fetchFn.mock.calls[0]![0]).toBe(`${URL_}/rest/v1/rpc/delete_link`)
  })
})

describe('create', () => {
  it('posts text/plain without apikey headers', async () => {
    const { api, fetchFn } = setup(reply(200, { code: CODE, token: TOKEN }))
    await expect(api.create('https://example.com', true, 'cf')).resolves.toEqual({
      code: CODE,
      token: TOKEN,
    })
    const [url, init] = fetchFn.mock.calls[0]!
    expect(url).toBe(`${URL_}/functions/v1/txiki-create`)
    const headers = new Headers(init?.headers)
    expect(headers.get('content-type')).toBe('text/plain;charset=UTF-8')
    expect(headers.has('apikey')).toBe(false)
    expect(headers.has('authorization')).toBe(false)
    expect(JSON.parse(init?.body as string)).toEqual({
      url: 'https://example.com',
      askLocation: true,
      turnstileToken: 'cf',
    })
    expect(init?.referrerPolicy).toBe('no-referrer')
    expect(init?.cache).toBe('no-store')
    expect(init?.credentials).toBe('omit')
  })

  it.each([
    [400, { error: 'invalid_url' }, InvalidUrlError],
    [403, { error: 'captcha' }, CaptchaError],
    [429, { error: 'rate_limited' }, RateLimitedError],
    [503, { error: 'capacity' }, CapacityError],
    [503, { error: 'other' }, NetworkError],
    [500, { error: 'server' }, NetworkError],
    [502, undefined, NetworkError],
  ])('maps %i %j', async (status, body, expected) => {
    const { api } = setup(reply(status, body))
    await expect(api.create('https://example.com', false, 'cf')).rejects.toBeInstanceOf(expected)
  })

  it.each([
    [400, { error: 'invalid_request' }],
    [413, { error: 'too_large' }],
  ])('maps %i to RequestError', async (status, body) => {
    const { api } = setup(reply(status, body))
    const err = await api.create('https://example.com', false, 'cf').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RequestError)
    expect((err as RequestError).status).toBe(status)
  })

  it('maps a network failure', async () => {
    const { api } = setup(() => Promise.reject(new TypeError('offline')))
    await expect(api.create('https://example.com', false, 'cf')).rejects.toBeInstanceOf(
      NetworkError,
    )
  })

  it('rejects a malformed success body', async () => {
    const { api } = setup(reply(200, { code: 'x', token: 'y' }))
    await expect(api.create('https://example.com', false, 'cf')).rejects.toBeInstanceOf(
      NetworkError,
    )
  })
})

describe('click', () => {
  it('posts text/plain and parses the result', async () => {
    const { api, fetchFn } = setup(
      reply(200, { target: 'https://example.com/', askLocation: true, locationToken: TOKEN }),
    )
    const ctx = { lang: 'es', tz: 'Europe/Madrid', referrer: '' }
    await expect(api.click(CODE, ctx)).resolves.toEqual({
      target: 'https://example.com/',
      askLocation: true,
      locationToken: TOKEN,
    })
    const [url, init] = fetchFn.mock.calls[0]!
    expect(url).toBe(`${URL_}/functions/v1/txiki-click`)
    const headers = new Headers(init?.headers)
    expect(headers.get('content-type')).toBe('text/plain;charset=UTF-8')
    expect(headers.has('apikey')).toBe(false)
    expect(headers.has('authorization')).toBe(false)
    expect(JSON.parse(init?.body as string)).toEqual({ code: CODE, ...ctx })
  })

  it('returns null on 404', async () => {
    const { api } = setup(reply(404, { error: 'not_found' }))
    await expect(api.click(CODE, { lang: '', tz: '', referrer: '' })).resolves.toBeNull()
  })

  it('maps 5xx and network failures to NetworkError', async () => {
    const ctx = { lang: '', tz: '', referrer: '' }
    await expect(
      setup(reply(500, { error: 'server' })).api.click(CODE, ctx),
    ).rejects.toBeInstanceOf(NetworkError)
    await expect(
      setup(() => Promise.reject(new TypeError('x'))).api.click(CODE, ctx),
    ).rejects.toBeInstanceOf(NetworkError)
  })

  it('rejects a malformed or non-http target', async () => {
    const ctx = { lang: '', tz: '', referrer: '' }
    for (const body of [
      { target: 'https://e.com/', askLocation: 'yes', locationToken: null },
      { target: 'javascript:alert(1)', askLocation: false, locationToken: null },
      { target: 'not a url', askLocation: false, locationToken: null },
    ]) {
      await expect(setup(reply(200, body)).api.click(CODE, ctx)).rejects.toBeInstanceOf(
        NetworkError,
      )
    }
  })

  it('maps 413 to RequestError', async () => {
    const { api } = setup(reply(413, { error: 'too_large' }))
    await expect(api.click(CODE, { lang: '', tz: '', referrer: '' })).rejects.toBeInstanceOf(
      RequestError,
    )
  })
})

describe('rpc calls', () => {
  it('sends the profile and key headers', async () => {
    const { api, fetchFn } = setup(reply(200, true))
    await expect(api.remove(CODE, TOKEN)).resolves.toBe(true)
    const [url, init] = fetchFn.mock.calls[0]!
    expect(url).toBe(`${URL_}/rest/v1/rpc/delete_link`)
    const headers = new Headers(init?.headers)
    expect(headers.get('apikey')).toBe(KEY)
    expect(headers.get('authorization')).toBe(`Bearer ${KEY}`)
    expect(headers.get('content-profile')).toBe('txiki')
    expect(headers.get('accept-profile')).toBe('txiki')
    expect(JSON.parse(init?.body as string)).toEqual({ p_code: CODE, p_token: TOKEN })
    expect(init?.referrerPolicy).toBe('no-referrer')
  })

  it('addLocation posts the coordinates', async () => {
    const { api, fetchFn } = setup(reply(200, false))
    await expect(api.addLocation(TOKEN, 1.5, -2.5)).resolves.toBe(false)
    expect(JSON.parse(fetchFn.mock.calls[0]![1]?.body as string)).toEqual({
      p_token: TOKEN,
      p_lat: 1.5,
      p_lon: -2.5,
    })
  })

  it('stats returns null for null and parses data', async () => {
    await expect(setup(reply(200, null)).api.stats(CODE, TOKEN, 'UTC')).resolves.toBeNull()
    const stats = await setup(reply(200, rawStats())).api.stats(CODE, TOKEN, 'UTC')
    expect(stats?.total).toBe(3)
  })

  it('stats maps a malformed body to NetworkError', async () => {
    const raw = rawStats()
    raw.by_hour.pop()
    await expect(setup(reply(200, raw)).api.stats(CODE, TOKEN, 'UTC')).rejects.toBeInstanceOf(
      NetworkError,
    )
  })

  it('maps 503 to NetworkError', async () => {
    await expect(
      setup(reply(503, { message: 'x' })).api.remove(CODE, TOKEN),
    ).rejects.toBeInstanceOf(NetworkError)
  })

  it('maps 4xx to RequestError and 5xx to NetworkError', async () => {
    await expect(
      setup(reply(400, { message: 'x' })).api.remove(CODE, TOKEN),
    ).rejects.toBeInstanceOf(RequestError)
    await expect(
      setup(reply(500, { message: 'x' })).api.remove(CODE, TOKEN),
    ).rejects.toBeInstanceOf(NetworkError)
  })
})

describe('parseStats', () => {
  it('converts to camelCase and keeps __other__ and null keys', () => {
    const s = parseStats(rawStats())
    expect(s.createdAt).toBe('2026-10-30T10:00:00Z')
    expect(s.lastAt).toBeNull()
    expect(s.countries[1]).toEqual({ key: null, count: 1 })
    expect(s.browsers[1]).toEqual({ key: '__other__', count: 1 })
    expect(s.recent[0]?.referrerHost).toBeNull()
    expect(s.points[0]).toEqual({ lat: 43.26, lon: -2.93, at: '2026-10-30T10:00:00Z' })
  })
  it('throws on malformed points and by_day', () => {
    expect(() => parseStats({ ...rawStats(), points: [{ lat: '1' }] })).toThrow()
    expect(() => parseStats({ ...rawStats(), by_day: [{ count: 1 }] })).toThrow()
  })
  it('throws on by_hour with 23 items', () => {
    const raw = rawStats()
    raw.by_hour = raw.by_hour.slice(0, 23)
    expect(() => parseStats(raw)).toThrow()
  })
  it.each([
    null,
    'x',
    [],
    { ...rawStats(), total: '3' },
    { ...rawStats(), countries: [{ count: 1 }] },
  ])('throws on %j', (raw) => {
    expect(() => parseStats(raw)).toThrow()
  })
})

describe('fake api', () => {
  it('creates, clicks, reports stats and removes', async () => {
    const fake = createFakeApi()
    const { code, token } = await fake.create('https://example.com', true, 'cf')
    const click = await fake.click(code, { lang: 'es', tz: 'UTC', referrer: '' })
    expect(click?.locationToken).not.toBeNull()
    await expect(fake.addLocation(click!.locationToken!, 43.2612, -2.9333)).resolves.toBe(true)
    await expect(fake.addLocation(click!.locationToken!, 1, 1)).resolves.toBe(false)
    const stats = await fake.stats(code, token, 'UTC')
    expect(stats?.total).toBe(1)
    expect(stats?.points[0]).toMatchObject({ lat: 43.26, lon: -2.93 })
    await expect(fake.stats(code, 'D'.repeat(43), 'UTC')).resolves.toBeNull()
    await expect(fake.remove(code, token)).resolves.toBe(true)
    await expect(fake.click(code, { lang: '', tz: '', referrer: '' })).resolves.toBeNull()
  })
  it('checks the URL before the captcha and stores only the referrer host', async () => {
    const fake = createFakeApi()
    await expect(fake.create('ftp://x', false, '')).rejects.toBeInstanceOf(InvalidUrlError)
    const { code, token } = await fake.create('https://example.com', false, 'cf')
    await fake.click(code, { lang: '', tz: '', referrer: 'https://news.example.org/a?b=1' })
    const stats = await fake.stats(code, token, 'UTC')
    expect(stats?.recent[0]?.referrerHost).toBe('news.example.org')
  })
  it('rejects bad input and supports failNext', async () => {
    const fake = createFakeApi()
    await expect(fake.create('ftp://x', false, 'cf')).rejects.toBeInstanceOf(InvalidUrlError)
    await expect(fake.create('https://example.com', false, '')).rejects.toBeInstanceOf(CaptchaError)
    fake.failNext(new NetworkError())
    await expect(fake.create('https://example.com', false, 'cf')).rejects.toBeInstanceOf(
      NetworkError,
    )
    await expect(fake.create('https://example.com', false, 'cf')).resolves.toBeDefined()
  })
})
