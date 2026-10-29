// @vitest-environment node
import { createLookup, encodeRanges } from '../../supabase/functions/_shared/geo.ts'

type Row = { start: string; end: string; country: string }

const build = async (rows: Row[]) => createLookup(await encodeRanges(rows))

const small: Row[] = [
  { start: '0.0.0.0', end: '0.255.255.255', country: 'ZZ' },
  { start: '1.0.0.0', end: '1.0.0.255', country: 'AU' },
  { start: '1.0.1.0', end: '1.0.3.255', country: 'CN' },
  { start: '1.0.4.0', end: '8.8.7.255', country: 'ZZ' },
  { start: '8.8.8.0', end: '255.255.254.255', country: 'US' },
  { start: '255.255.255.0', end: '255.255.255.255', country: 'FR' },
  { start: '::', end: '2001:db7:ffff:ffff:ffff:ffff:ffff:ffff', country: 'ZZ' },
  { start: '2001:db8::', end: '2001:db8:0:0:ffff:ffff:ffff:ffff', country: 'NL' },
  { start: '2001:db8:0:1::', end: '2001:db8:0:ffff:ffff:ffff:ffff:ffff', country: 'DE' },
  { start: '2001:db8:1::', end: '2a00:144f:ffff:ffff:ffff:ffff:ffff:ffff', country: 'ZZ' },
  { start: '2a00:1450::', end: '2a00:1450:ffff:ffff:ffff:ffff:ffff:ffff', country: 'IE' },
  { start: 'fe80::', end: 'ffff:ffff:ffff:feff:ffff:ffff:ffff:ffff', country: 'ZZ' },
  { start: 'ffff:ffff:ffff:ff00::', end: 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', country: 'ES' },
]

describe('geo encode/decode', () => {
  it('round-trips ranges in both families', async () => {
    const lookup = await build(small)
    expect(lookup('1.0.0.0')).toBe('AU')
    expect(lookup('1.0.0.255')).toBe('AU')
    expect(lookup('1.0.1.0')).toBe('CN')
    expect(lookup('1.0.3.255')).toBe('CN')
    expect(lookup('8.8.8.8')).toBe('US')
    expect(lookup('255.255.255.255')).toBe('FR')
    expect(lookup('2001:db8::1')).toBe('NL')
    expect(lookup('2001:db8:0:0:ffff:ffff:ffff:ffff')).toBe('NL')
    expect(lookup('2001:db8:0:1::5')).toBe('DE')
    expect(lookup('2a00:1450:4003:80f::200e')).toBe('IE')
    expect(lookup('ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')).toBe('ES')
  })

  it('maps ZZ gaps and addresses before the first range to null', async () => {
    const lookup = await build(small)
    expect(lookup('0.1.2.3')).toBeNull()
    expect(lookup('1.0.4.0')).toBeNull()
    expect(lookup('2001:db8:1::1')).toBeNull()
    expect(lookup('::1')).toBeNull()
    const noZero = await build([{ start: '1.0.0.0', end: '1.0.0.255', country: 'AU' }])
    expect(noZero('0.0.0.1')).toBeNull()
  })

  it('turns holes between rows into null instead of the previous country', async () => {
    const lookup = await build([
      { start: '1.0.0.0', end: '1.0.0.255', country: 'AU' },
      { start: '1.0.2.0', end: '1.0.2.255', country: 'CN' },
      { start: '2001:db8::', end: '2001:db8:0:0:ffff:ffff:ffff:ffff', country: 'NL' },
      { start: '2001:db8:0:5::', end: '2001:db8:0:5:ffff:ffff:ffff:ffff', country: 'DE' },
    ])
    expect(lookup('1.0.0.255')).toBe('AU')
    expect(lookup('1.0.1.5')).toBeNull()
    expect(lookup('1.0.2.1')).toBe('CN')
    expect(lookup('1.0.3.0')).toBeNull()
    expect(lookup('2001:db8:0:3::1')).toBeNull()
    expect(lookup('2001:db8:0:5::1')).toBe('DE')
    expect(lookup('2001:db8:0:6::1')).toBeNull()
  })

  it('does not punch a hole when a range ends in the middle of a /64', async () => {
    const lookup = await build([
      { start: '2001:db8::', end: '2001:db8:0:0:7fff:ffff:ffff:ffff', country: 'AA' },
      { start: '2001:db8:0:0:8000::', end: '2001:db8:0:1:ffff:ffff:ffff:ffff', country: 'BB' },
    ])
    expect(lookup('2001:db8:0:1::5')).toBe('BB')
    expect(lookup('2001:db8:0:2::')).toBeNull()
  })

  it('rejects IPv6 rows inside ::ffff:0:0/96 instead of overwriting the IPv4 table', async () => {
    await expect(
      encodeRanges([{ start: '::ffff:0:0', end: '::ffff:ffff:ffff', country: 'US' }]),
    ).rejects.toThrow()
  })

  it('rejects inconsistent GeoData', async () => {
    const geo = await encodeRanges(small)
    await expect(createLookup({ ...geo, v4Count: geo.v4Count - 1 })).rejects.toThrow()
    await expect(createLookup({ ...geo, v6Count: geo.v6Count + 1 })).rejects.toThrow()
    await expect(createLookup({ ...geo, v4Count: geo.v4Count + 1 })).rejects.toThrow()
  })

  it('does not depend on the order of the input rows and keeps the last duplicate /64', async () => {
    const lookup = await build([
      { start: '8.8.8.0', end: '8.8.8.255', country: 'US' },
      { start: '2001:db8::1', end: '2001:db8::1', country: 'NL' },
      { start: '2001:db8::2', end: '2001:db8::2', country: 'DE' },
      { start: '1.0.0.0', end: '1.0.0.255', country: 'AU' },
    ])
    expect(lookup('1.0.0.4')).toBe('AU')
    expect(lookup('8.8.8.8')).toBe('US')
    expect(lookup('2001:db8::99')).toBe('DE')
  })

  it('handles an empty table', async () => {
    const lookup = await build([])
    expect(lookup('1.2.3.4')).toBeNull()
    expect(lookup('::1')).toBeNull()
  })

  it('returns null, never throws, on invalid input', async () => {
    const lookup = await build(small)
    for (const bad of [
      '',
      'garbage',
      '1.2.3',
      '1.2.3.4.5',
      '256.1.1.1',
      '1.2.3.-4',
      '1.2.3.',
      '01.2.3.4x',
      ':::',
      '1::2::3',
      '12345::',
      'g::1',
      '1:2:3:4:5:6:7:8:9',
      '1:2:3',
      '::ffff:1.2.3',
      ' 8.8.8.8',
    ]) {
      expect(lookup(bad), bad).toBeNull()
    }
  })

  it('accepts the IPv6 notations a proxy can send', async () => {
    const lookup = await build(small)
    expect(lookup('::ffff:8.8.8.8')).toBe('US')
    expect(lookup('::FFFF:8.8.8.8')).toBe('US')
    expect(lookup('2001:DB8:0:1:0:0:0:0')).toBe('DE')
    expect(lookup('2001:db8:0:1::%eth0')).toBe('DE')
    expect(lookup('fe80::1%eth0')).toBeNull()
    expect(lookup('::')).toBeNull()
  })
})

// 20 consecutive-pair rows taken from the DB-IP Lite Country CSV (2026-10): start, start + 1, end.
const real: [string, string, string, string][] = [
  ['1.0.16.0', '1.0.16.1', '1.0.31.255', 'JP'],
  ['1.0.32.0', '1.0.32.1', '1.0.63.255', 'CN'],
  ['57.250.59.0', '57.250.59.1', '57.250.219.255', 'BE'],
  ['57.250.220.0', '57.250.220.1', '57.250.220.255', 'DE'],
  ['103.158.167.0', '103.158.167.1', '103.158.167.255', 'ID'],
  ['103.158.168.0', '103.158.168.1', '103.158.175.255', 'IN'],
  ['181.215.15.0', '181.215.15.1', '181.215.15.255', 'GE'],
  ['181.215.16.0', '181.215.16.1', '181.215.16.255', 'DE'],
  ['194.113.165.0', '194.113.165.1', '194.113.165.255', 'RO'],
  ['194.113.166.0', '194.113.166.1', '194.113.168.255', 'DE'],
  ['212.222.114.0', '212.222.114.1', '212.222.115.255', 'GB'],
  ['212.222.116.0', '212.222.116.1', '212.222.117.171', 'FR'],
  ['2001:2f8::', '2001:2f8:0:0:0:0:0:1', '2001:31f:ffff:ffff:ffff:ffff:ffff:ffff', 'JP'],
  ['2001:320::', '2001:320:0:0:0:0:0:1', '2001:320:ffff:ffff:ffff:ffff:ffff:ffff', 'KR'],
  ['2001:470:6039::', '2001:470:6039:0:0:0:0:1', '2001:470:6039:ffff:ffff:ffff:ffff:ffff', 'RU'],
  ['2001:470:603a::', '2001:470:603a:0:0:0:0:1', '2001:470:603b:ffff:ffff:ffff:ffff:ffff', 'PL'],
  ['2402:4421::', '2402:4421:0:0:0:0:0:1', '2402:443f:ffff:ffff:ffff:ffff:ffff:ffff', 'BE'],
  ['2402:4440::', '2402:4440:0:0:0:0:0:1', '2402:4440:ffff:ffff:ffff:ffff:ffff:ffff', 'CN'],
  ['2a09:bc48::', '2a09:bc48:0:0:0:0:0:1', '2a09:bc7f:ffff:ffff:ffff:ffff:ffff:ffff', 'NL'],
  ['2a09:bc80::', '2a09:bc80:0:0:0:0:0:1', '2a09:bc87:ffff:ffff:ffff:ffff:ffff:ffff', 'DE'],
]

describe('geo parity with the DB-IP rows', () => {
  it('resolves start, start + 1 and the last address of each range', async () => {
    const lookup = await build(real.map(([start, , end, country]) => ({ start, end, country })))
    for (const [start, next, end, country] of real) {
      expect(lookup(start), start).toBe(country)
      expect(lookup(next), next).toBe(country)
      expect(lookup(end), end).toBe(country)
    }
  })
})
