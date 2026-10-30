export type SavedLink = { code: string; token: string; target: string; createdAt: string }

const KEY = 'txiki.links'

function isSavedLink(value: unknown): value is SavedLink {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.code === 'string' &&
    /^[0-9A-Za-z]{7}$/.test(v.code) &&
    typeof v.token === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(v.token) &&
    typeof v.target === 'string' &&
    typeof v.createdAt === 'string'
  )
}

function parse(raw: string | null): SavedLink[] {
  if (raw === null) return []
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(data)) return []
  return data.filter(isSavedLink).map((l) => ({
    code: l.code,
    token: l.token,
    target: l.target,
    createdAt: l.createdAt,
  }))
}

export function loadLinks(s: Storage): SavedLink[] {
  try {
    return parse(s.getItem(KEY))
  } catch {
    return []
  }
}

function write(s: Storage, links: SavedLink[]): boolean {
  try {
    s.setItem(KEY, JSON.stringify(links))
    return true
  } catch {
    return false
  }
}

export function saveLink(s: Storage, link: SavedLink): boolean {
  if (!isSavedLink(link)) return false
  let current: SavedLink[]
  try {
    current = parse(s.getItem(KEY))
  } catch {
    return false
  }
  return write(s, [link, ...current.filter((l) => l.code !== link.code)])
}

export function removeLink(s: Storage, code: string): void {
  write(
    s,
    loadLinks(s).filter((l) => l.code !== code),
  )
}
