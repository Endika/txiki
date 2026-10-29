export type GeoData = { v4Count: number; v6Count: number; codes: string[]; data: string }

export type Lookup = (ip: string) => string | null

type Parsed = { v4: number } | { hi: number; lo: number }

const parseV4 = (s: string): number | null => {
  const parts = s.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(p) || Number(p) > 255) return null
    n = n * 256 + Number(p)
  }
  return n
}

const parseV6Groups = (s: string): number[] | null => {
  let groups = s
  let tailV4: number | null = null
  const v4Start = s.lastIndexOf(':') + 1
  if (s.includes('.')) {
    tailV4 = parseV4(s.slice(v4Start))
    if (tailV4 === null) return null
    groups = `${s.slice(0, v4Start)}0:0`
  }
  const halves = groups.split('::')
  if (halves.length > 2) return null
  const read = (part: string): number[] | null => {
    if (part === '') return []
    const out: number[] = []
    for (const g of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null
      out.push(parseInt(g, 16))
    }
    return out
  }
  const head = read(halves[0]!)
  const tail = halves.length === 2 ? read(halves[1]!) : []
  if (!head || !tail) return null
  const missing = 8 - head.length - tail.length
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null
  const all = [...head, ...Array<number>(missing).fill(0), ...tail]
  if (tailV4 !== null) {
    all[6] = Math.floor(tailV4 / 65536)
    all[7] = tailV4 % 65536
  }
  return all
}

const parseIp = (raw: string): Parsed | null => {
  const zone = raw.indexOf('%')
  const s = (zone === -1 ? raw : raw.slice(0, zone)).toLowerCase()
  if (!s.includes(':')) {
    const v4 = parseV4(s)
    return v4 === null ? null : { v4 }
  }
  const g = parseV6Groups(s)
  if (!g) return null
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return { v4: g[6]! * 65536 + g[7]! }
  }
  return { hi: g[0]! * 65536 + g[1]!, lo: g[2]! * 65536 + g[3]! }
}

const streamBytes = async (stream: ReadableStream<Uint8Array>): Promise<Uint8Array> =>
  new Uint8Array(await new Response(stream).arrayBuffer())

const toBase64 = (bytes: Uint8Array): string => {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}

const V4_MAX = 0xffffffff
const V6_MAX = (1n << 64n) - 1n
const V6_FULL_MAX = (1n << 128n) - 1n

type FullRange = { start: bigint; end: bigint; country: string }

const parseFull = (raw: string, v6: boolean): bigint | null => {
  const p = parseIp(raw)
  if (!p || 'v4' in p === v6) return null
  if ('v4' in p) return BigInt(p.v4)
  const zone = raw.indexOf('%')
  const g = parseV6Groups((zone === -1 ? raw : raw.slice(0, zone)).toLowerCase())
  return g ? g.reduce((acc, x) => (acc << 16n) | BigInt(x), 0n) : null
}

const gaps = (ranges: FullRange[], max: bigint): { end: bigint; nextStart: bigint | null }[] => {
  const sorted = [...ranges].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
  const out: { end: bigint; nextStart: bigint | null }[] = []
  sorted.forEach((r, i) => {
    const next = sorted[i + 1]
    if (next ? next.start > r.end + 1n : r.end < max) {
      out.push({ end: r.end, nextStart: next?.start ?? null })
    }
  })
  return out
}

export async function encodeRanges(
  rows: { start: string; end: string; country: string }[],
): Promise<GeoData> {
  const v4 = new Map<number, string>()
  const v6 = new Map<bigint, string>()
  const full4: FullRange[] = []
  const full6: FullRange[] = []
  for (const { start, end, country } of rows) {
    const s = parseIp(start)
    if (!s) throw new Error(`invalid range start: ${start}`)
    const is6 = !('v4' in s) || start.includes(':')
    if (is6 && 'v4' in s) throw new Error(`IPv6 range inside ::ffff:0:0/96: ${start}`)
    const bs = parseFull(start, is6)
    const be = parseFull(end, is6)
    if (bs === null) throw new Error(`invalid range start: ${start}`)
    if (be === null) throw new Error(`invalid range end: ${end}`)
    if (is6) {
      full6.push({ start: bs, end: be, country })
    } else {
      full4.push({ start: bs, end: be, country })
    }
  }
  for (const r of full4) v4.set(Number(r.start), r.country)
  for (const r of full6) v6.set(r.start >> 64n, r.country)
  for (const g of gaps(full4, BigInt(V4_MAX))) {
    const key = Number(g.end) + 1
    if (!v4.has(key)) v4.set(key, 'ZZ')
  }
  for (const g of gaps(full6, V6_FULL_MAX)) {
    const key = (g.end + 1n + V6_MAX) >> 64n
    if (key > V6_MAX || v6.has(key)) continue
    if (g.nextStart === null || key < g.nextStart >> 64n) v6.set(key, 'ZZ')
  }

  const codes: string[] = []
  const index = (country: string): number => {
    let i = codes.indexOf(country)
    if (i === -1) {
      if (codes.length === 256) throw new Error('more than 256 distinct country codes')
      i = codes.push(country) - 1
    }
    return i
  }

  const out: number[] = []
  let prev4 = 0
  for (const start of [...v4.keys()].sort((a, b) => a - b)) {
    let delta = start - prev4
    prev4 = start
    while (delta >= 0x80) {
      out.push((delta % 0x80) | 0x80)
      delta = Math.floor(delta / 0x80)
    }
    out.push(delta, index(v4.get(start)!))
  }
  let prev6 = 0n
  for (const start of [...v6.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    let delta = start - prev6
    prev6 = start
    while (delta >= 0x80n) {
      out.push(Number(delta & 0x7fn) | 0x80)
      delta >>= 7n
    }
    out.push(Number(delta), index(v6.get(start)!))
  }

  const deflated = await streamBytes(
    new Response(new Uint8Array(out)).body!.pipeThrough(new CompressionStream('deflate')),
  )
  return { v4Count: v4.size, v6Count: v6.size, codes, data: toBase64(deflated) }
}

export async function createLookup(geo: GeoData): Promise<Lookup> {
  const bin = atob(geo.data)
  const packed = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) packed[i] = bin.charCodeAt(i)
  const raw = await streamBytes(
    new Response(packed).body!.pipeThrough(new DecompressionStream('deflate')),
  )
  let pos = 0
  const next = (): number => {
    const b = raw[pos++]
    if (b === undefined) throw new Error('truncated geo data')
    return b
  }

  const v4 = new Uint32Array(geo.v4Count)
  const v4c = new Uint8Array(geo.v4Count)
  let prev = 0
  for (let i = 0; i < geo.v4Count; i++) {
    let delta = 0
    for (let mul = 1; ; mul *= 0x80) {
      const b = next()
      delta += (b & 0x7f) * mul
      if (b < 0x80) break
    }
    prev += delta
    v4[i] = prev
    v4c[i] = next()
  }

  const hi = new Uint32Array(geo.v6Count)
  const lo = new Uint32Array(geo.v6Count)
  const v6c = new Uint8Array(geo.v6Count)
  let prevHi = 0
  let prevLo = 0
  for (let i = 0; i < geo.v6Count; i++) {
    let dHi = 0
    let dLo = 0
    for (let shift = 0; ; shift += 7) {
      const b = next()
      const v = b & 0x7f
      if (shift < 32) {
        dLo = (dLo | (v << shift)) >>> 0
        if (shift > 25) dHi = (dHi | (v >>> (32 - shift))) >>> 0
      } else {
        dHi = (dHi | (v << (shift - 32))) >>> 0
      }
      if (b < 0x80) break
    }
    const sumLo = prevLo + dLo
    prevHi = (prevHi + dHi + (sumLo > 0xffffffff ? 1 : 0)) >>> 0
    prevLo = sumLo >>> 0
    hi[i] = prevHi
    lo[i] = prevLo
    v6c[i] = next()
  }

  if (pos !== raw.length) throw new Error('inconsistent geo data')

  const find4 = (key: number): number => {
    let l = 0
    let h = v4.length - 1
    let ans = -1
    while (l <= h) {
      const mid = (l + h) >> 1
      if (v4[mid]! <= key) {
        ans = mid
        l = mid + 1
      } else h = mid - 1
    }
    return ans
  }
  const find6 = (kHi: number, kLo: number): number => {
    let l = 0
    let h = hi.length - 1
    let ans = -1
    while (l <= h) {
      const mid = (l + h) >> 1
      if (hi[mid]! < kHi || (hi[mid] === kHi && lo[mid]! <= kLo)) {
        ans = mid
        l = mid + 1
      } else h = mid - 1
    }
    return ans
  }

  return (ip) => {
    const p = parseIp(ip)
    if (!p) return null
    const country =
      'v4' in p ? geo.codes[v4c[find4(p.v4)] ?? -1] : geo.codes[v6c[find6(p.hi, p.lo)] ?? -1]
    return country === undefined || country === 'ZZ' ? null : country
  }
}
