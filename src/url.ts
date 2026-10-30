export function displayTarget(target: string): string {
  try {
    const url = new URL(target)
    const path = url.pathname === '/' ? '' : url.pathname
    return `${url.host}${path}${url.search}`
  } catch {
    return target
  }
}

export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '')
}

const OTHER_SCHEME = /^(javascript|data|vbscript|file|blob|mailto|tel|about):/i

export function normalizeUrl(input: string): string | null {
  const text = input.trim()
  if (!text || /\s/.test(text)) return null
  if (OTHER_SCHEME.test(text)) return null
  const candidate = text.includes('://') ? text : `https://${text}`
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password) return null
    if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null
    return candidate
  } catch {
    return null
  }
}
