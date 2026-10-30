import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  document.head.replaceChildren()
  delete (window as unknown as { turnstile?: unknown }).turnstile
  vi.resetModules()
})

function callbacks() {
  return { onToken: vi.fn(), onExpired: vi.fn(), onError: vi.fn() }
}

function install() {
  type Options = {
    callback: (t: string) => void
    'expired-callback': () => void
    'error-callback': () => void
  }
  const api = {
    options: undefined as Options | undefined,
    render: vi.fn((_el: HTMLElement, options: Options) => {
      api.options = options
      return 'id'
    }),
    reset: vi.fn(),
    remove: vi.fn(),
  }
  ;(window as unknown as { turnstile: unknown }).turnstile = api
  return api
}

describe('renderTurnstile', () => {
  it('loads the Cloudflare script once and reports tokens, expiry and errors', async () => {
    const { renderTurnstile } = await import('@/turnstile')
    const a = callbacks()
    const b = callbacks()
    renderTurnstile(document.createElement('div'), 'site-key', a)
    renderTurnstile(document.createElement('div'), 'site-key', b)
    const scripts = document.head.querySelectorAll('script')
    expect(scripts).toHaveLength(1)
    expect(scripts[0]!.src).toBe(
      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    )
    const api = install()
    scripts[0]!.dispatchEvent(new Event('load'))
    await vi.waitFor(() => expect(api.render).toHaveBeenCalledTimes(2))
    expect(api.render.mock.calls[0]![1]).toMatchObject({
      sitekey: 'site-key',
      'refresh-expired': 'never',
    })
    api.options!.callback('tok')
    expect(b.onToken).toHaveBeenCalledWith('tok')
    api.options!['expired-callback']()
    expect(b.onExpired).toHaveBeenCalledTimes(1)
    api.options!['error-callback']()
    expect(b.onError).toHaveBeenCalledTimes(1)
  })

  it('resets and removes the rendered widget', async () => {
    const api = install()
    const { renderTurnstile } = await import('@/turnstile')
    const handle = renderTurnstile(document.createElement('div'), 'k', callbacks())
    await vi.waitFor(() => expect(api.render).toHaveBeenCalled())
    handle.reset()
    expect(api.reset).toHaveBeenCalledWith('id')
    handle.remove()
    expect(api.remove).toHaveBeenCalledWith('id')
    handle.reset()
    expect(api.reset).toHaveBeenCalledTimes(1)
  })

  it('reports a script failure and loads again on reset', async () => {
    const { renderTurnstile } = await import('@/turnstile')
    const cb = callbacks()
    const handle = renderTurnstile(document.createElement('div'), 'k', cb)
    document.head.querySelector('script')!.dispatchEvent(new Event('error'))
    await vi.waitFor(() => expect(cb.onError).toHaveBeenCalledTimes(1))
    handle.reset()
    expect(document.head.querySelectorAll('script')).toHaveLength(1)
  })

  it('renders nothing if it was removed before the script loaded', async () => {
    const { renderTurnstile } = await import('@/turnstile')
    const handle = renderTurnstile(document.createElement('div'), 'k', callbacks())
    handle.remove()
    const api = install()
    document.head.querySelector('script')!.dispatchEvent(new Event('load'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(api.render).not.toHaveBeenCalled()
  })
})
