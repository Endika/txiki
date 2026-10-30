export type Route =
  | { kind: 'home' }
  | { kind: 'links' }
  | { kind: 'privacy' }
  | { kind: 'go'; code: string; channel: string | null }
  | { kind: 'stats'; code: string; token: string }

const GO = /^([0-9A-Za-z]{7})(?![0-9A-Za-z])(?:\/([\s\S]*))?/
const CHANNEL = /^[A-Za-z0-9-]{1,24}$/
const STATS = /^s\/([0-9A-Za-z]{7})\.([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/

export function parseRoute(hash: string): Route {
  const h = hash.startsWith('#') ? hash.slice(1) : hash
  if (h === '/links') return { kind: 'links' }
  if (h === '/privacy') return { kind: 'privacy' }
  const stats = STATS.exec(h)
  if (stats) return { kind: 'stats', code: stats[1]!, token: stats[2]! }
  const go = GO.exec(h)
  if (go) {
    const raw = go[2] ?? ''
    return { kind: 'go', code: go[1]!, channel: CHANNEL.test(raw) ? raw.toLowerCase() : null }
  }
  return { kind: 'home' }
}

export function normalizeChannel(input: string): string {
  return input
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 24)
}

export function shortLink(code: string, base: string, channel?: string): string {
  return channel ? `${base}#${code}/${channel}` : `${base}#${code}`
}

export function statsHash(code: string, token: string): string {
  return `#s/${code}.${token}`
}

export function statsLink(code: string, token: string, base: string): string {
  return `${base}${statsHash(code, token)}`
}
