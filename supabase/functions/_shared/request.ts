const ALLOWED_ORIGINS = new Set([
  'https://endika.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
])

export function clientIp(headers: Headers): string | null {
  return headers.get('cf-connecting-ip')?.split(',')[0]?.trim() || null
}

export function referrerHost(referrer: unknown): string | null {
  if (typeof referrer !== 'string') return null
  try {
    const url = new URL(referrer)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.hostname.replace(/\.$/, '') || null
  } catch {
    return null
  }
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = { Vary: 'Origin' }
  if (origin !== null && ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
    headers['Access-Control-Allow-Headers'] = 'content-type'
    headers['Access-Control-Max-Age'] = '86400'
  }
  return headers
}
