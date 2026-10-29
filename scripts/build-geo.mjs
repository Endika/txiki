// Usage: node scripts/build-geo.mjs [--csv <path to dbip-country-lite CSV, .gz or plain>]
// Needs Node >= 22.18 (native TypeScript stripping), the encoder is imported from the shared module.
import { readFile, writeFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { encodeRanges } from '../supabase/functions/_shared/geo.ts'

const OUT = new URL('../supabase/functions/_shared/geo-data.ts', import.meta.url)

async function download() {
  const now = new Date()
  for (const back of [0, 1]) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))
    const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    const url = `https://download.db-ip.com/free/dbip-country-lite-${month}.csv.gz`
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) })
    if (res.status === 404) continue
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
    console.log(`downloaded ${url}`)
    return Buffer.from(await res.arrayBuffer())
  }
  throw new Error('no DB-IP Lite Country CSV for this month or the previous one')
}

const csvFlag = process.argv.indexOf('--csv')
const csvPath = csvFlag === -1 ? null : process.argv[csvFlag + 1]
if (csvFlag !== -1 && !csvPath) throw new Error('--csv needs a path')

let buf = csvPath ? await readFile(csvPath) : await download()
if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf)

const rows = buf
  .toString('utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean)
  .map((line) => {
    const [start, end, country] = line.split(',')
    if (!start || !end || !/^[A-Z]{2}$/.test(country ?? ''))
      throw new Error(`bad CSV line: ${line}`)
    return { start, end, country }
  })

const geo = await encodeRanges(rows)
const body = `import type { GeoData } from './geo.ts'\n\nexport const GEO: GeoData = ${JSON.stringify(geo)}\n`
await writeFile(OUT, body)
console.log(
  `wrote ${OUT.pathname}: ${geo.v4Count} IPv4 + ${geo.v6Count} IPv6 ranges, ${(body.length / 1e6).toFixed(2)} MB`,
)
