import { describe, expect, it, vi } from 'vitest'
import { createRpc, createTurnstileVerifier } from '../../supabase/functions/_shared/deps'

describe('createRpc', () => {
  it('posts to the rpc endpoint with the txiki profile and the service key', async () => {
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify([{ code: 'x' }]), { status: 200 }),
    )
    const rpc = createRpc('https://p.supabase.co', 'svc-key', fetchFn as unknown as typeof fetch)
    const out = await rpc('create_link', { p_target: 'https://e.com/' })
    expect(out).toEqual([{ code: 'x' }])
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://p.supabase.co/rest/v1/rpc/create_link')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ p_target: 'https://e.com/' }))
    expect(init.headers).toEqual({
      apikey: 'svc-key',
      Authorization: 'Bearer svc-key',
      'Content-Type': 'application/json',
      'Content-Profile': 'txiki',
      'Accept-Profile': 'txiki',
    })
  })

  it('throws the PostgREST message on non-2xx', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: 'rate limited', code: 'P0001' }), { status: 400 }),
    )
    const rpc = createRpc('https://p.supabase.co', 'k', fetchFn as unknown as typeof fetch)
    await expect(rpc('create_link', {})).rejects.toThrow('rate limited')
  })

  it('throws a generic error when the failure body is not json', async () => {
    const fetchFn = vi.fn(async () => new Response('<html>', { status: 502 }))
    const rpc = createRpc('https://p.supabase.co', 'k', fetchFn as unknown as typeof fetch)
    await expect(rpc('x', {})).rejects.toThrow('rpc failed: 502')
  })
})

function hangingFetch() {
  return vi.fn(
    (_u: unknown, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(new Error('aborted')))
      }),
  ) as unknown as typeof fetch
}

describe('timeouts', () => {
  it('passes an abort signal to both fetches', async () => {
    const f = vi.fn(async () => new Response('[]'))
    await createRpc('https://p', 'k', f as unknown as typeof fetch)('x', {})
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].signal).toBeInstanceOf(
      AbortSignal,
    )
    const g = vi.fn(async () => new Response('{"success":true,"hostname":"endika.github.io"}'))
    await createTurnstileVerifier('s', g as unknown as typeof fetch)('t', null)
    expect((g.mock.calls[0] as unknown as [string, RequestInit])[1].signal).toBeInstanceOf(
      AbortSignal,
    )
  })

  it('times out: rpc throws, turnstile returns false', async () => {
    const ctrl = new AbortController()
    const spy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(ctrl.signal)
    const rpcP = createRpc('https://p', 'k', hangingFetch())('x', {})
    const tsP = createTurnstileVerifier('s', hangingFetch())('t', null)
    ctrl.abort()
    await expect(rpcP).rejects.toThrow()
    expect(await tsP).toBe(false)
    expect(spy).toHaveBeenCalledWith(5000)
    spy.mockRestore()
  })
})

describe('createTurnstileVerifier', () => {
  const URL_ = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

  function fake(body: unknown, status = 200) {
    return vi.fn(async () => new Response(JSON.stringify(body), { status }))
  }

  it('posts a form with secret, response and remoteip', async () => {
    const fetchFn = fake({ success: true, hostname: 'endika.github.io' })
    const verify = createTurnstileVerifier('sec', fetchFn as unknown as typeof fetch)
    expect(await verify('tok', '203.0.113.7')).toBe(true)
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(URL_)
    expect(init.method).toBe('POST')
    const form = new URLSearchParams(init.body as string)
    expect(form.get('secret')).toBe('sec')
    expect(form.get('response')).toBe('tok')
    expect(form.get('remoteip')).toBe('203.0.113.7')
  })

  it('omits remoteip when the ip is null', async () => {
    const fetchFn = fake({ success: true, hostname: 'endika.github.io' })
    await createTurnstileVerifier('sec', fetchFn as unknown as typeof fetch)('tok', null)
    const init = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(new URLSearchParams(init.body as string).has('remoteip')).toBe(false)
  })

  it('accepts every allowed hostname including local dev', async () => {
    for (const hostname of ['endika.github.io', 'localhost']) {
      const verify = createTurnstileVerifier('s', fake({ success: true, hostname }) as never)
      expect(await verify('t', null)).toBe(true)
    }
  })

  it('returns false when the token was issued for a foreign hostname', async () => {
    const verify = createTurnstileVerifier(
      's',
      fake({ success: true, hostname: 'evil.example' }) as never,
    )
    expect(await verify('t', null)).toBe(false)
  })

  it('returns false when the hostname is missing or not a string', async () => {
    for (const body of [{ success: true }, { success: true, hostname: 42 }]) {
      const verify = createTurnstileVerifier('s', fake(body) as never)
      expect(await verify('t', null)).toBe(false)
    }
  })

  it('returns false when success is not true', async () => {
    for (const body of [
      { success: false, hostname: 'endika.github.io' },
      { hostname: 'endika.github.io' },
      { success: 'true', hostname: 'endika.github.io' },
    ]) {
      const verify = createTurnstileVerifier('s', fake(body) as unknown as typeof fetch)
      expect(await verify('t', null)).toBe(false)
    }
  })

  it('returns false on network error or bad json', async () => {
    const boom = vi.fn(async () => {
      throw new Error('net')
    })
    expect(await createTurnstileVerifier('s', boom as unknown as typeof fetch)('t', null)).toBe(
      false,
    )
    const bad = vi.fn(async () => new Response('nope', { status: 200 }))
    expect(await createTurnstileVerifier('s', bad as unknown as typeof fetch)('t', null)).toBe(
      false,
    )
  })
})
