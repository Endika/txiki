import { ALLOWED_ORIGINS } from './request.ts'

const TIMEOUT_MS = 5000
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const ALLOWED_HOSTNAMES = new Set([...ALLOWED_ORIGINS].map((o) => new URL(o).hostname))

export function createRpc(url: string, serviceKey: string, fetchFn: typeof fetch = fetch) {
  return async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    const res = await fetchFn(`${url}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        'Content-Profile': 'txiki',
        'Accept-Profile': 'txiki',
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) {
      const err: unknown = await res.json().catch(() => null)
      const m = (err as { message?: unknown } | null)?.message
      const message = typeof m === 'string' ? m : `rpc failed: ${res.status}`
      throw new Error(message)
    }
    return res.json()
  }
}

export function createTurnstileVerifier(secret: string, fetchFn: typeof fetch = fetch) {
  return async (token: string, ip: string | null): Promise<boolean> => {
    try {
      const form = new URLSearchParams({ secret, response: token })
      if (ip !== null) form.set('remoteip', ip)
      const res = await fetchFn(SITEVERIFY, {
        method: 'POST',
        body: form.toString(),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      const data: unknown = await res.json()
      const { success, hostname } = (data ?? {}) as { success?: unknown; hostname?: unknown }
      return success === true && typeof hostname === 'string' && ALLOWED_HOSTNAMES.has(hostname)
    } catch {
      return false
    }
  }
}
