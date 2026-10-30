import { afterEach, describe, expect, it, vi } from 'vitest'
import { RPC_ERRORS } from '../../supabase/functions/_shared/rpc-errors'
import { handleClick, handleCreate, type Deps } from '../../supabase/functions/_shared/handlers'

const IPV4 = '203.0.113.7'
const IPV6 = '2001:db8::7'
const ORIGIN = 'https://endika.github.io'

type Call = { name: string; args: Record<string, unknown> }

function makeDeps(over: Partial<Deps> = {}) {
  const calls: Call[] = []
  const deps: Deps = {
    rpc: async (name, args) => {
      calls.push({ name, args })
      return name === 'create_link'
        ? [{ code: 'abc1234', token: 'tok' }]
        : [{ target: 'https://example.com/', ask_location: true, location_token: 'loc' }]
    },
    verifyTurnstile: async () => true,
    country: () => 'ES',
    ...over,
  }
  return { deps, calls }
}

function post(body: unknown, headers: Record<string, string> = {}, raw = false): Request {
  return new Request('https://f.example/fn', {
    method: 'POST',
    headers: { origin: ORIGIN, 'cf-connecting-ip': IPV4, ...headers },
    body: raw ? (body as string) : JSON.stringify(body),
  })
}

const createBody = { url: 'https://example.com/a', askLocation: false, turnstileToken: 't' }

function rpcFails(message: string): Partial<Deps> {
  return {
    rpc: async () => {
      throw new Error(message)
    },
  }
}

describe('handleCreate', () => {
  it('passes p_ask_location false through', async () => {
    const { deps, calls } = makeDeps()
    await handleCreate(post(createBody), deps)
    expect(calls[0]?.args.p_ask_location).toBe(false)
  })

  it('creates a link and passes the contract args to the rpc', async () => {
    const { deps, calls } = makeDeps()
    const res = await handleCreate(post({ ...createBody, askLocation: true }), deps)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ code: 'abc1234', token: 'tok' })
    expect(calls).toEqual([
      {
        name: 'create_link',
        args: { p_target: 'https://example.com/a', p_ask_location: true, p_ip: IPV4 },
      },
    ])
    expect(res.headers.get('Content-Type')).toBe('application/json')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
  })

  it('accepts text/plain bodies', async () => {
    const { deps } = makeDeps()
    const res = await handleCreate(post(createBody, { 'content-type': 'text/plain' }), deps)
    expect(res.status).toBe(200)
  })

  it('normalises the url with trim and href', async () => {
    const { deps, calls } = makeDeps()
    await handleCreate(post({ ...createBody, url: '  https://Example.com  ' }), deps)
    expect(calls[0]?.args.p_target).toBe('https://example.com/')
  })

  it('pins whitespace trimming', async () => {
    const { deps, calls } = makeDeps()
    await handleCreate(post({ ...createBody, url: '  https://x.com  ' }), deps)
    expect(calls[0]?.args.p_target).toBe('https://x.com/')
  })

  it('rejects urls with credentials', async () => {
    for (const url of ['https://user:pass@x.com/', 'https://endika.github.io@evil.com/']) {
      const { deps, calls } = makeDeps()
      const res = await handleCreate(post({ ...createBody, url }), deps)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid_url' })
      expect(calls).toHaveLength(0)
    }
  })

  it.each([
    ['row without token', [{ code: 'abc1234' }]],
    ['non-string code', [{ code: 5, token: 't' }]],
    ['non-array', { code: 'abc1234', token: 't' }],
    ['empty array', []],
  ])('returns 500 for a bad rpc response: %s', async (_n, data) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { deps } = makeDeps({ rpc: async () => data })
    const res = await handleCreate(post(createBody), deps)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'server' })
  })

  it('rejects non-http urls and garbage', async () => {
    for (const url of ['javascript:alert(1)', 'ftp://x.com/', 'not a url', '']) {
      const { deps, calls } = makeDeps()
      const res = await handleCreate(post({ ...createBody, url }), deps)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid_url' })
      expect(calls).toHaveLength(0)
    }
  })

  it('rejects bad json and wrong types', async () => {
    for (const [body, raw] of [
      ['{', true],
      [{ ...createBody, url: 5 }, false],
      [{ ...createBody, askLocation: 'yes' }, false],
      [{ ...createBody, turnstileToken: undefined }, false],
      [null, false],
    ] as const) {
      const { deps, calls } = makeDeps()
      const res = await handleCreate(post(body, {}, raw), deps)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid_request' })
      expect(calls).toHaveLength(0)
    }
  })

  it('returns 403 and skips the rpc when captcha fails', async () => {
    const { deps, calls } = makeDeps({ verifyTurnstile: async () => false })
    const res = await handleCreate(post(createBody), deps)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'captcha' })
    expect(calls).toHaveLength(0)
  })

  it('passes token and ip to the captcha verifier', async () => {
    const verifyTurnstile = vi.fn(async () => true)
    const { deps } = makeDeps({ verifyTurnstile })
    await handleCreate(post(createBody), deps)
    expect(verifyTurnstile).toHaveBeenCalledWith('t', IPV4)
  })

  it('returns 400 without calling the rpc when the ip is missing', async () => {
    const { deps, calls } = makeDeps()
    const req = new Request('https://f.example/fn', {
      method: 'POST',
      headers: { origin: ORIGIN },
      body: JSON.stringify(createBody),
    })
    const res = await handleCreate(req, deps)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_request' })
    expect(calls).toHaveLength(0)
  })

  it.each([
    [RPC_ERRORS.invalidTarget, 400, 'invalid_url'],
    [RPC_ERRORS.rateLimited, 429, 'rate_limited'],
    [RPC_ERRORS.capacityReached, 503, 'capacity'],
    ['boom', 500, 'server'],
  ])('maps rpc error %s to %i', async (message, status, error) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { deps } = makeDeps(rpcFails(message))
    const res = await handleCreate(post(createBody), deps)
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ error })
  })

  it('rejects a declared content-length over 8 KB without reading', async () => {
    const { deps, calls } = makeDeps()
    const res = await handleCreate(post(createBody, { 'content-length': '9000' }), deps)
    expect(res.status).toBe(413)
    expect(calls).toHaveLength(0)
  })

  it('stops reading a chunked body once it passes 8 KB', async () => {
    const { deps, calls } = makeDeps()
    let pulled = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++
        controller.enqueue(new Uint8Array(1024).fill(97))
        if (pulled >= 10000) controller.close()
      },
    })
    const req = new Request('https://f.example/fn', {
      method: 'POST',
      headers: { origin: ORIGIN, 'cf-connecting-ip': IPV4 },
      body: stream,
      duplex: 'half',
    } as RequestInit)
    const res = await handleCreate(req, deps)
    expect(res.status).toBe(413)
    expect(pulled).toBeLessThan(20)
    expect(calls).toHaveLength(0)
  })

  it('rejects bodies over 8 KB', async () => {
    const { deps, calls } = makeDeps()
    const res = await handleCreate(
      post({ ...createBody, url: 'https://x.com/' + 'a'.repeat(9000) }),
      deps,
    )
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'too_large' })
    expect(calls).toHaveLength(0)
  })

  it('answers OPTIONS with 204 and the allowed origin', async () => {
    const { deps } = makeDeps()
    const res = await handleCreate(
      new Request('https://f.example/fn', { method: 'OPTIONS', headers: { origin: ORIGIN } }),
      deps,
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
  })

  it('answers other methods with 405', async () => {
    const { deps } = makeDeps()
    const res = await handleCreate(new Request('https://f.example/fn', { method: 'GET' }), deps)
    expect(res.status).toBe(405)
    expect(res.headers.get('Allow')).toBe('POST, OPTIONS')
  })
})

describe('handleClick', () => {
  const UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

  it('records the click with headers-derived fields', async () => {
    const { deps, calls } = makeDeps()
    const res = await handleClick(
      post(
        {
          code: 'abc1234',
          lang: 'es-ES',
          tz: 'Europe/Madrid',
          referrer: 'https://news.example.org/x?y=1',
        },
        { 'user-agent': UA },
      ),
      deps,
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      target: 'https://example.com/',
      askLocation: true,
      locationToken: 'loc',
    })
    expect(calls).toEqual([
      {
        name: 'record_click',
        args: {
          p_code: 'abc1234',
          p_ip: IPV4,
          p_country: 'ES',
          p_browser: 'Safari',
          p_os: 'iOS',
          p_device: 'mobile',
          p_lang: 'es-ES',
          p_tz: 'Europe/Madrid',
          p_referrer_host: 'news.example.org',
          p_bot: false,
          p_model: null,
          p_screen: null,
          p_channel: null,
        },
      },
    ])
  })

  it('passes p_bot true when the page reports webdriver', async () => {
    const { deps, calls } = makeDeps()
    const res = await handleClick(post({ code: 'abc1234', bot: true }), deps)
    expect(res.status).toBe(200)
    expect(calls[0]?.args.p_bot).toBe(true)
  })

  it('passes p_bot true for a crawler user agent', async () => {
    const { deps, calls } = makeDeps()
    await handleClick(
      post({ code: 'abc1234' }, { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' }),
      deps,
    )
    expect(calls[0]?.args.p_bot).toBe(true)
  })

  it.each([false, 'true', 1, null, {}])('only counts bot=true, not %j', async (bot) => {
    const { deps, calls } = makeDeps()
    const res = await handleClick(post({ code: 'abc1234', bot }), deps)
    expect(res.status).toBe(200)
    expect(calls[0]?.args.p_bot).toBe(false)
  })

  it('passes model, screen class and channel when valid', async () => {
    const { deps, calls } = makeDeps()
    const res = await handleClick(
      post({
        code: 'abc1234',
        model: '  Pixel 8 (Pro)  ',
        screen: { w: 412, h: 915 },
        channel: 'qr-flyer',
      }),
      deps,
    )
    expect(res.status).toBe(200)
    expect(calls[0]?.args).toMatchObject({
      p_model: 'Pixel 8 (Pro)',
      p_screen: 'phone',
      p_channel: 'qr-flyer',
    })
  })

  it.each([5, '', '   ', 'a'.repeat(41), 'x<script>', 'Pixel\u00e9', null, {}])(
    'treats model %j as absent',
    async (model) => {
      const { deps, calls } = makeDeps()
      const res = await handleClick(post({ code: 'abc1234', model }), deps)
      expect(res.status).toBe(200)
      expect(calls[0]?.args.p_model).toBeNull()
    },
  )

  it.each(['Flyer', 'a b', '', 'a'.repeat(25), 'under_score', 7, null])(
    'treats channel %j as absent',
    async (channel) => {
      const { deps, calls } = makeDeps()
      const res = await handleClick(post({ code: 'abc1234', channel }), deps)
      expect(res.status).toBe(200)
      expect(calls[0]?.args.p_channel).toBeNull()
    },
  )

  it.each([
    'phone',
    [375, 667],
    { w: '375', h: 667 },
    { w: 375 },
    { w: 0, h: 0 },
    { w: 99999, h: 800 },
    null,
  ])('treats screen %j as absent', async (screen) => {
    const { deps, calls } = makeDeps()
    const res = await handleClick(post({ code: 'abc1234', screen }), deps)
    expect(res.status).toBe(200)
    expect(calls[0]?.args.p_screen).toBeNull()
  })

  it('classifies a desktop window by its long side', async () => {
    const { deps, calls } = makeDeps()
    await handleClick(post({ code: 'abc1234', screen: { w: 1366, h: 768 } }), deps)
    expect(calls[0]?.args.p_screen).toBe('laptop')
  })

  it('ignores non-string lang and tz', async () => {
    const { deps, calls } = makeDeps()
    await handleClick(post({ code: 'abc1234', lang: 5, tz: { a: 1 }, referrer: 7 }), deps)
    expect(calls[0]?.args).toMatchObject({ p_lang: null, p_tz: null, p_referrer_host: null })
  })

  it('sends an empty ip when the header is missing', async () => {
    const { deps, calls } = makeDeps()
    const country = vi.fn(() => null)
    deps.country = country
    const req = new Request('https://f.example/fn', {
      method: 'POST',
      body: JSON.stringify({ code: 'abc1234' }),
    })
    await handleClick(req, deps)
    expect(calls[0]?.args).toMatchObject({ p_ip: '', p_country: null })
    expect(country).toHaveBeenCalledWith(null)
  })

  it('returns 404 when the rpc finds nothing', async () => {
    const { deps } = makeDeps({ rpc: async () => [] })
    const res = await handleClick(post({ code: 'abc1234' }), deps)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
  })

  it('returns a null locationToken as-is', async () => {
    const { deps } = makeDeps({
      rpc: async () => [{ target: 'https://e.com/', ask_location: false, location_token: null }],
    })
    const res = await handleClick(post({ code: 'abc1234' }), deps)
    expect(await res.json()).toEqual({
      target: 'https://e.com/',
      askLocation: false,
      locationToken: null,
    })
  })

  it('returns 404 without the rpc for malformed codes', async () => {
    for (const code of ['../../x', 'abc123', 'abc12345', 'abc 123', 7, undefined]) {
      const { deps, calls } = makeDeps()
      const res = await handleClick(post({ code }), deps)
      expect(res.status).toBe(404)
      expect(calls).toHaveLength(0)
    }
  })

  it('returns 500 for a non-array rpc response', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { deps } = makeDeps({ rpc: async () => ({ target: 'x' }) })
    const res = await handleClick(post({ code: 'abc1234' }), deps)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'server' })
  })

  it('returns 400 on bad json', async () => {
    const { deps } = makeDeps()
    const res = await handleClick(post('{', {}, true), deps)
    expect(res.status).toBe(400)
  })

  it('returns 500 with no details when the rpc throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { deps } = makeDeps(rpcFails('secret db detail'))
    const res = await handleClick(post({ code: 'abc1234' }), deps)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'server' })
  })

  it('rejects bodies over 8 KB', async () => {
    const { deps } = makeDeps()
    const res = await handleClick(post({ code: 'abc1234', referrer: 'a'.repeat(9000) }), deps)
    expect(res.status).toBe(413)
  })

  it('answers OPTIONS and non-POST', async () => {
    const { deps } = makeDeps()
    const opt = await handleClick(
      new Request('https://f.example/fn', { method: 'OPTIONS', headers: { origin: ORIGIN } }),
      deps,
    )
    expect(opt.status).toBe(204)
    expect(opt.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    const get = await handleClick(new Request('https://f.example/fn'), deps)
    expect(get.status).toBe(405)
  })
})

describe('privacy', () => {
  afterEach(() => vi.restoreAllMocks())

  it('never leaks the ip in responses or console calls', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    )
    const texts: string[] = []
    for (const ip of [IPV4, IPV6]) {
      const h = { 'cf-connecting-ip': ip }
      const ok = makeDeps().deps
      const bad = makeDeps(rpcFails(`failed for ${ip}`)).deps
      const res = [
        await handleCreate(post(createBody, h), ok),
        await handleCreate(post(createBody, h), bad),
        await handleCreate(post(createBody, h), makeDeps(rpcFails(RPC_ERRORS.rateLimited)).deps),
        await handleClick(post({ code: 'abc1234' }, h), ok),
        await handleClick(post({ code: 'abc1234' }, h), bad),
        await handleClick(post({ code: 'abc1234' }, h), makeDeps({ rpc: async () => [] }).deps),
      ]
      for (const r of res) {
        texts.push(await r.text(), JSON.stringify([...r.headers.entries()]))
      }
    }
    for (const t of texts) {
      expect(t).not.toContain(IPV4)
      expect(t).not.toContain(IPV6)
    }
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls))
    expect(logged).not.toContain(IPV4)
    expect(logged).not.toContain('2001:db8')
    expect(logged).not.toContain('failed for')
  })
})
