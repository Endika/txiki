// Usage: node scripts/build-geo-db.mjs [--out <dir>] [--asn <csv or csv.gz>] [--city <csv or csv.gz>]
// Streams the DB-IP Lite ASN and City CSVs into numbered SQL batch files that insert into the
// staging tables txiki.asn_orgs_load, txiki.asn_ranges_load and txiki.city_es_ranges_load.
// Also writes sample-es-ip.txt (a Spanish IPv4 from the data) to the output dir.
import { createReadStream } from 'node:fs'
import { mkdtemp, mkdir, open, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import { createGunzip } from 'node:zlib'

const BATCH = 5000

function flag(name) {
  const i = process.argv.indexOf(name)
  if (i === -1) return null
  if (!process.argv[i + 1]) throw new Error(`${name} needs a value`)
  return process.argv[i + 1]
}

async function download(kind) {
  const now = new Date()
  for (const back of [0, 1]) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))
    const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    const url = `https://download.db-ip.com/free/dbip-${kind}-lite-${month}.csv.gz`
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) })
    if (res.status === 404) continue
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
    console.log(`downloading ${url}`)
    return Readable.fromWeb(res.body).pipe(createGunzip())
  }
  throw new Error(`no DB-IP Lite ${kind} CSV for this month or the previous one`)
}

async function openLocal(path) {
  const fh = await open(path, 'r')
  const magic = Buffer.alloc(2)
  await fh.read(magic, 0, 2, 0)
  await fh.close()
  const stream = createReadStream(path)
  return magic[0] === 0x1f && magic[1] === 0x8b ? stream.pipe(createGunzip()) : stream
}

async function* lines(stream) {
  for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
    if (line.trim()) yield line
  }
}

function parseCsvLine(line) {
  const fields = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else quoted = false
      } else cur += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      fields.push(cur)
      cur = ''
    } else cur += c
  }
  if (quoted) throw new Error(`unterminated quote: ${line}`)
  fields.push(cur)
  return fields
}

const sql = (v) => (v === null ? 'null' : `'${v.replaceAll("'", "''")}'`)
const isIp = (s) => /^[0-9a-fA-F:.]+$/.test(s) && (s.includes('.') || s.includes(':'))

let outDir = flag('--out')
if (outDir) await mkdir(outDir, { recursive: true })
else outDir = await mkdtemp(join(tmpdir(), 'txiki-geo-'))

let fileNo = 0
class Batcher {
  rows = []
  total = 0
  constructor(table) {
    this.table = table
  }
  async add(tuple) {
    this.rows.push(tuple)
    this.total++
    if (this.rows.length >= BATCH) await this.flush()
  }
  async flush() {
    if (!this.rows.length) return
    fileNo++
    const name = `${String(fileNo).padStart(5, '0')}-${this.table}.sql`
    await writeFile(
      join(outDir, name),
      `insert into txiki.${this.table} values ${this.rows.join(',')};\n`,
    )
    this.rows = []
  }
}

const orgs = new Batcher('asn_orgs_load')
const ranges = new Batcher('asn_ranges_load')
const cities = new Batcher('city_es_ranges_load')
const skipped = { asn: 0, city: 0 }

const seenAsn = new Set()
for await (const line of lines(
  flag('--asn') ? await openLocal(flag('--asn')) : await download('asn'),
)) {
  if (line.includes('\0')) {
    skipped.asn++
    continue
  }
  const [start, end, asn, name] = parseCsvLine(line)
  const id = Number(asn)
  if (!isIp(start) || !isIp(end) || !Number.isInteger(id) || id < 0 || id > 2147483647 || !name) {
    skipped.asn++
    continue
  }
  if (!seenAsn.has(id)) {
    seenAsn.add(id)
    await orgs.add(`(${id},${sql(name)})`)
  }
  await ranges.add(`(${sql(start)},${sql(end)},${id})`)
}

let sampleIp = null
for await (const line of lines(
  flag('--city') ? await openLocal(flag('--city')) : await download('city'),
)) {
  if (line.includes('\0')) {
    skipped.city++
    continue
  }
  const f = parseCsvLine(line)
  if (f[3] !== 'ES') continue
  const [start, end, , , region, city] = f
  if (!isIp(start) || !isIp(end) || !city) {
    skipped.city++
    continue
  }
  if (!sampleIp && !start.includes(':')) sampleIp = start
  await cities.add(`(${sql(start)},${sql(end)},${sql(city)},${sql(region || null)})`)
}

await orgs.flush()
await ranges.flush()
await cities.flush()
await writeFile(join(outDir, 'sample-es-ip.txt'), `${sampleIp ?? ''}\n`)

console.log(`out dir: ${outDir}`)
console.log(
  `${orgs.total} organisations, ${ranges.total} ASN ranges, ${cities.total} ES city ranges`,
)
console.log(`${fileNo} batch files; skipped rows: ${skipped.asn} ASN, ${skipped.city} city`)
